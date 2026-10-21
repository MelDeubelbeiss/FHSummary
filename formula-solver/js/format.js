/* format.js - SI prefixes, number formatting and preferred-number (E) series. */
(function (NS) {
  'use strict';

  /* Prefixes as in the original (G..p), extended by T and f. */
  var PREFIXES = [
    { sym: 'T', exp: 12, name: 'Tera' },
    { sym: 'G', exp: 9, name: 'Giga' },
    { sym: 'M', exp: 6, name: 'Mega' },
    { sym: 'k', exp: 3, name: 'Kilo' },
    { sym: '', exp: 0, name: '' },
    { sym: 'm', exp: -3, name: 'Milli' },
    { sym: 'µ', exp: -6, name: 'Mikro' },
    { sym: 'n', exp: -9, name: 'Nano' },
    { sym: 'p', exp: -12, name: 'Piko' },
    { sym: 'f', exp: -15, name: 'Femto' }
  ];

  var E_SERIES = {
    6: [10, 15, 22, 33, 47, 68],
    12: [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82],
    24: [10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91],
    48: [100, 105, 110, 115, 121, 127, 133, 140, 147, 154, 162, 169, 178, 187, 196, 205, 215, 226,
         237, 249, 261, 274, 287, 301, 316, 332, 348, 365, 383, 402, 422, 442, 464, 487, 511, 536,
         562, 590, 619, 649, 681, 715, 750, 787, 825, 866, 909, 953],
    96: [100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140, 143, 147, 150,
         154, 158, 162, 165, 169, 174, 178, 182, 187, 191, 196, 200, 205, 210, 215, 221, 226, 232,
         237, 243, 249, 255, 261, 267, 274, 280, 287, 294, 301, 309, 316, 324, 332, 340, 348, 357,
         365, 374, 383, 392, 402, 412, 422, 432, 442, 453, 464, 475, 487, 499, 511, 523, 536, 549,
         562, 576, 590, 604, 619, 634, 649, 665, 681, 698, 715, 732, 750, 768, 787, 806, 825, 845,
         866, 887, 909, 931, 953, 976]
  };

  /* Normalises an E series to mantissas in [1, 10). */
  function normalizedSeries(n) {
    var raw = E_SERIES[n];
    if (!raw) return null;
    var div = raw[0] === 100 ? 100 : 10;
    return raw.map(function (v) { return v / div; });
  }

  /* Rounds a value to the nearest member of the E series (logarithmically). */
  function snapToESeries(value, n) {
    if (!isFinite(value) || value === 0) return value;
    var series = normalizedSeries(n);
    if (!series) return value;
    var sign = value < 0 ? -1 : 1;
    var x = Math.abs(value);
    var decade = Math.floor(Math.log10(x));
    var mant = x / Math.pow(10, decade);
    /* Candidates: this decade plus the first value of the next one */
    var best = null, bestDist = Infinity;
    var candidates = series.concat([series[0] * 10]);
    for (var i = 0; i < candidates.length; i++) {
      var d = Math.abs(Math.log(candidates[i]) - Math.log(mant));
      if (d < bestDist) { bestDist = d; best = candidates[i]; }
    }
    return sign * best * Math.pow(10, decade);
  }

  /* Value -> { mantissa, prefix } in steps of three (engineering notation). */
  function engineering(value) {
    if (value === 0) return { mant: 0, prefix: '', exp: 0 };
    if (!isFinite(value)) return { mant: value, prefix: '', exp: 0 };
    var exp = Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
    if (exp > 12) exp = 12;
    if (exp < -15) exp = -15;
    var mant = value / Math.pow(10, exp);
    /* Rounding edge case: 999.9996 -> 1000 */
    if (Math.abs(parseFloat(mant.toPrecision(4))) >= 1000 && exp < 12) {
      exp += 3; mant = value / Math.pow(10, exp);
    }
    var pre = PREFIXES.filter(function (p) { return p.exp === exp; })[0];
    return { mant: mant, prefix: pre ? pre.sym : 'e' + exp, exp: exp };
  }

  function round4(v) {
    if (!isFinite(v)) return v;
    var r = parseFloat(v.toPrecision(4));
    return r;
  }

  /* Units where SI prefixes make no sense ("mdB"). */
  var NO_PREFIX = ['dB', 'dBm', 'dBu', 'dBV', 'dBi', '°C', '°F', '°', 'K/W', '%', 'rad', '°/s'];

  function isPrefixless(unit) { return NO_PREFIX.indexOf(unit) >= 0; }

  /* Splits a value into number and (prefixed) unit. */
  function display(value, unit, digits) {
    unit = unit || '';
    if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) {
      return { num: '', unit: '' };
    }
    if (!isFinite(value)) return { num: value > 0 ? '∞' : '-∞', unit: unit };
    if (value === 0) return { num: '0', unit: unit };
    if (isPrefixless(unit)) return { num: String(parseFloat(value.toPrecision(digits || 4))), unit: unit };
    var e = engineering(value);
    var mant = parseFloat(e.mant.toPrecision(digits || 4));
    var txt = String(mant);
    if (txt.indexOf('e') >= 0) txt = mant.toFixed(4);
    return { num: txt, unit: e.prefix + unit };
  }

  /* Formats a value with prefix and unit: "4.7 kΩ" */
  function formatValue(value, unit, digits) {
    var d = display(value, unit, digits);
    if (d.num === '') return '';
    return d.num + (d.unit ? ' ' + d.unit : '');
  }

  /* The number on its own, without a unit (for input fields). */
  function formatNumber(value, digits) {
    if (!isFinite(value)) return '';
    return String(parseFloat(value.toPrecision(digits || 6)));
  }

  /* Parses user input: "4.7", "4,7", "1e3", "-2.5" */
  function parseInput(text) {
    if (text === null || text === undefined) return null;
    var s = String(text).trim().replace(/\s|'/g, '');
    if (s === '') return null;
    s = s.replace(',', '.');
    /* Prefix typed straight into the field: "4k7" or "4k" */
    var m = /^([+-]?[0-9]*\.?[0-9]*)([TGMkmµunpf])([0-9]*)$/.exec(s);
    if (m && m[1] !== '' && m[1] !== '-' && m[1] !== '+') {
      var sym = m[2] === 'u' ? 'µ' : m[2];
      var pre = PREFIXES.filter(function (p) { return p.sym === sym; })[0];
      if (pre) {
        var num = m[1] + (m[3] ? '.' + m[3] : '');
        var val = parseFloat(num);
        if (!isNaN(val)) return { value: val * Math.pow(10, pre.exp), prefixExp: pre.exp, hadPrefix: true };
      }
    }
    var v = Number(s);
    if (isNaN(v)) return null;
    return { value: v, prefixExp: 0, hadPrefix: false };
  }

  NS.format = {
    PREFIXES: PREFIXES,
    isPrefixless: isPrefixless,
    display: display,
    E_SERIES: E_SERIES,
    snapToESeries: snapToESeries,
    engineering: engineering,
    formatValue: formatValue,
    formatNumber: formatNumber,
    parseInput: parseInput,
    round4: round4
  };
})(window.FS = window.FS || {});
