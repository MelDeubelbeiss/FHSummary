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
├── js/recalc.js        default recalculation rules (per unit or symbol)
├── js/solver.js        solving the system (rearrange / numeric / substitute)
├── js/store.js         load, save, import, export the JSON
├── js/app.js           user interface
├── tests.html          test suite — open it in the browser
├── tools/sync-seed.py  refresh the fallback copy inside index.html
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

If you edit `data/formulas.json` by hand, refresh the fallback copy embedded
in `index.html` afterwards — it is what the page falls back on when opened
without a web server:

```bash
python3 tools/sync-seed.py          # update it
python3 tools/sync-seed.py --check  # just report, exits 1 when stale
```

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

**Where it stops.** It solves one unknown at a time, plus one assumed unknown
in the substitution pass. A system that only gives way to *two* simultaneous
assumptions is out of reach — three equations each holding the same three
unknowns, say. Star/delta is exactly that shape, which is why the set carries
the reverse formulas explicitly rather than relying on the solver to invert
them. If a set of yours only works in one direction, writing the reverse
formula into the JSON is the fix.

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

### Setting whole groups at once

Setting eight rows by hand gets old fast, so the bar above the table groups the
quantities **by unit** — the unit is what tells a resistor from a capacitor:

```
RECALCULATE   Ω 2 [E24 ▾]  F 1 [E12 ▾]  V 2 [automatic ▾]      Real parts | All automatic | ⚙
```

* Each chip sets every quantity carrying that unit in one go. The count tells
  you how many rows it covers, hovering lists their symbols. A chip whose rows
  disagree shows `mixed` and a dashed border.
* **Real parts** applies the whole default rule set in one click — out of the
  box: Ω → E24, F → E12, H → E12, everything else → automatic.
* **All automatic** puts everything back.
* **⚙** edits the rules.

Why is the fallback `automatic` rather than `release`? Releasing *everything*
else also throws away the excitation you typed — supply voltage, time — and
then there is nothing left to recompute from and the Adjusted column comes up
empty. `automatic` keeps your inputs and lets the derived quantities follow the
rounded parts, which is almost always what you want. Set the few quantities
that really should move to `release` individually.

### Default rules, and storing them in the JSON

A rule maps a **unit** (`Ω`, `F`, `H`) or a single **symbol** (`RA`, `C1`) onto
a mode, with `*` as the fallback for everything else. Symbols beat units, units
beat `*`. The ⚙ dialog edits them and can save them in two places:

* **Save as my default** — kept in the browser, used for every formula set.
* **Store in this set** — written into the formula set as an optional
  `"Recalc"` field, so it travels with the JSON and survives an export:

```json
{
  "Formelzeichen": ["RA", "RB", "C", "f"],
  "Einheiten":     ["Ω", "Ω", "F", "Hz"],
  "Name":          "NE555 astable",
  "Beschreibung":  ["Resistance", "Resistance", "Capacitor", "Frequency"],
  "Formeln":       ["0.69 * (RA + RB) * C, ti"],
  "Untermenu":     "NE555",
  "Recalc":        { "Ω": "e24", "F": "e12", "*": "auto" }
}
```

Eight of the shipped sets carry such a field, the ones where picking real
parts is the whole point: both NE555 timers, the three op-amp filters, the LED
series resistor, the LM317 and the Schmitt trigger oscillator. Open **NE555
astable**, ask for 1 kHz at 60 % duty with a 10 nF cap, and the Adjusted column
answers straight away what E24 resistors really give you — 1.021 kHz at 60.6 %.

Note how those rules differ in their fallback, because the circuits do. For the
timers and filters the parts fix everything, so `*` is `free` and the targets
you typed are allowed to move. For the LED resistor and the LM317 the supply
voltage has to stay put, so `*` is `auto` and only the one quantity the
resistor actually shifts is released by name (`"IF": "free"`, `"Uout": "free"`)
— a symbol rule overriding the unit rule above it.

`Recalc` is the only addition to the original schema and it is optional — the
Python version ignores unknown keys, so files stay interchangeable either way.
A set that carries it opens with those modes already applied. The browser-wide
default only applies on opening when “Apply automatically” is ticked in the
dialog; otherwise it waits behind the **Real parts** button.

Which rules are in force is shown in the dialog (“Currently using this formula
set / your global default / the built-in default”) and in the tooltip of the
**Real parts** button.

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

## Tests

`tests.html` is the test suite. Serve the folder and open it — no framework, no
install, it loads the same modules the app does and reads the real
`data/formulas.json`:

```bash
python3 -m http.server 8777     # then open http://localhost:8777/tests.html
```

91 checks over the parser, number formatting, the E series, all three solver
strategies, the shipped data and the export format. Two of them are sweeps over
the whole database:

* **swap one given for one result** — for every set, solve it forwards, then
  hand back one computed value in exchange for one of the inputs and check the
  answer still satisfies every equation. 111 cases; 16 come back
  underdetermined, which is correct, not a failure.
* **ask for every driving quantity at once** — hands over everything the
  formulas derive and asks for the inputs back. This is the sweep that would
  have caught the missing delta→star formulas: a set that only runs one way
  shows up in the "not recoverable" list at the bottom of the page. Most
  entries there are legitimate (you cannot get two resistors back out of one
  total), so read it as a hint, not a verdict.

Several checks exist because something was once wrong: a pole mistaken for a
root, a closing equation that was satisfied for any value and happily
"confirmed" 1 pΩ, SI prefixes on decibels. Those keep their notes in the page
so the reason survives.
