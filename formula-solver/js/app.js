/* app.js - user interface of Formula Solver 3.0 */
(function (NS) {
  'use strict';

  var M = NS.math, F = NS.format, S = NS.store, SOLVER = NS.solver, RC = NS.recalc;

  /* Mode for the second pass ("recalculate"):
   *   auto      - typed values stay, computed ones may adapt
   *   free      - release the typed value as well
   *   const     - hold the value, even if it was computed
   *   e6 .. e96 - round to the preferred-number series and hold         */
  var MODES = [
    { id: 'auto', label: 'automatic' },
    { id: 'const', label: 'hold' },
    { id: 'free', label: 'release' },
    { id: 'e6', label: 'E6' },
    { id: 'e12', label: 'E12' },
    { id: 'e24', label: 'E24' },
    { id: 'e48', label: 'E48' },
    { id: 'e96', label: 'E96' }
  ];

  var app = {
    current: null,      /* raw formula set from the store */
    compiled: null,     /* compiled set */
    rows: {},           /* state per symbol */
    memory: {},         /* remembered inputs per set */
    collapsed: {},      /* collapsed categories */
    editTarget: null
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function keyOf(set) { return set.Untermenu + '\u0000' + set.Name; }

  /* ===================================================================== */
  /* Navigation                                                            */
  /* ===================================================================== */

  function matches(set, q) {
    if (!q) return true;
    var hay = [set.Name, set.Untermenu]
      .concat(set.Formelzeichen, set.Beschreibung, set.Formeln)
      .join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  function renderNav() {
    var q = $('#search').value.trim();
    var nav = $('#nav');
    nav.innerHTML = '';
    var cats = S.categories();
    var shown = 0;

    cats.forEach(function (cat) {
      var sets = S.setsOf(cat).filter(function (s) { return matches(s, q); });
      if (!sets.length) return;
      shown += sets.length;

      var group = el('div', 'nav-group' + (app.collapsed[cat] && !q ? ' collapsed' : ''));
      var head = el('button', 'nav-cat');
      head.innerHTML = '<span class="chev">▾</span><span>' + M.esc(cat) +
        '</span><span class="cat-count">' + sets.length + '</span>';
      head.addEventListener('click', function () {
        app.collapsed[cat] = !app.collapsed[cat];
        group.classList.toggle('collapsed');
        saveUi();
      });
      group.appendChild(head);

      var items = el('div', 'nav-items');
      sets.forEach(function (set) {
        var b = el('button', 'nav-item' + (app.current === set ? ' active' : ''));
        b.innerHTML = '<span class="ni-name">' + M.esc(set.Name) + '</span>' +
          '<span class="ni-meta">' + set.Formelzeichen.length + '·' + set.Formeln.length + '</span>';
        b.title = set.Formelzeichen.join(', ');
        b.addEventListener('click', function () { selectSet(set, true); closeSidebar(); });
        items.appendChild(b);
      });
      group.appendChild(items);
      nav.appendChild(group);
    });

    if (!shown) {
      nav.appendChild(el('div', 'nav-empty',
        q ? 'Nothing found for<br><b>' + M.esc(q) + '</b>' : 'No formulas loaded.'));
    }
    $('#source-line').innerHTML = S.state.sets.length + ' formula sets · source: ' +
      M.esc(S.state.source) + (S.state.dirty ? ' <b>(edited)</b>' : '');
  }

  /* ===================================================================== */
  /* Start page                                                            */
  /* ===================================================================== */

  function renderWelcome() {
    $('#crumb-cat').textContent = '';
    $('#crumb-sep').style.display = 'none';
    $('#crumb-name').textContent = 'Formula Solver';
    $('#btn-edit').disabled = true;
    $('#btn-reset').disabled = true;

    var wrap = el('div', 'welcome');
    /* One set per category, so the range on offer is visible. */
    var picks = S.categories().slice(0, 6).map(function (cat) { return S.setsOf(cat)[0]; })
      .filter(Boolean);
    if (picks.length < 6) picks = S.state.sets.slice(0, 6);
    wrap.innerHTML =
      '<div class="wmark">ƒ</div>' +
      '<h1>Enter what you know, get the rest</h1>' +
      '<p>Pick a formula set on the left and type in the quantities you have — everything that ' +
      'follows from them is solved as you type. The formulas themselves live in ' +
      '<code class="mono">data/formulas.json</code> and can be edited right here.</p>';
    var grid = el('div', 'wgrid');
    picks.forEach(function (set) {
      var c = el('div', 'wcard');
      c.innerHTML = '<div class="wc-cat">' + M.esc(set.Untermenu) + '</div>' +
        '<div class="wc-name">' + M.esc(set.Name) + '</div>' +
        '<div class="wc-syms">' + M.esc(set.Formelzeichen.join(' · ')) + '</div>';
      c.addEventListener('click', function () { selectSet(set, true); });
      grid.appendChild(c);
    });
    wrap.appendChild(grid);
    var steps = el('ol', 'wsteps');
    steps.innerHTML =
      '<li><b>Enter values</b> — pick the prefix (k, m, µ …) in the field next to it, or type ' +
      '<code>4k7</code> directly.</li>' +
      '<li><b>Read off</b> — solved quantities appear immediately, with the full solution path below.</li>' +
      '<li><b>Recalculate</b> — set a quantity to <code>E12</code> or <code>hold</code>: the ' +
      '«Adjusted» column shows what you get with real component values.</li>';
    wrap.appendChild(steps);

    var content = $('#content');
    content.innerHTML = '';
    content.appendChild(wrap);
  }

  /* ===================================================================== */
  /* Showing a formula set                                                 */
  /* ===================================================================== */

  function selectSet(set, pushHash) {
    if (app.current && app.compiled) saveMemory();
    app.current = set;
    app.compiled = SOLVER.compileSet(set);
    app.rows = {};

    /* Modes come from what was set earlier in this session, otherwise from
     * the set's own "Recalc" rules (or the global default, if switched on). */
    var mem = app.memory[keyOf(set)] || {};
    var preset = RC.appliesOnOpen(set) ? RC.rulesFor(set).rules : null;
    app.compiled.symbols.forEach(function (sym, i) {
      var m = mem[sym] || {};
      app.rows[sym] = {
        text: m.text || '',
        prefixExp: typeof m.prefixExp === 'number' ? m.prefixExp : 0,
        mode: m.mode || (preset ? RC.modeFor(preset, sym, app.compiled.units[i]) : 'auto')
      };
    });

    if (pushHash) location.hash = '#/' + encodeURIComponent(set.Untermenu) + '/' + encodeURIComponent(set.Name);
    try { localStorage.setItem('formulasolver.last', keyOf(set)); } catch (e) {}

    renderNav();
    renderSet();
  }

  /* Drops the remembered modes (but keeps typed values), so freshly saved
   * default rules are not shadowed by what was set earlier this session. */
  function forgetModes(key) {
    Object.keys(app.memory).forEach(function (k) {
      if (key && k !== key) return;
      var store = app.memory[k];
      Object.keys(store).forEach(function (sym) { delete store[sym].mode; });
    });
    if (!key || (app.current && key === keyOf(app.current))) {
      Object.keys(app.rows).forEach(function (sym) { app.rows[sym].mode = 'auto'; });
    }
  }

  function saveMemory() {
    if (!app.current) return;
    var store = {};
    Object.keys(app.rows).forEach(function (s) {
      var r = app.rows[s];
      if (r.text || r.prefixExp || r.mode !== 'auto') {
        store[s] = { text: r.text, prefixExp: r.prefixExp, mode: r.mode };
      }
    });
    app.memory[keyOf(app.current)] = store;
  }

  function renderSet() {
    var c = app.compiled;
    $('#crumb-cat').textContent = c.category;
    $('#crumb-sep').style.display = '';
    $('#crumb-name').textContent = c.name;
    $('#btn-edit').disabled = false;
    $('#btn-reset').disabled = false;

    var content = $('#content');
    content.innerHTML = '';

    /* --- Formulas --------------------------------------------------- */
    var eqPanel = el('section', 'panel');
    var head = el('div', 'panel-head');
    head.innerHTML = '<h2 class="panel-title">Formulas</h2>' +
      '<span class="pill">' + c.equations.length + '</span>' +
      '<span class="spacer"></span>' +
      '<span class="pill">' + c.symbols.length + ' quantities</span>';
    eqPanel.appendChild(head);

    var list = el('div', 'eq-list');
    list.id = 'eq-list';
    c.equations.forEach(function (eq, i) {
      var card = el('div', 'eq-card' + (eq.error ? ' broken' : ''));
      card.dataset.eq = String(i);
      var inner = '<span class="eq-index">' + (i + 1) + '</span>';
      if (eq.error) {
        inner += '<span class="eq-math"><span class="eq-raw">' + M.esc(eq.text) + '</span></span>' +
          '<span class="eq-error">⚠ ' + M.esc(eq.error) + '</span>';
      } else {
        inner += '<span class="eq-math math">' + M.renderEquation(eq) + '</span>' +
          '<span class="eq-badge" style="display:none"></span>';
      }
      card.innerHTML = inner;
      card.title = eq.text;
      list.appendChild(card);
    });
    eqPanel.appendChild(list);
    content.appendChild(eqPanel);

    if (c.problems.length) {
      var warn = el('div', 'notice warn');
      warn.innerHTML = '<span>⚠</span><span>' + c.problems.map(function (p) {
        return M.esc(p.message);
      }).join('<br>') + '</span>';
      content.appendChild(warn);
    }

    /* --- Values ----------------------------------------------------- */
    var varPanel = el('section', 'panel vars');
    var vhead = el('div', 'panel-head');
    vhead.innerHTML = '<h2 class="panel-title">Values</h2><span class="spacer"></span>' +
      '<button class="btn btn-ghost sm" id="btn-clear">Clear inputs</button>';
    varPanel.appendChild(vhead);

    varPanel.appendChild(buildBulkBar());

    var table = el('div', 'vtable');
    table.id = 'vtable';
    var th = el('div', 'vrow vhead');
    th.innerHTML = '<div>Symbol</div><div>Description</div><div>Input</div>' +
      '<div>Recalculate</div><div style="text-align:right">Result</div>' +
      '<div class="vcol-adj" style="text-align:right">Adjusted</div>';
    table.appendChild(th);

    c.symbols.forEach(function (sym, i) {
      table.appendChild(buildRow(sym, c.units[i] || '', c.descriptions[i] || '', i));
    });
    varPanel.appendChild(table);

    var status = el('div', 'status');
    status.id = 'status';
    varPanel.appendChild(status);
    content.appendChild(varPanel);

    /* --- Solution path ---------------------------------------------- */
    var stepPanel = el('section', 'panel');
    stepPanel.id = 'step-panel';
    stepPanel.style.display = 'none';
    stepPanel.innerHTML = '<div class="panel-head"><h2 class="panel-title">Solution path</h2>' +
      '<span class="spacer"></span><span class="pill" id="step-count"></span></div>' +
      '<ol class="steps" id="step-list"></ol>';
    content.appendChild(stepPanel);

    $('#btn-clear').addEventListener('click', resetInputs);
    syncModeControls();
    recompute();
  }

  /* --------------------------------------------------------------------- */
  /* Bulk controls: set a whole group of quantities at once                  */
  /* --------------------------------------------------------------------- */

  /* Groups the quantities of the current set by unit, in table order. */
  function unitGroups() {
    var groups = [], byUnit = {};
    app.compiled.symbols.forEach(function (sym, i) {
      var unit = app.compiled.units[i] || '';
      if (!byUnit[unit]) {
        byUnit[unit] = { unit: unit, symbols: [] };
        groups.push(byUnit[unit]);
      }
      byUnit[unit].symbols.push(sym);
    });
    return groups;
  }

  function buildBulkBar() {
    var bar = el('div', 'bulkbar');
    bar.id = 'bulkbar';
    bar.appendChild(el('span', 'bulk-label', 'Recalculate'));

    var groups = el('div', 'bulk-groups');
    unitGroups().forEach(function (g) {
      var chip = el('label', 'bulk-group');
      chip.title = g.symbols.join(', ');
      chip.innerHTML = '<span class="bg-unit">' + (g.unit ? M.esc(g.unit) : '—') +
        '</span><span class="bg-count">' + g.symbols.length + '</span>';

      var sel = el('select');
      var mixed = el('option');
      mixed.value = '';
      mixed.textContent = 'mixed';
      sel.appendChild(mixed);
      MODES.forEach(function (m) {
        var o = el('option');
        o.value = m.id;
        o.textContent = m.label;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () {
        if (!sel.value) return;
        setModes(g.symbols, sel.value);
      });
      chip.appendChild(sel);
      chip.dataset.unit = g.unit;
      groups.appendChild(chip);
    });
    bar.appendChild(groups);

    var actions = el('div', 'bulk-actions');

    var rules = RC.rulesFor(app.current);
    var apply = el('button', 'btn sm', 'Real parts');
    apply.id = 'btn-real-parts';
    apply.title = 'Apply the default rules: ' + describeRules(rules.rules) +
      '\n(from ' + sourceLabel(rules.source) + ')';
    apply.addEventListener('click', function () { applyRules(rules.rules); });
    actions.appendChild(apply);

    var none = el('button', 'btn btn-ghost sm', 'All automatic');
    none.addEventListener('click', function () {
      setModes(app.compiled.symbols, 'auto');
    });
    actions.appendChild(none);

    var gear = el('button', 'btn btn-ghost sm icon', '⚙');
    gear.title = 'Edit the default recalculation rules';
    gear.addEventListener('click', openRulesDialog);
    actions.appendChild(gear);

    bar.appendChild(actions);
    return bar;
  }

  function sourceLabel(src) {
    if (src === 'set') return 'this formula set';
    if (src === 'global') return 'your global default';
    return 'the built-in default';
  }

  function describeRules(rules) {
    return Object.keys(rules).map(function (k) {
      return (k === '*' ? 'everything else' : k) + ' → ' + labelOfMode(rules[k]);
    }).join(', ');
  }

  function labelOfMode(id) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return MODES[i].label;
    return id;
  }

  function setModes(symbols, mode) {
    symbols.forEach(function (sym) {
      if (app.rows[sym]) app.rows[sym].mode = mode;
    });
    syncModeControls();
    recompute();
  }

  function applyRules(rules) {
    app.compiled.symbols.forEach(function (sym, i) {
      app.rows[sym].mode = RC.modeFor(rules, sym, app.compiled.units[i]);
    });
    syncModeControls();
    recompute();
  }

  /* Pushes app.rows back into the row selects and the group chips. */
  function syncModeControls() {
    var table = $('#vtable');
    if (!table) return;
    app.compiled.symbols.forEach(function (sym) {
      var row = table.querySelector('.vrow[data-sym="' + cssEscape(sym) + '"]');
      if (!row) return;
      var sel = row.querySelector('select.mode');
      sel.value = app.rows[sym].mode;
      sel.classList.toggle('set', app.rows[sym].mode !== 'auto');
    });

    var bar = $('#bulkbar');
    if (!bar) return;
    unitGroups().forEach(function (g, i) {
      var chip = bar.querySelectorAll('.bulk-group')[i];
      if (!chip) return;
      var modes = {};
      g.symbols.forEach(function (sym) { modes[app.rows[sym].mode] = true; });
      var keys = Object.keys(modes);
      var sel = chip.querySelector('select');
      sel.value = keys.length === 1 ? keys[0] : '';
      chip.classList.toggle('set', keys.length === 1 && keys[0] !== 'auto');
      chip.classList.toggle('mixed', keys.length > 1);
    });
  }

  /* --------------------------------------------------------------------- */
  /* Dialog for the default rules                                           */
  /* --------------------------------------------------------------------- */

  function openRulesDialog() {
    var active = RC.rulesFor(app.current);
    var rows = $('#rules-rows');
    rows.innerHTML = '';

    Object.keys(active.rules).forEach(function (k) {
      if (k !== '*') rows.appendChild(ruleRow(k, active.rules[k]));
    });
    $('#rules-rest').value = Object.prototype.hasOwnProperty.call(active.rules, '*')
      ? active.rules['*'] : 'auto';
    $('#rules-auto').checked = RC.autoApply();
    $('#rules-origin').textContent = 'Currently using ' + sourceLabel(active.source) + '.';
    $('#btn-rules-set').disabled = !app.current;
    $('#btn-rules-set').title = app.current
      ? 'Writes a "Recalc" field into «' + app.current.Name + '» — exported with the JSON'
      : '';
    $('#rules-dialog').classList.add('open');
    refreshRuleSuggestions();
  }

  function ruleRow(key, mode) {
    var r = el('div', 'rule-row');
    r.innerHTML = '<input class="inp mono rule-key" list="rule-keys" placeholder="Ω or RA" value="' +
      M.esc(key) + '">';
    var sel = el('select', 'inp rule-mode');
    MODES.forEach(function (m) {
      var o = el('option');
      o.value = m.id;
      o.textContent = m.label;
      sel.appendChild(o);
    });
    sel.value = RC.isMode(mode) ? mode : 'auto';
    r.appendChild(sel);
    var x = el('button', 'x-btn', '✕');
    x.title = 'Remove rule';
    x.addEventListener('click', function () { r.remove(); });
    r.appendChild(x);
    return r;
  }

  /* Offers the units and symbols of the current set as rule keys. */
  function refreshRuleSuggestions() {
    var list = $('#rule-keys');
    list.innerHTML = '';
    if (!app.compiled) return;
    var seen = {};
    app.compiled.units.concat(app.compiled.symbols).forEach(function (k) {
      if (!k || seen[k]) return;
      seen[k] = true;
      var o = el('option');
      o.value = k;
      list.appendChild(o);
    });
  }

  function collectRules() {
    var rules = {};
    $$('#rules-rows .rule-row').forEach(function (r) {
      var k = $('.rule-key', r).value.trim();
      if (k && k !== '*') rules[k] = $('.rule-mode', r).value;
    });
    var rest = $('#rules-rest').value;
    if (rest !== 'auto') rules['*'] = rest;
    return rules;
  }

  function closeRulesDialog() { $('#rules-dialog').classList.remove('open'); }

  function bindRulesDialog() {
    var rest = $('#rules-rest');
    MODES.forEach(function (m) {
      var o = el('option');
      o.value = m.id;
      o.textContent = m.label;
      rest.appendChild(o);
    });

    $('#btn-rules-add').addEventListener('click', function () {
      $('#rules-rows').appendChild(ruleRow('', 'e24'));
    });
    $('#btn-rules-close').addEventListener('click', closeRulesDialog);
    $('#btn-rules-cancel').addEventListener('click', closeRulesDialog);

    $('#btn-rules-global').addEventListener('click', function () {
      var rules = collectRules();
      RC.setGlobalRules(Object.keys(rules).length ? rules : null);
      RC.setAutoApply($('#rules-auto').checked);
      closeRulesDialog();
      forgetModes(null);
      if (app.current) selectSet(app.current, false);
      toast('Saved as your default for every formula set');
    });

    $('#btn-rules-set').addEventListener('click', function () {
      if (!app.current) return;
      var rules = collectRules();
      var copy = JSON.parse(JSON.stringify(app.current));
      if (Object.keys(rules).length) copy.Recalc = rules;
      else delete copy.Recalc;
      RC.setAutoApply($('#rules-auto').checked);
      var saved = S.replaceSet(app.current, copy);
      closeRulesDialog();
      forgetModes(keyOf(saved));
      selectSet(saved, false);
      toast('Stored in «' + saved.Name + '» — included on export');
    });

    $('#btn-rules-apply').addEventListener('click', function () {
      applyRules(collectRules());
      closeRulesDialog();
    });

    $('#rules-dialog').addEventListener('mousedown', function (e) {
      if (e.target === $('#rules-dialog')) closeRulesDialog();
    });
  }

  function buildRow(sym, unit, desc, idx) {
    var st = app.rows[sym];
    var row = el('div', 'vrow');
    row.dataset.sym = sym;

    row.appendChild(el('div', 'vsym math', M.prettySymbol(sym)));
    row.appendChild(el('div', 'vdesc', M.esc(desc)));

    /* Input field + prefix */
    var fieldCell = el('div', 'vcol-field');
    var field = el('div', 'field' + (st.text ? ' has-value' : ''));
    var input = el('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.spellcheck = false;
    input.placeholder = '–';
    input.value = st.text;
    input.setAttribute('aria-label', sym + ' ' + desc);
    var sel = el('select');
    var prefixes = F.isPrefixless(unit) ? [{ sym: '', exp: 0, name: '' }] : F.PREFIXES;
    prefixes.forEach(function (p) {
      var o = el('option');
      o.value = String(p.exp);
      o.textContent = p.sym + unit;
      o.title = p.name ? p.name + ' (10^' + p.exp + ')' : 'no prefix';
      sel.appendChild(o);
    });
    sel.value = String(st.prefixExp);
    field.appendChild(input);
    field.appendChild(sel);
    fieldCell.appendChild(field);
    row.appendChild(fieldCell);

    input.addEventListener('input', function () {
      st.text = input.value;
      field.classList.toggle('has-value', !!input.value.trim());
      scheduleRecompute();
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { recompute(); }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        var inputs = $$('#vtable .field input');
        var i = inputs.indexOf(input) + (ev.key === 'ArrowDown' ? 1 : -1);
        if (inputs[i]) { inputs[i].focus(); inputs[i].select(); ev.preventDefault(); }
      }
    });
    sel.addEventListener('change', function () {
      st.prefixExp = Number(sel.value);
      scheduleRecompute();
    });

    /* Recalculation mode */
    var modeCell = el('div', 'vcol-mode');
    var mode = el('select', 'mode' + (st.mode !== 'auto' ? ' set' : ''));
    MODES.forEach(function (m) {
      var o = el('option');
      o.value = m.id;
      o.textContent = m.label;
      mode.appendChild(o);
    });
    mode.value = st.mode;
    mode.title = 'automatic: your input stays, computed values adapt\n' +
      'hold: keep this value, even if it was computed\n' +
      'release: ignore your input in the second pass\n' +
      'E6…E96: round to the nearest standard value and hold it';
    mode.addEventListener('change', function () {
      st.mode = mode.value;
      mode.classList.toggle('set', st.mode !== 'auto');
      syncModeControls();
      recompute();
    });
    modeCell.appendChild(mode);
    row.appendChild(modeCell);

    var res = el('div', 'vres vcol-res');
    res.dataset.label = 'Result';
    res.title = 'Click to copy';
    res.addEventListener('click', function () { copyCell(res); });
    row.appendChild(res);

    var adj = el('div', 'vres vcol-adj adj');
    adj.dataset.label = 'Adjusted';
    adj.title = 'Click to copy';
    adj.addEventListener('click', function () { copyCell(adj); });
    row.appendChild(adj);

    return row;
  }

  function copyCell(cell) {
    var txt = (cell.dataset.raw || cell.textContent || '').trim();
    if (!txt) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(function () { toast(txt + ' copied'); });
    }
  }

  /* Reset clears the inputs and goes back to the set's default modes. */
  function resetInputs() {
    var preset = RC.appliesOnOpen(app.current) ? RC.rulesFor(app.current).rules : null;
    app.compiled.symbols.forEach(function (sym, i) {
      app.rows[sym] = {
        text: '',
        prefixExp: 0,
        mode: preset ? RC.modeFor(preset, sym, app.compiled.units[i]) : 'auto'
      };
    });
    app.memory[keyOf(app.current)] = {};
    renderSet();
  }

  /* ===================================================================== */
  /* Calculation                                                           */
  /* ===================================================================== */

  var recomputeTimer = null;
  function scheduleRecompute() {
    clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(recompute, 110);
  }

  function seriesOf(mode) {
    var m = /^e(\d+)$/.exec(mode);
    return m ? Number(m[1]) : null;
  }

  function recompute() {
    var c = app.compiled;
    if (!c) return;

    /* Pass 1: read the inputs */
    var inputs = {}, badInput = [];
    c.symbols.forEach(function (sym) {
      var st = app.rows[sym];
      var parsed = F.parseInput(st.text);
      if (!parsed) {
        if (st.text.trim()) badInput.push(sym);
        return;
      }
      inputs[sym] = parsed.hadPrefix ? parsed.value : parsed.value * Math.pow(10, st.prefixExp);
    });

    var res = SOLVER.solve(c, inputs);

    /* Pass 2 ("recalculate"): insert the rounded resp. held values and
     * work out everything else again. */
    var anyMode = c.symbols.some(function (s) { return app.rows[s].mode !== 'auto'; });
    var adjusted = null;
    if (anyMode) {
      var inputs2 = {};
      c.symbols.forEach(function (sym) {
        var mode = app.rows[sym].mode;
        if (mode === 'free') return;
        var base = res.values[sym];
        if (typeof base !== 'number' || !isFinite(base)) return;
        var series = seriesOf(mode);
        if (series) inputs2[sym] = F.snapToESeries(base, series);
        else if (mode === 'const') inputs2[sym] = base;
        else if (sym in inputs) inputs2[sym] = inputs[sym];   /* automatic: input stays */
      });
      adjusted = SOLVER.solve(c, inputs2);
    }

    paint(res, adjusted, badInput);
  }

  function paint(res, adjusted, badInput) {
    var c = app.compiled;
    var table = $('#vtable');
    table.classList.toggle('with-adjusted', !!adjusted);

    var solvedBy = {};
    res.steps.forEach(function (s) { solvedBy[s.symbol] = s; });

    c.symbols.forEach(function (sym, i) {
      var row = table.querySelector('.vrow[data-sym="' + cssEscape(sym) + '"]');
      if (!row) return;
      var unit = c.units[i] || '';
      var resCell = row.querySelector('.vcol-res');
      var adjCell = row.querySelector('.vcol-adj');
      var given = res.given.indexOf(sym) >= 0;
      var step = solvedBy[sym];

      row.classList.toggle('is-given', given);
      row.classList.toggle('is-solved', !!step);

      var v = res.values[sym];
      if (typeof v === 'number' && isFinite(v)) {
        resCell.innerHTML = valueHTML(v, unit) + (step && step.ambiguous ? altBadge(step) : '');
        resCell.dataset.raw = F.formatNumber(v);
        resCell.classList.toggle('given-val', given && !step);
      } else {
        resCell.innerHTML = badInput.indexOf(sym) >= 0
          ? '<span style="color:var(--danger)">not a number</span>' : '';
        resCell.dataset.raw = '';
        resCell.classList.remove('given-val');
      }

      if (adjusted) {
        var a = adjusted.values[sym];
        if (typeof a === 'number' && isFinite(a)) {
          var same = typeof v === 'number' && Math.abs(a - v) <= Math.abs(v) * 1e-9;
          adjCell.innerHTML = valueHTML(a, unit);
          adjCell.dataset.raw = F.formatNumber(a);
          adjCell.style.opacity = same ? '0.45' : '1';
        } else {
          adjCell.innerHTML = '';
          adjCell.dataset.raw = '';
        }
      }
    });

    /* Mark the equations that were used */
    var used = {}, conflict = {};
    res.steps.forEach(function (s) { used[s.equation.index] = s.symbol; });
    res.conflicts.forEach(function (x) { conflict[x.equation.index] = true; });
    $$('#eq-list .eq-card').forEach(function (card) {
      var i = Number(card.dataset.eq);
      card.classList.toggle('used', !!used[i] && !conflict[i]);
      card.classList.toggle('conflict', !!conflict[i]);
      var badge = card.querySelector('.eq-badge');
      if (badge) {
        if (conflict[i]) {
          badge.textContent = 'contradictory';
          badge.style.display = '';
          badge.style.color = 'var(--danger)';
          badge.style.background = 'var(--danger-soft)';
        } else if (used[i]) {
          badge.innerHTML = '→ ' + M.prettySymbol(used[i]);
          badge.style.display = '';
          badge.style.color = '';
          badge.style.background = '';
        } else {
          badge.style.display = 'none';
        }
      }
    });

    renderSteps(res);
    renderStatus(res, adjusted, badInput);
  }

  function valueHTML(v, unit) {
    var d = F.display(v, unit);
    return '<span class="num">' + M.esc(d.num) + '</span>' +
      (d.unit ? '<span class="unit">' + M.esc(d.unit) + '</span>' : '');
  }

  function altBadge(step) {
    var extra = (step.alternatives || []).map(function (a) { return F.formatValue(a, ''); });
    var title = extra.length ? 'Other solution: ' + extra.join(', ') : 'Sign is not unique (±)';
    return '<span class="alt" title="' + M.esc(title) + '">±</span>';
  }

  function renderSteps(res) {
    var panel = $('#step-panel'), list = $('#step-list');
    if (!panel) return;
    if (!res.steps.length) { panel.style.display = 'none'; return; }
    panel.style.display = '';
    $('#step-count').textContent = res.steps.length + (res.steps.length === 1 ? ' step' : ' steps');
    list.innerHTML = '';
    res.steps.forEach(function (s, i) {
      var li = el('li');
      var unit = app.compiled.units[app.compiled.symbols.indexOf(s.symbol)] || '';
      li.innerHTML =
        '<span class="step-no">' + (i + 1) + '</span>' +
        '<span class="step-math math">' + M.renderEquation(s.equation) + '</span>' +
        '<span class="step-method">' + M.esc(s.method) + '</span>' +
        '<span class="step-val">' + M.prettySymbol(s.symbol) + ' = ' +
        M.esc(F.formatValue(s.value, unit)) + '</span>';
      list.appendChild(li);
    });
  }

  function renderStatus(res, adjusted, badInput) {
    var box = $('#status');
    if (!box) return;
    var open = res.unresolved.length;
    var html =
      '<span class="chip"><span class="dot given"></span>' + res.given.length + ' given</span>' +
      '<span class="chip"><span class="dot solved"></span>' + res.steps.length + ' solved</span>' +
      '<span class="chip"><span class="dot open"></span>' + open + ' open</span>';

    var msg = '', cls = 'ok';
    if (badInput.length) {
      cls = 'error';
      msg = 'Not a valid number: ' + badInput.join(', ');
    } else if (res.conflicts.length) {
      cls = 'error';
      msg = 'The inputs contradict each other (' + res.conflicts.length +
        (res.conflicts.length === 1 ? ' equation' : ' equations') + ')';
    } else if (!res.given.length) {
      cls = 'warn';
      msg = 'Enter values to start calculating';
    } else if (!res.steps.length) {
      cls = 'warn';
      msg = 'Too few values — nothing further can be determined';
    } else if (open) {
      msg = res.steps.length + ' solved, ' + open + ' need more input';
    } else {
      msg = 'Everything solved';
    }
    if (adjusted && !Object.keys(adjusted.values).length) {
      cls = 'warn';
      msg = 'For «Adjusted», set a value to hold or to an E series';
    } else if (adjusted && adjusted.conflicts.length) {
      cls = 'warn';
      msg = '«Adjusted» is over-determined — set a dependent quantity to «release»';
    } else if (adjusted && adjusted.unresolved.length > res.unresolved.length) {
      cls = 'warn';
      msg = '«Adjusted» has too little to go on — set the released inputs back to «automatic»';
    }
    html += '<span class="msg ' + cls + '">' + M.esc(msg) + '</span>';
    box.innerHTML = html;
  }

  function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  /* ===================================================================== */
  /* Editor                                                                */
  /* ===================================================================== */

  function openEditor(set) {
    app.editTarget = set || null;
    var data = set ? JSON.parse(JSON.stringify(set)) : {
      Formelzeichen: [''], Einheiten: [''], Name: '', Beschreibung: [''],
      Formeln: [''], Untermenu: (app.current && app.current.Untermenu) || 'My formulas'
    };

    $('#ed-title').textContent = set ? 'Edit formula set' : 'New formula set';
    $('#ed-name').value = data.Name;
    $('#ed-cat').value = data.Untermenu;
    $('#btn-ed-delete').style.display = set ? '' : 'none';

    var cats = $('#ed-cats');
    cats.innerHTML = '';
    S.categories().forEach(function (c) {
      var o = el('option');
      o.value = c;
      cats.appendChild(o);
    });

    var rows = $('#ed-rows');
    rows.innerHTML = '';
    data.Formelzeichen.forEach(function (sym, i) {
      rows.appendChild(editorVarRow(sym, data.Einheiten[i] || '', data.Beschreibung[i] || ''));
    });

    var fs = $('#ed-formulas');
    fs.innerHTML = '';
    data.Formeln.forEach(function (f) { fs.appendChild(editorFormulaRow(f)); });

    $('#ed-problems').innerHTML = '';
    $('#modal').classList.add('open');
    setTimeout(function () { $('#ed-name').focus(); }, 30);
    validateEditor();
  }

  function editorVarRow(sym, unit, desc) {
    var r = el('div', 'erow');
    r.innerHTML =
      '<input class="inp mono ed-sym" placeholder="R1" value="' + M.esc(sym) + '">' +
      '<input class="inp mono ed-unit" placeholder="Ω" value="' + M.esc(unit) + '">' +
      '<input class="inp ed-desc" placeholder="Description" value="' + M.esc(desc) + '">' +
      '<button class="x-btn" title="Remove row">✕</button>';
    r.querySelector('.x-btn').addEventListener('click', function () { r.remove(); validateEditor(); });
    $$('input', r).forEach(function (i) { i.addEventListener('input', validateEditor); });
    return r;
  }

  function editorFormulaRow(text) {
    var r = el('div', 'frow');
    r.innerHTML =
      '<input class="inp mono ed-formula" placeholder="Rges, R1 + R2" value="' + M.esc(text) + '">' +
      '<button class="x-btn" title="Remove formula">✕</button>' +
      '<div class="fprev math"></div>';
    var input = r.querySelector('input');
    function preview() {
      var box = r.querySelector('.fprev');
      var parts = M.splitEquation(input.value);
      if (!input.value.trim()) { box.innerHTML = ''; return; }
      try {
        if (!parts) throw new Error('Missing comma: "quantity, expression"');
        box.innerHTML = M.renderEquation({ lhs: M.parse(parts[0]), rhs: M.parse(parts[1]) });
      } catch (e) {
        box.innerHTML = '<span class="ferr" style="color:var(--danger);font-family:var(--mono);font-size:12px">⚠ ' +
          M.esc(e.message || String(e)) + '</span>';
      }
    }
    input.addEventListener('input', function () { preview(); validateEditor(); });
    r.querySelector('.x-btn').addEventListener('click', function () { r.remove(); validateEditor(); });
    preview();
    return r;
  }

  function collectEditor() {
    var syms = [], units = [], descs = [];
    $$('#ed-rows .erow').forEach(function (r) {
      var s = $('.ed-sym', r).value.trim();
      if (!s) return;
      syms.push(s);
      units.push($('.ed-unit', r).value.trim());
      descs.push($('.ed-desc', r).value.trim() || s);
    });
    var formeln = [];
    $$('#ed-formulas .ed-formula').forEach(function (i) {
      var t = i.value.trim();
      if (t) formeln.push(t);
    });
    return {
      Formelzeichen: syms,
      Einheiten: units,
      Name: $('#ed-name').value.trim(),
      Beschreibung: descs,
      Formeln: formeln,
      Untermenu: $('#ed-cat').value.trim() || 'Ohne Kategorie'
    };
  }

  function validateEditor() {
    var set = collectEditor();
    var problems = S.validate(set);
    var box = $('#ed-problems');
    if (problems.length) {
      box.innerHTML = '<div class="notice warn"><span>⚠</span><span>' +
        problems.map(M.esc).join('<br>') + '</span></div>';
    } else {
      box.innerHTML = '<div class="notice info"><span>✓</span><span>' + set.Formelzeichen.length +
        ' quantities, ' + set.Formeln.length + ' formulas — valid</span></div>';
    }
    $('#btn-ed-save').disabled = problems.length > 0;
    return problems;
  }

  function saveEditor() {
    var set = collectEditor();
    if (S.validate(set).length) return;
    var saved = app.editTarget ? S.replaceSet(app.editTarget, set) : S.addSet(set);
    closeModal();
    renderNav();
    selectSet(saved, true);
    toast('Saved (browser storage)');
  }

  function deleteEditor() {
    if (!app.editTarget) return;
    if (!confirm('Really delete the formula set «' + app.editTarget.Name + '»?')) return;
    S.removeSet(app.editTarget);
    closeModal();
    app.current = null;
    renderNav();
    renderWelcome();
    toast('Deleted');
  }

  function closeModal() { $('#modal').classList.remove('open'); }

  /* ===================================================================== */
  /* Import / Export                                                       */
  /* ===================================================================== */

  function doExport() {
    var txt = S.toJSON();
    var blob = new Blob([txt], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = el('a');
    a.href = url;
    a.download = 'formulas.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast('formulas.json exported');
  }

  function doCopyJSON() {
    var txt = S.toJSON();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(function () {
        toast('JSON copied to the clipboard (' + S.state.sets.length + ' sets)');
      }, function () { showJSONFallback(txt); });
    } else {
      showJSONFallback(txt);
    }
  }

  function showJSONFallback(txt) {
    var w = window.open('', '_blank');
    if (w) { w.document.write('<pre>' + M.esc(txt) + '</pre>'); w.document.close(); }
    else toast('Copying is not possible here', true);
  }

  function readFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var merge = S.state.sets.length > 0 &&
        confirm('Add to the existing ' + S.state.sets.length + ' formula sets?\n\n' +
                'OK = add / update\nCancel = replace everything');
      try {
        var n = S.importJSON(String(fr.result), merge ? 'merge' : 'replace');
        app.current = null;
        renderNav();
        renderWelcome();
        toast(n + ' formula sets imported');
      } catch (e) {
        toast('Import failed: ' + (e.message || e), true);
      }
    };
    fr.readAsText(file, 'utf-8');
  }

  /* ===================================================================== */
  /* Odds and ends                                                         */
  /* ===================================================================== */

  function toast(msg, isErr) {
    var t = el('div', 'toast' + (isErr ? ' err' : ''), M.esc(msg));
    $('#toasts').appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .25s';
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 260);
    }, 2300);
  }

  function setTheme(mode) {
    document.documentElement.dataset.theme = mode;
    try { localStorage.setItem('formulasolver.theme', mode); } catch (e) {}
    $('#btn-theme').textContent = mode === 'dark' ? '☀' : '☾';
    $('#btn-theme').title = mode === 'dark' ? 'Light theme' : 'Dark theme';
  }

  function saveUi() {
    try { localStorage.setItem('formulasolver.collapsed', JSON.stringify(app.collapsed)); } catch (e) {}
  }

  function openSidebar() { $('#sidebar').classList.add('open'); $('#scrim').classList.add('on'); }
  function closeSidebar() { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('on'); }

  function fromHash() {
    var m = /^#\/([^/]*)\/(.*)$/.exec(location.hash);
    if (!m) return null;
    var cat = decodeURIComponent(m[1]), name = decodeURIComponent(m[2]);
    return S.state.sets.filter(function (s) { return s.Untermenu === cat && s.Name === name; })[0] || null;
  }

  /* ===================================================================== */
  /* Start                                                                 */
  /* ===================================================================== */

  function bind() {
    $('#search').addEventListener('input', renderNav);
    $('#search').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { $('#search').value = ''; renderNav(); $('#search').blur(); }
      if (e.key === 'Enter') {
        var first = $('#nav .nav-item');
        if (first) first.click();
      }
    });
    $('#btn-new').addEventListener('click', function () { openEditor(null); });
    $('#btn-edit').addEventListener('click', function () { if (app.current) openEditor(app.current); });
    $('#btn-reset').addEventListener('click', resetInputs);
    $('#btn-export').addEventListener('click', doExport);
    $('#btn-copy').addEventListener('click', doCopyJSON);
    $('#btn-import').addEventListener('click', function () { $('#file-input').click(); });
    $('#file-input').addEventListener('change', function (e) {
      if (e.target.files[0]) readFile(e.target.files[0]);
      e.target.value = '';
    });
    $('#btn-reload').addEventListener('click', function () {
      if (S.state.dirty && !confirm('Discard local changes and reload data/formulas.json?')) return;
      S.resetToFile().then(function () {
        app.current = null;
        renderNav();
        renderWelcome();
        toast('Loaded from file');
      });
    });
    $('#btn-theme').addEventListener('click', function () {
      setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });
    $('#btn-menu').addEventListener('click', openSidebar);
    $('#scrim').addEventListener('click', closeSidebar);

    $('#btn-ed-save').addEventListener('click', saveEditor);
    $('#btn-ed-cancel').addEventListener('click', closeModal);
    $('#btn-ed-close').addEventListener('click', closeModal);
    $('#btn-ed-delete').addEventListener('click', deleteEditor);
    $('#btn-ed-addvar').addEventListener('click', function () {
      $('#ed-rows').appendChild(editorVarRow('', '', ''));
      validateEditor();
    });
    $('#btn-ed-addformula').addEventListener('click', function () {
      var r = editorFormulaRow('');
      $('#ed-formulas').appendChild(r);
      $('input', r).focus();
      validateEditor();
    });
    $('#ed-name').addEventListener('input', validateEditor);
    $('#ed-cat').addEventListener('input', validateEditor);
    $('#modal').addEventListener('mousedown', function (e) {
      if (e.target === $('#modal')) closeModal();
    });
    bindRulesDialog();

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if ($('#rules-dialog').classList.contains('open')) closeRulesDialog();
        else if ($('#modal').classList.contains('open')) closeModal();
        else closeSidebar();
      }
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' &&
          document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'SELECT') {
        e.preventDefault();
        openSidebar();
        $('#search').focus();
        $('#search').select();
      }
    });

    window.addEventListener('hashchange', function () {
      var set = fromHash();
      if (set && set !== app.current) selectSet(set, false);
    });

    /* Drag & drop for JSON files */
    var dz = $('#dropzone'), depth = 0;
    window.addEventListener('dragenter', function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') < 0) return;
      depth++;
      dz.classList.add('on');
    });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('dragleave', function () { if (--depth <= 0) { depth = 0; dz.classList.remove('on'); } });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      depth = 0;
      dz.classList.remove('on');
      var f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) readFile(f);
    });
  }

  function start() {
    var theme = document.documentElement.getAttribute('data-theme');
    try { theme = localStorage.getItem('formulasolver.theme') || theme; } catch (e) {}
    if (!theme) {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.theme = theme;
    $('#btn-theme').textContent = theme === 'dark' ? '☀' : '☾';
    $('#btn-theme').title = theme === 'dark' ? 'Light theme' : 'Dark theme';
    try { app.collapsed = JSON.parse(localStorage.getItem('formulasolver.collapsed') || '{}'); } catch (e) {}

    bind();
    S.load().then(function () {
      renderNav();
      var set = fromHash();
      if (!set) {
        var last = null;
        try { last = localStorage.getItem('formulasolver.last'); } catch (e) {}
        if (last) set = S.state.sets.filter(function (s) { return keyOf(s) === last; })[0];
      }
      if (set) selectSet(set, false); else renderWelcome();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  NS.app = app;
})(window.FS = window.FS || {});
