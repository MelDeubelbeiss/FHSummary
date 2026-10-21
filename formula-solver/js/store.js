/* store.js - loading, saving, importing and exporting the formula database.
 *
 * The JSON structure is unchanged from the Python version, German keys and all:
 * [ { "Formelzeichen": [...], "Einheiten": [...], "Name": "...",
 *     "Beschreibung": [...], "Formeln": ["target, expression", ...],
 *     "Untermenu": "..." }, ... ]
 */
(function (NS) {
  'use strict';

  var LS_KEY = 'formulasolver.sets.v3';
  var LS_DIRTY = 'formulasolver.dirty.v3';
  var DATA_URL = 'data/formulas.json';

  var state = { sets: [], source: 'empty', dirty: false };

  function fieldsOf(set) {
    return {
      Formelzeichen: Array.isArray(set.Formelzeichen) ? set.Formelzeichen.slice() : [],
      Einheiten: Array.isArray(set.Einheiten) ? set.Einheiten.slice() : [],
      Name: typeof set.Name === 'string' ? set.Name : '',
      Beschreibung: Array.isArray(set.Beschreibung) ? set.Beschreibung.slice() : [],
      Formeln: Array.isArray(set.Formeln) ? set.Formeln.slice() : [],
      Untermenu: typeof set.Untermenu === 'string' && set.Untermenu ? set.Untermenu : 'Uncategorised'
    };
  }

  /* Turns arbitrary JSON into a list of well-formed formula sets. */
  function normalize(data) {
    if (!Array.isArray(data)) {
      if (data && Array.isArray(data.sets)) data = data.sets;
      else if (data && typeof data === 'object') data = [data];
      else throw new Error('JSON must be a list of formula sets');
    }
    return data.filter(function (s) { return s && typeof s === 'object'; }).map(fieldsOf);
  }

  function validate(set) {
    var p = [];
    if (!set.Name) p.push('Name is missing');
    if (!set.Formelzeichen.length) p.push('No symbols defined');
    if (set.Einheiten.length !== set.Formelzeichen.length) p.push('Number of units does not match');
    if (set.Beschreibung.length !== set.Formelzeichen.length) p.push('Number of descriptions does not match');
    if (!set.Formeln.length) p.push('No formulas');
    var seen = {};
    set.Formelzeichen.forEach(function (s) {
      if (!s) p.push('Empty symbol');
      else if (seen[s]) p.push('Duplicate symbol: ' + s);
      seen[s] = 1;
      if (s && !/^[A-Za-z_µΩ][A-Za-z0-9_µΩ]*$/.test(s)) {
        p.push('Invalid symbol: ' + s);
      }
    });
    set.Formeln.forEach(function (f) {
      var parts = NS.math.splitEquation(f);
      if (!parts) { p.push('"' + f + '": no comma between quantity and expression'); return; }
      try {
        NS.math.parse(parts[0]);
        NS.math.parse(parts[1]);
      } catch (e) {
        p.push('"' + f + '": ' + (e.message || e));
      }
    });
    return p;
  }

  /* Like Python's json.dump(..., ensure_ascii=True): escape non-ASCII so the
   * file can still be read by the original Python version. */
  function toJSON(sets, asciiOnly) {
    var txt = JSON.stringify(sets || state.sets, null, 2);
    if (asciiOnly === false) return txt;
    return txt.replace(/[\u0080-\uffff]/g, function (c) {
      return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  function persist() {
    state.dirty = true;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state.sets));
      localStorage.setItem(LS_DIRTY, '1');
    } catch (e) { /* no localStorage -> keep it in memory only */ }
  }

  function seedFromPage() {
    var el = document.getElementById('seed-data');
    if (!el) return null;
    try { return normalize(JSON.parse(el.textContent)); } catch (e) { return null; }
  }

  function load() {
    return new Promise(function (resolve) {
      var stored = null;
      try {
        if (localStorage.getItem(LS_DIRTY) === '1') {
          var raw = localStorage.getItem(LS_KEY);
          if (raw) stored = normalize(JSON.parse(raw));
        }
      } catch (e) { stored = null; }

      if (stored && stored.length) {
        state.sets = stored; state.source = 'browser storage'; state.dirty = true;
        return resolve(state);
      }
      fetchFile().then(function (sets) {
        state.sets = sets; state.source = DATA_URL; state.dirty = false;
        resolve(state);
      }).catch(function () {
        var seed = seedFromPage() || [];
        state.sets = seed;
        state.source = seed.length ? 'embedded copy' : 'empty';
        state.dirty = false;
        resolve(state);
      });
    });
  }

  function fetchFile() {
    return fetch(DATA_URL, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(normalize);
  }

  /* Discards local changes and reads the file again. */
  function resetToFile() {
    try { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_DIRTY); } catch (e) {}
    state.dirty = false;
    return fetchFile().then(function (sets) {
      state.sets = sets; state.source = DATA_URL;
      return state;
    }).catch(function () {
      var seed = seedFromPage() || [];
      state.sets = seed; state.source = 'embedded copy';
      return state;
    });
  }

  function importJSON(text, mode) {
    var sets = normalize(JSON.parse(text));
    if (mode === 'merge') {
      var byKey = {};
      state.sets.forEach(function (s) { byKey[s.Untermenu + '\u0000' + s.Name] = s; });
      sets.forEach(function (s) {
        var k = s.Untermenu + '\u0000' + s.Name;
        if (byKey[k]) {
          state.sets[state.sets.indexOf(byKey[k])] = s;
        } else {
          state.sets.push(s);
        }
      });
    } else {
      state.sets = sets;
    }
    persist();
    return sets.length;
  }

  function categories() {
    var seen = {};
    state.sets.forEach(function (s) { seen[s.Untermenu] = true; });
    return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'de'); });
  }

  function setsOf(category) {
    return state.sets.filter(function (s) { return s.Untermenu === category; });
  }

  function addSet(set) {
    state.sets.push(fieldsOf(set));
    persist();
    return state.sets[state.sets.length - 1];
  }

  function replaceSet(oldSet, newSet) {
    var i = state.sets.indexOf(oldSet);
    var clean = fieldsOf(newSet);
    if (i < 0) { state.sets.push(clean); persist(); return state.sets[state.sets.length - 1]; }
    state.sets[i] = clean;
    persist();
    return state.sets[i];
  }

  function removeSet(set) {
    var i = state.sets.indexOf(set);
    if (i >= 0) state.sets.splice(i, 1);
    persist();
  }

  NS.store = {
    state: state,
    load: load,
    resetToFile: resetToFile,
    importJSON: importJSON,
    toJSON: toJSON,
    validate: validate,
    normalize: normalize,
    categories: categories,
    setsOf: setsOf,
    addSet: addSet,
    replaceSet: replaceSet,
    removeSet: removeSet,
    persist: persist
  };
})(window.FS = window.FS || {});
