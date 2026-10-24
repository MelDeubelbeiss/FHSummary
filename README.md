# FHSummary

Study material and small tools from my engineering degree — reference sheets,
calculators and whatever else turns out to be worth keeping.

Published at **<https://meldeubelbeiss.github.io/FHSummary/>** — everything is
static, so the pages run straight from the browser with no build step.

## Contents

| Folder | What it is |
|---|---|
| [`formula-solver/`](formula-solver/) | Web app: enter the quantities you know, it solves the rest from a set of formulas. Electronics formulary with 30 formula sets, editable as plain JSON. |

## formula-solver

A browser rewrite of an old PyQt5 + sympy desktop tool. The formulas live in
`formula-solver/data/formulas.json` and nothing else is needed — no build step,
no dependencies, one static page.

```bash
cd formula-solver && python3 -m http.server 8777
```

Then open <http://localhost:8777>, or just double-click `index.html`.

It rearranges equations exactly where it can, falls back to numeric root
finding, and resorts to substitution for coupled unknowns — showing the
solution path it took. E6…E96 rounding lets you see what happens with real
component values. Tests live in `formula-solver/tests.html`; open it in the
browser from the same server. See
[`formula-solver/README.md`](formula-solver/README.md) for the format and the
details.

## Licence

[MIT](LICENSE) — © 2026 Melvin Deubelbeiss. Use it, fork it, build on it; it
comes with no warranty. The licence covers the code in this repository, which
is written from scratch and has no third-party dependencies.
