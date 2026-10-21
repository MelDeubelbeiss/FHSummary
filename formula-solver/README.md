# Formula Solver

A browser version of my old PyQt5 + sympy formula solver. Type in the quantities
you know, and everything that follows from the formulas is solved as you type.
No install, no Python, no sympy — one static page and a JSON file.

```
formula-solver/
├── index.html          page + embedded fallback copy of the formulas
├── css/app.css         design (light/dark, responsive, print view)
├── js/math.js          tokenizer, parser, evaluation, math typesetting
├── js/format.js        SI prefixes, number formatting, E series
├── js/solver.js        solving the system (rearrange / numeric / substitute)
├── js/store.js         load, save, import, export the JSON
├── js/app.js           user interface
└── data/
    ├── formulas.json          30 formula sets (default, English)
    ├── formulas-de.json       the same 30 sets in German
    └── formulas-aet1-de.json  the 7 sets from the original test.json
```

## Running it

Double-clicking `index.html` works — the formulas then come from the copy
embedded in `index.html`. To have `data/formulas.json` actually read from disk,
serve the folder:

```bash
python3 -m http.server 8777
```

Then open <http://localhost:8777>. The folder can be dropped onto any static
host (GitHub Pages, Netlify, …); there is no build step and no dependency.

## The JSON format

Unchanged from the Python version, German keys included, so files stay
interchangeable with it:

```json
{
  "Formelzeichen": ["R1", "R2", "Rges"],
  "Einheiten":     ["Ω", "Ω", "Ω"],
  "Name":          "Resistors in series",
  "Beschreibung":  ["Series resistor 1", "Series resistor 2", "Total resistance"],
  "Formeln":       ["Rges, R1 + R2"],
  "Untermenu":     "Fundamentals"
}
```

* `Untermenu` becomes the category in the sidebar — a new category exists as
  soon as some formula set names it.
* `Formeln` keep the format `target quantity, expression`. The first top-level
  comma separates the two sides (`=` works too), so commas inside brackets, as
  in `log(x, 10)`, are no problem. Which side the target is on does not matter.
* **Export** writes the file byte for byte the way
  `json.dump(..., indent=2, ensure_ascii=True)` would, so an exported
  `formulas.json` can go straight back into the old Python version as
  `test.json`.

Notation inside the formulas: `+ - * / ** ^`, brackets, `Pow(a, b)`, `sqrt`,
`log(x)` (natural) and `log(x, base)`, `exp`, `ln`, `sin cos tan asin acos atan
sinh cosh tanh`, `abs`, `deg`, `rad`, and the constants `pi`, `E`, `tau`.

## Editing formulas

Three equivalent ways:

1. **In the browser** — “Edit” or “+ New formula set”. Every formula is checked
   as you type and shown typeset. Changes are kept in the browser
   (localStorage); “Export” downloads the complete `formulas.json` to copy over
   the file in `data/`.
2. **Straight in `data/formulas.json`** — edit, reload the page, press
   “Reload file” (this discards the browser's local changes).
3. **Import** — drop a JSON file onto the window, or press “Import”. You are
   asked whether to merge (same `Name` + `Untermenu` is replaced) or to replace
   everything.

If you edit `data/formulas.json` by hand it is worth updating the embedded
fallback copy in `index.html` (`<script id="seed-data">`) as well — it is only
used when the page is opened without a web server.

## How it solves

The original used `sympy.solve(..., manual=True)`. `js/solver.js` does the same
job in three stages:

1. **Rearranging** — if the wanted quantity occurs exactly once in an equation,
   the expression tree is inverted exactly (`U = R·I` → `I = U/R`).
2. **Numeric** — if it occurs several times (`Rpara = R1·R2/(R1+R2)` solved for
   `R1`), the root is found by scanning a grid for sign changes and bisecting.
   Candidates are verified against the equation's own scale, so a sign change
   at a *pole* is never mistaken for a solution.
3. **Substitution** — when two unknowns are coupled across two equations (given
   `PR1`, wanted `R1`, with `Iges = Uin/(R1+R2)` and `PR1 = Iges²·R1`), one
   quantity is assumed, everything is worked out from it, and the equation left
   over is driven to zero. That closing equation has to actually depend on the
   assumption, otherwise the quantity is genuinely undetermined and is left
   open rather than filled with an arbitrary value.

Every step is listed under “Solution path”, with the equation that produced it.
Equations that do not fit the inputs are marked red as “contradictory”.
Ambiguous results (`±` from squares, periodic functions, or non-monotonic
relations) carry a `±` badge whose tooltip names the other solution; the
positive one is shown.

Quantities that cannot be determined simply stay empty — the status line says
how many are still open.

## Recalculating (the “Adjusted” column)

This is the old “Veränderbar / Konstant / E6 / E12 / E24” idea, made a bit more
practical:

| Mode | Meaning in the second pass |
|---|---|
| `automatic` | what you typed stays, computed values may adapt |
| `hold` | keep this value, even if it was computed |
| `release` | let go of your own input as well |
| `E6 … E96` | round to the nearest standard value and hold it |

As soon as one row is set to anything other than `automatic`, the “Adjusted”
column appears: the whole set solved again with the rounded or held values.
Unchanged values are dimmed. If that over-determines the set, the status line
says so — then set a dependent quantity to `release`.

## Using it

* Numbers with `.` or `,`, scientific (`4.7e3`), or with the prefix typed into
  the field (`4k7`, `2m`, `100n`). Otherwise pick the prefix next to the field.
* `/` jumps to the search, `↑`/`↓` move between input fields, `Esc` closes
  dialogs.
* Clicking a result copies it.
* The address bar points at the selected set (`#/Fundamentals/Ohm's law and
  power`), so it can be bookmarked.
* Light/dark via the moon icon; `Ctrl+P` prints the current calculation without
  the sidebar.

## Differences from the Python version

* It solves while you type instead of waiting for an OK button.
* Results no longer overwrite the input fields — your input (amber) and the
  result (green) stay visible side by side.
* The first pass does not round anything; E-series rounding only happens in the
  “Adjusted” column.
* E-series rounding picks the nearest standard value logarithmically (the old
  loop could pick the wrong neighbour), and E48/E96 were added.
* `dB`, `°C` and similar units no longer get SI prefixes (no more `mdB`).
* The formula data ships in English; `data/formulas-de.json` keeps the original
  German wording and can be imported at any time.
