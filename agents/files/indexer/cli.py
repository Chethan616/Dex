"""
The index, as a command.

Core is Node and the indexer is Python, so something has to cross that line.
This is the whole surface, deliberately small: one JSON object out per call, on
stdout, and nothing else — so the Node side parses a document rather than
scraping a log.

    python -m indexer.cli search "aadhaar card" --limit 20 --scope pc
    python -m indexer.cli crawl --scope profile
    python -m indexer.cli stats

Errors come back as `{"error": ...}` with exit 1 rather than a traceback on
stdout, because a traceback there is a parse failure at the caller and the real
message gets lost.
"""
from __future__ import annotations

import argparse
import json
import sys

# Importable both as `python -m indexer.cli` from agents/files and as a script.
if __package__ in (None, ''):
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from indexer import crawl as crawl_mod, extract, search as search_mod, store
else:
    from . import crawl as crawl_mod, extract, search as search_mod, store


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(prog='indexer')
    sub = parser.add_subparsers(dest='command', required=True)

    find = sub.add_parser('search')
    find.add_argument('query')
    find.add_argument('--limit', type=int, default=25)
    find.add_argument('--under', default=None,
                      help='restrict to a folder, e.g. the Desktop')
    find.add_argument('--term', action='append', default=[],
                      help='an extra word the caller knows this file may be called')

    run = sub.add_parser('crawl')
    run.add_argument('--scope', default='profile', help="'pc', 'profile', or a path")
    run.add_argument('--no-contents', action='store_true',
                     help='index names only — a fast first pass')

    sub.add_parser('stats')

    args = parser.parse_args(argv)

    try:
        if args.command == 'search':
            out = search_mod.search(
                args.query, limit=args.limit,
                extra_terms=args.term, under=args.under,
            )
        elif args.command == 'crawl':
            # Progress on stderr: stdout carries the one JSON document and
            # nothing may interleave with it.
            def progress(seen: int, indexed: int) -> None:
                print(f'{seen} seen, {indexed} indexed', file=sys.stderr, flush=True)

            out = crawl_mod.crawl(
                scope=args.scope, on_progress=progress,
                read_contents=not args.no_contents,
            )
        else:
            out = {**store.stats(), 'ocr_available': extract.ocr_available()}
    except Exception as exc:  # noqa: BLE001 - the caller needs the message, not a trace
        json.dump({'error': str(exc)}, sys.stdout)
        return 1

    json.dump(out, sys.stdout, default=str)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
