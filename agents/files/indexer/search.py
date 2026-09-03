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


def name_tokens(name: str) -> list:
    """
    A filename as the words a person would say it contains.

    `facebook-ui-redesign.png` is facebook, ui, redesign, png.
    `watch-quicklook-38@2x.png` is watch, quicklook, 38, 2x, png — and
    critically, **not** "ui", even though the letters are sitting there in
    the middle of "quicklook".

    That was a real result: asked for `ui.png`, the search returned three
    Apple Watch icons, because `LIKE '%ui%'` is happy to match inside a word.
    Splitting on separators and case changes is what makes "ui" a word rather
    than a substring.
    """
    return [piece.lower() for piece in WORD.findall(name)]


# One word of a filename.
#
# The alternation is ordered, and the order is the whole trick:
#
#   [A-Z]+(?![a-z])   a run of capitals not starting a word -- the "UI" in
#                     `MyUIFile`, which a plain lower-to-upper rule misses
#                     because there is no lowercase letter before the F
#   [A-Z][a-z]*       an ordinary capitalised word
#   [a-z]+ | [0-9]+   the rest
WORD = re.compile(r'[A-Z]+(?![a-z])|[A-Z][a-z]*|[a-z]+|[0-9]+')


# How well a filename matches one search word. Lower is better, to match bm25.
#
# The gap between the bands is deliberately wide. These are different kinds of
# answer, not degrees of one, and a file whose name *is* the query should never
# be crowded by a file that merely contains the letters.
EXACT_STEM = -1000     # `UI.png` for "ui" — this is the file
WORD_IN_NAME = -300    # `facebook-ui-redesign.png` — "ui" is one of its words
PREFIX_OF_WORD = -120  # `uicomponents.png` — a word starts with it
BURIED = -8            # "ui" inside "quicklook" — almost certainly a coincidence

# Content matches live on the same scale, so one relevance cutoff can weigh a
# filename match against a text match. They were being added raw from bm25,
# which ranges over single digits — next to a name score of -1000 that is
# indistinguishable from no match at all, and an Aadhaar card found only by the
# word printed on it would have been cut as noise.
CONTENT_HIT = -250     # the words inside the file matched
FOLDER_HIT = -60       # only the folder path matched, which is a weak signal

# How far below the best a result may be and still be worth showing.
#
# Asked for `ui.png`, the search returned five results: the file itself, one
# file with "ui" as a word in its name, and three Apple Watch icons whose only
# claim was the "ui" inside "quicklook". All five were labelled "filename",
# which made a list of two answers and three coincidences look like a list of
# five answers.
#
# A ratio rather than a fixed floor, because it has to mean the same thing for
# a query with a perfect hit and one with only weak ones: when nothing matches
# well, the weak matches are the answer and are all shown.
RELEVANCE_FLOOR = 0.08

# How many filename candidates to score per word.
#
# Generous, because scoring happens in Python and the SQL can only order by a
# proxy. Measured at about a fifth of a second on a 130,000-file index, which
# is worth paying to stop a limit from deciding the answer.
NAME_CANDIDATES = 400


def name_score(name: str, word: str) -> float:
    """
    How strongly this filename answers this word.

    Weighted by how much of the name the match accounts for. Both
    `chethankrishna_resume_new.pdf` and `AudioFocusResumePolicyTest.kt` have
    "resume" as one of their words, so on the bands alone they tie — but it is
    one word in three against one in six, and the first is far more likely to
    be what someone asking for "my resume" meant.
    """
    lowered = name.lower()
    stem = lowered.rsplit('.', 1)[0]
    if stem == word:
        return EXACT_STEM

    tokens = name_tokens(name)
    # Floored rather than unbounded, so a long name is ranked lower and not
    # dismissed. The floor was a half to begin with, which clamped a four-word
    # name and a six-word one to the same value and left
    # `AudioFocusResumePolicyTest.kt` tied with `chethankrishna_resume_new.pdf`
    # on a search for "my resume".
    share = max(0.25, 2.0 / (1 + len(tokens)))

    if word in tokens:
        return WORD_IN_NAME * share
    if any(token.startswith(word) for token in tokens):
        return PREFIX_OF_WORD * share
    return BURIED if word in lowered else 0.0


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


def groups_of(words: list, extra: list | None = None) -> list:
    """
    Each search word together with the other names it goes by.

    Grouped rather than flattened because "aadhar" and "aadhaar" are one idea
    and must count as one requirement, not two. A file matching either has
    matched the thing the owner asked for.
    """
    out = []
    for word in words:
        group = [word] + [t for t in ALSO_MEANS.get(word, []) if t != word]
        out.append(group)
    if extra:
        out.append([str(t).strip().lower() for t in extra if str(t).strip()])
    return [g for g in out if g]


def how_common(conn, group: list) -> int:
    """
    How many files this word appears in the name of.

    The point of asking is that query words are not equally selective. In
    "aadhar card", "aadhar" names three files on this machine and "card" names
    five hundred — every Dart and Kotlin card widget in every project. Treating
    them as equal claims is what put `animated_card.dart` in a list of Aadhaar
    cards.

    Counted as *tokens*, through the full-text index, not as substrings.
    That distinction decided the answer here: "uid" appears inside 175
    filenames on this machine and is a word in none of them - it is the
    middle of "guide" and "build". Counted as substrings the Aadhaar group
    looked more common than "card", so the filter kept the card widgets and
    dropped the cards.
    """
    total = 0
    for term in group:
        if ' ' in term:
            continue  # a phrase is for the content pass, not for filenames
        try:
            row = conn.execute(
                'SELECT COUNT(*) FROM search WHERE search MATCH ?',
                (f'path_text : {term}',),
            ).fetchone()
        except Exception:  # noqa: BLE001 - a term FTS cannot parse is not a crash
            continue
        total += row[0] if row else 0
    return total


def only_answers_a_common_word(entry: dict, key: set) -> bool:
    """
    Whether this result matched none of the query's distinctive words.

    `animated_card.dart` matched "card" and nothing else, while the query's
    distinctive word was "aadhar". It is not a worse answer to the question —
    it is an answer to a different one.
    """
    return not (entry.get('matched') or set()) & key


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

    # The query's most distinctive word, decided by how many filenames carry
    # it rather than by a list of words to ignore. What is generic depends on
    # the disk: "card" is noise on a machine full of Flutter projects and is
    # not on someone else's.
    groups = groups_of(words, extra_terms)
    key_group: set = set()
    if len(groups) > 1:
        rarest = min(groups, key=lambda g: how_common(conn, g))
        key_group = set(rarest)

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
            # Shortest names first, and only then a limit.
            #
            # There was no ordering here, so `LIMIT` took whichever rows the
            # scan reached first: on a word matching 4,591 files, one of the
            # two copies of `UI.png` simply fell outside the window and the
            # search reported one when there were two. A limit without an
            # order is a random sample.
            #
            # Length is the right proxy: a file whose name *is* the word is
            # the shortest name that can contain it, so the strongest matches
            # are exactly the ones this keeps.
            ' ORDER BY length(f.name) LIMIT ?',
            [f'%{word}%', *ext_args, *under_args, NAME_CANDIDATES],
        ).fetchall()
        for path, name, ext, size, modified, kind in rows:
            gain = name_score(name, word)
            if gain == 0.0:
                continue

            entry = found.setdefault(path, {
                'path': path, 'name': name, 'ext': ext, 'size': size,
                'modified': modified, 'why': [], 'snippet': '', 'kind': kind,
                'score': 0.0,
            })
            entry['score'] += gain
            entry.setdefault('matched', set()).add(word)

            # Say which kind of name match it was, because "filename" on both
            # `UI.png` and `watch-quicklook-38@2x.png` is what made a list of
            # coincidences look like a list of answers.
            label = (
                'exact name' if gain == EXACT_STEM
                else 'name contains it' if gain == BURIED
                else 'filename'
            )
            if label not in entry['why']:
                entry['why'].append(label)

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

            # Tokens, for the same reason `how_common` counts them: "uid" is
            # inside "guide", and a substring test here let `card.png` under
            # `flutter-widget-positioning-guide` claim it had matched the
            # query's distinctive word.
            haystack = set(name_tokens(name)) | set(name_tokens(path_text))
            body_text = (snip or '').lower()
            for term in terms:
                if ' ' in term:
                    if term in body_text:
                        entry.setdefault('matched', set()).add(term)
                elif term in haystack or term in set(name_tokens(body_text)):
                    entry.setdefault('matched', set()).add(term)

            # bm25 as the tiebreaker within a band, not as the score itself.
            if snip and snip.strip():
                if not entry['snippet']:
                    entry['snippet'] = snip.strip()[:200]
                    entry['why'].append('OCR text' if kind == 'ocr' else 'text inside')
                entry['score'] += CONTENT_HIT + float(score or 0)
            elif not entry['why']:
                if any(w in path_text.lower() for w in words):
                    entry['why'].append('folder name')
                entry['score'] += FOLDER_HIT + float(score or 0)
            hit = [t for t in terms if t not in words
                   and t in (name + ' ' + (snip or '')).lower()]
            if hit and not any(w.startswith('also called') for w in entry['why']):
                entry['why'].append(f'also called "{hit[0]}"')

    ranked = sorted(found.values(), key=lambda m: m['score'])

    # Results that answer only the common word go first, before the score
    # cutoff — a file whose name *is* "card" scores well on a query about
    # Aadhaar cards, and no amount of score arithmetic separates it from a
    # real answer. Skipped when nothing matched the distinctive word, because
    # then these are all there is.
    dropped = 0
    if key_group:
        strong = [m for m in ranked if not only_answers_a_common_word(m, key_group)]
        if strong:
            dropped = len(ranked) - len(strong)
            ranked = strong

    kept, weak = cut_off(ranked)
    matches, dropped = kept, dropped + weak

    for match in matches:
        match.pop('score', None)
        match.pop('kind', None)
        match.pop('matched', None)
        if not match['why']:
            match['why'] = ['matched']

    return {
        'query': query,
        'searched_for': terms,
        'restricted_to': extensions or None,
        'matches': matches[:limit],
        'total': len(matches),
        # Said rather than hidden. "5 files found" that silently meant "2 good
        # ones and 3 coincidences" is the failure; "2 found, 3 weaker ones not
        # shown" is an answer the owner can act on.
        'also_matched_weakly': dropped,
        'index': store.stats(),
    }


def cut_off(ranked: list) -> tuple:
    """
    Keep the results that answer the question; count the rest.

    Everything within `RELEVANCE_FLOOR` of the best result stays. When the best
    result is strong that cuts hard — an exact filename match at -1000 keeps
    anything at -80 or better and drops a coincidental substring at -8. When
    nothing matches well it cuts nothing, because then the weak matches are all
    there is and hiding them would be answering "not found" to a question that
    did find something.
    """
    if not ranked:
        return [], 0

    best = ranked[0]['score']
    if best >= 0:
        return ranked, 0

    threshold = best * RELEVANCE_FLOOR
    kept = [m for m in ranked if m['score'] <= threshold]
    return kept, len(ranked) - len(kept)
