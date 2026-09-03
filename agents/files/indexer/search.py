"""
Finding the file the owner meant.

Two failures shaped this, and they need different things:

    "find UI.png on my desktop"          the name is exact and the search
                                         still missed it, because the whole
                                         path was one token
    "search for aadhaar card files"      the name says nothing — the file is
                                         scan001.jpg — and the only evidence is
                                         the word printed inside it

So a query runs against both surfaces at once and the results are ranked
together. A filename match outranks a body match, because someone who names a
file `UI.png` and asks for `UI.png` means that file; but a body match still
appears, because sometimes it is the only thing there is.

**Expansion instead of embeddings.** "aadhaar" should reach a file whose text
says "UIDAI" or "Government of India", and a file called `govt_id.pdf`. A vector
index would do that and costs a two-gigabyte model download; a table of what
these words also mean does most of it for nothing, and the terms it adds are
visible in the result rather than buried in a cosine distance. Where a term is
not in the table, the caller can pass its own — the planner knows what
"my resume" might also be called, and can say so.
"""
from __future__ import annotations

import re
from . import store

# What a word also means, when the owner is looking for a document.
#
# Deliberately short and about *kinds of document*, not a thesaurus. Each entry
# earns its place by being a name the same file plausibly has: an Aadhaar card
# really is filed as "UID", a resume really is filed as "CV".
ALSO_MEANS = {
    'aadhaar': ['aadhar', 'adhaar', 'uid', 'uidai', 'government of india'],
    'aadhar': ['aadhaar', 'uid', 'uidai', 'government of india'],
    'pan': ['permanent account number', 'income tax'],
    'passport': ['republic of india', 'passport no'],
    'licence': ['license', 'driving', 'dl no'],
    'license': ['licence', 'driving', 'dl no'],
    'resume': ['cv', 'curriculum vitae'],
    'cv': ['resume', 'curriculum vitae'],
    'invoice': ['bill', 'receipt', 'tax invoice'],
    'receipt': ['invoice', 'bill', 'payment'],
    'marksheet': ['marks', 'grade', 'transcript', 'semester'],
    'transcript': ['marksheet', 'grade', 'semester'],
    'certificate': ['certification', 'awarded', 'completion'],
    'ticket': ['booking', 'pnr', 'boarding'],
    'salary': ['payslip', 'pay slip', 'ctc', 'compensation'],
    'payslip': ['salary', 'pay slip', 'earnings'],
    'id': ['identity', 'identification'],
    'photo': ['image', 'picture'],
}

# Generic words that would match half the disk and carry no intent of their own.
STOPWORDS = {
    'the', 'a', 'an', 'my', 'me', 'find', 'search', 'for', 'file', 'files',
    'in', 'on', 'of', 'and', 'or', 'to', 'from', 'pc', 'computer', 'laptop',
    'please', 'get', 'show', 'all', 'any', 'some', 'is', 'it', 'that', 'this',
    'mostly', 'like', 'named', 'called', 'located', 'stored',
}

# Extensions the owner may name in the request, which narrow rather than search.
EXTENSIONS = {
    'png', 'jpg', 'jpeg', 'pdf', 'docx', 'doc', 'xlsx', 'xls', 'txt', 'csv',
    'pptx', 'ppt', 'zip', 'mp4', 'mp3', 'md', 'json', 'svg', 'webp', 'gif',
}

# What an extension the owner named also covers on disk.
#
# Saying "jpeg" and getting nothing because the file is `.jpg` is the kind of
# literalism that makes a search feel broken. The same applies to tif/tiff and
# htm/html, and to a request for "word documents" that should reach both .doc
# and .docx.
EXT_ALIASES = {
    'jpeg': ['jpg', 'jpeg'],
    'jpg': ['jpg', 'jpeg'],
    'tif': ['tif', 'tiff'],
    'tiff': ['tif', 'tiff'],
    'htm': ['htm', 'html'],
    'html': ['htm', 'html'],
    'doc': ['doc', 'docx'],
    'docx': ['doc', 'docx'],
    'xls': ['xls', 'xlsx'],
    'xlsx': ['xls', 'xlsx'],
    'ppt': ['ppt', 'pptx'],
    'pptx': ['ppt', 'pptx'],
    'md': ['md', 'markdown'],
}


def widen(extensions: list) -> list:
    """Every extension on disk that the named ones cover."""
    out: list = []
    for ext in extensions:
        for alias in EXT_ALIASES.get(ext, [ext]):
            if alias not in out:
                out.append(alias)
    return out


def terms_of(query: str) -> tuple:
    """
    A request, split into what to search for and what to filter by.

    "Search for aadhar card files mostly png jpeg or pdf in my pc" becomes
    words `[aadhar, card]` and extensions `[png, jpeg, pdf]` — the extensions
    are a filter, not something to look for, which is why the old search
    returned fifty files whose only relation to the request was containing the
    letters "png".
    """
    words, extensions = [], []
    for raw in re.split(r'[^A-Za-z0-9]+', query.lower()):
        if not raw or raw in STOPWORDS:
            continue
        if raw in EXTENSIONS:
            extensions.append(raw)
        elif len(raw) > 1:
            words.append(raw)
    return words, extensions


def expand(words: list, extra: list | None = None) -> list:
    """Each word, plus the other names the same document goes by."""
    out = list(words)
    for word in words:
        for synonym in ALSO_MEANS.get(word, []):
            if synonym not in out:
                out.append(synonym)
    for word in extra or []:
        cleaned = str(word).strip().lower()
        if cleaned and cleaned not in out:
            out.append(cleaned)
    return out


def _fts_query(terms: list) -> str:
    """
    An FTS5 expression matching any term, with phrases quoted.

    OR rather than AND, because a request carries several words and a file
    rarely contains all of them — "aadhaar card" should find a file whose OCR
    says only AADHAAR. Ranking sorts out which matched more.
    """
    parts = []
    for term in terms:
        cleaned = term.replace('"', ' ').strip()
        if not cleaned:
            continue
        parts.append(f'"{cleaned}"' if ' ' in cleaned else f'{cleaned}*')
    return ' OR '.join(parts)


def search(query: str, limit: int = 25, extra_terms: list | None = None,
           under: str | None = None) -> dict:
    """
    Ranked matches, each saying why it matched.

    Two passes, merged, because they answer different questions and one cannot
    stand in for the other:

        by name      files whose *name* contains a search word. Indexed, exact,
                     and cheap — this is what someone asking for "UI.png"
                     means, and it must not be able to lose.
        by content   the FTS pass over path and extracted text, which is the
                     only thing that finds an Aadhaar card called scan001.jpg.

    They are run separately rather than as one ranked query because relevance
    ranking cannot be trusted to keep an exact name match in the top results.
    It did not: every file under the UI folder matches the word "ui", so
    `UI.png` sat somewhere past the first thirty by bm25 and was cut before the
    extension filter ever saw it. Filtering after ranking is what produced
    "the search found 40 matches, none of them UI.png".

    Both passes push the extension filter into SQL for the same reason.
    """
    words, extensions = terms_of(query)
    if not words and not extensions:
        return {'query': query, 'matches': [], 'reason': 'nothing to search for'}

    terms = expand(words, extra_terms)
    conn = store.connect()

    ext_clause, ext_args = '', []
    if extensions:
        widened = widen([e.lower() for e in extensions])
        ext_clause = ' AND lower(replace(f.ext, ".", "")) IN (%s)' % (
            ','.join('?' for _ in widened))
        ext_args = widened

    under_clause, under_args = '', []
    if under:
        under_clause = ' AND lower(f.path) LIKE ?'
        under_args = [under.lower().rstrip('\\/') + '%']

    found: dict = {}

    # --- by name ------------------------------------------------------------
    for word in words:
        rows = conn.execute(
            'SELECT f.path, f.name, f.ext, f.size, f.modified, f.content '
            'FROM files f WHERE lower(f.name) LIKE ?' + ext_clause + under_clause +
            ' LIMIT ?',
            [f'%{word}%', *ext_args, *under_args, limit * 4],
        ).fetchall()
        for path, name, ext, size, modified, kind in rows:
            entry = found.setdefault(path, {
                'path': path, 'name': name, 'ext': ext, 'size': size,
                'modified': modified, 'why': [], 'snippet': '', 'kind': kind,
                'score': 0.0,
            })
            if 'filename' not in entry['why']:
                entry['why'].append('filename')
            # An exact stem match is the strongest signal there is.
            stem = name.lower().rsplit('.', 1)[0]
            entry['score'] -= 100 if stem == word else 40

    # --- by content ---------------------------------------------------------
    expression = _fts_query(terms)
    if expression:
        rows = conn.execute(
            'SELECT s.path, s.path_text, snippet(search, 2, "", "", "…", 12), '
            '       bm25(search, 0.0, 4.0, 1.0), f.name, f.ext, f.size, '
            '       f.modified, f.content '
            'FROM search s JOIN files f ON f.path = s.path '
            'WHERE search MATCH ?' + ext_clause + under_clause +
            ' ORDER BY bm25(search, 0.0, 4.0, 1.0) LIMIT ?',
            [expression, *ext_args, *under_args, limit * 4],
        ).fetchall()

        for path, path_text, snip, score, name, ext, size, modified, kind in rows:
            entry = found.setdefault(path, {
                'path': path, 'name': name, 'ext': ext, 'size': size,
                'modified': modified, 'why': [], 'snippet': '', 'kind': kind,
                'score': 0.0,
            })
            entry['score'] += float(score or 0)
            if snip and not entry['snippet']:
                entry['snippet'] = snip.strip()[:200]
                entry['why'].append('OCR text' if kind == 'ocr' else 'text inside')
            if not entry['why'] and any(w in path_text.lower() for w in words):
                entry['why'].append('folder name')
            hit = [t for t in terms if t not in words
                   and t in (name + ' ' + (snip or '')).lower()]
            if hit and not any(w.startswith('also called') for w in entry['why']):
                entry['why'].append(f'also called "{hit[0]}"')

    matches = sorted(found.values(), key=lambda m: m['score'])
    for match in matches:
        match.pop('score', None)
        match.pop('kind', None)
        if not match['why']:
            match['why'] = ['matched']

    return {
        'query': query,
        'searched_for': terms,
        'restricted_to': extensions or None,
        'matches': matches[:limit],
        'total': len(matches),
        'index': store.stats(),
    }
