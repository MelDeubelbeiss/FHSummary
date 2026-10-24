#!/usr/bin/env python3
"""Copy data/formulas.json into the fallback copy inside index.html.

index.html carries a <script id="seed-data"> copy of the formula database so
the page still works when it is opened straight from the file system, where
fetch() is not allowed. That copy has to be kept in step with the real file.

    python3 tools/sync-seed.py           update index.html
    python3 tools/sync-seed.py --check   only report, exit 1 if out of step

Run it after editing data/formulas.json by hand.
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, 'data', 'formulas.json')
PAGE = os.path.join(ROOT, 'index.html')
OPEN_TAG = '<script type="application/json" id="seed-data">'
CLOSE_TAG = '</script>'


def read(path):
    with open(path, encoding='utf-8') as fh:
        return fh.read()


def seed_bounds(html):
    start = html.find(OPEN_TAG)
    if start < 0:
        sys.exit('index.html has no <script id="seed-data"> block')
    start += len(OPEN_TAG)
    end = html.find(CLOSE_TAG, start)
    if end < 0:
        sys.exit('the seed block in index.html is never closed')
    return start, end


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--check', action='store_true',
                    help='do not write, exit 1 when the copy is stale')
    args = ap.parse_args()

    data = read(DATA)
    sets = json.loads(data)          # fails loudly on a broken file
    html = read(PAGE)
    start, end = seed_bounds(html)

    try:
        embedded = json.loads(html[start:end])
    except ValueError:
        embedded = None

    if embedded == sets:
        print('seed is up to date (%d formula sets)' % len(sets))
        return 0

    if args.check:
        print('seed in index.html is STALE - run: python3 tools/sync-seed.py')
        return 1

    with open(PAGE, 'w', encoding='utf-8') as fh:
        fh.write(html[:start] + '\n' + data.strip() + '\n' + html[end:])
    print('seed updated from data/formulas.json (%d formula sets)' % len(sets))
    return 0


if __name__ == '__main__':
    sys.exit(main())
