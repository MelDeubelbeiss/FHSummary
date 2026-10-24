/* recalc.js - default recalculation modes ("real part" presets).
 *
 * A rule set maps a symbol, a unit, or "*" (everything else) onto a mode:
 *   { "Ω": "e24", "F": "e12", "*": "free" }
 * Precedence is symbol > unit > "*". Rules can live in three places, the
 * first one that exists wins:
 *   1. the formula set itself, in the optional JSON field "Recalc"
 *   2. the global default, stored in the browser
 *   3. the built-in default below
 */
(function (NS) {
  'use strict';

  var LS_RULES = 'formulasolver.recalc.rules';
  var LS_AUTO = 'formulasolver.recalc.auto';

  var MODES = ['auto', 'const', 'free', 'e6', 'e12', 'e24', 'e48', 'e96'];

  /* E24 for resistors, E12 for capacitors and inductors. Everything else is
   * left on "automatic": what you typed stays put (the supply voltage is not
   * something rounding a resistor should change), while computed quantities
   * follow the rounded parts. Use "release" for a quantity that should be
   * allowed to move instead. */
  var BUILTIN = { 'Ω': 'e24', 'F': 'e12', 'H': 'e12', '*': 'auto' };

  function isMode(m) { return MODES.indexOf(m) >= 0; }

  /* Keeps only well-formed entries, so a hand-edited file cannot break the UI. */
  function clean(rules) {
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return null;
    var out = {}, n = 0;
    Object.keys(rules).forEach(function (k) {
      if (k && isMode(rules[k])) { out[k] = rules[k]; n++; }
    });
    return n ? out : null;
  }

  function globalRules() {
    try { return clean(JSON.parse(localStorage.getItem(LS_RULES) || 'null')); } catch (e) { return null; }
  }

  function setGlobalRules(rules) {
    try {
      if (rules) localStorage.setItem(LS_RULES, JSON.stringify(rules));
      else localStorage.removeItem(LS_RULES);
    } catch (e) { /* no localStorage - this session only */ }
  }

  function autoApply() {
    try { return localStorage.getItem(LS_AUTO) === '1'; } catch (e) { return false; }
  }

  function setAutoApply(on) {
    try { localStorage.setItem(LS_AUTO, on ? '1' : '0'); } catch (e) {}
  }

  /* The rules that apply to one formula set, plus where they came from. */
  function rulesFor(set) {
    var own = clean(set && set.Recalc);
    if (own) return { rules: own, source: 'set' };
    var g = globalRules();
    if (g) return { rules: g, source: 'global' };
    return { rules: BUILTIN, source: 'builtin' };
  }

  function modeFor(rules, symbol, unit) {
    if (!rules) return 'auto';
    if (Object.prototype.hasOwnProperty.call(rules, symbol)) return rules[symbol];
    if (unit && Object.prototype.hasOwnProperty.call(rules, unit)) return rules[unit];
    if (Object.prototype.hasOwnProperty.call(rules, '*')) return rules['*'];
    return 'auto';
  }

  /* Should a freshly opened set already carry these modes? */
  function appliesOnOpen(set) {
    return !!clean(set && set.Recalc) || autoApply();
  }

  NS.recalc = {
    MODES: MODES,
    BUILTIN: BUILTIN,
    isMode: isMode,
    clean: clean,
    globalRules: globalRules,
    setGlobalRules: setGlobalRules,
    autoApply: autoApply,
    setAutoApply: setAutoApply,
    rulesFor: rulesFor,
    modeFor: modeFor,
    appliesOnOpen: appliesOnOpen
  };
})(window.FS = window.FS || {});
