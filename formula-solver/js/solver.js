/* solver.js - solves systems of equations in the browser.
 *
 * Approach (what sympy.solve(..., manual=True) did for this kind of formula):
 *   1. Scan every equation; solve each one that has exactly one unknown left.
 *   2. If the unknown occurs once -> rearrange exactly (walk the tree backwards).
 *      Otherwise -> find the root numerically (sign change + bisection).
 *   3. Repeat as long as new values keep turning up.
 */
(function (NS) {
  'use strict';

  var M = NS.math;

  /* ----------------------------------------------------- Compiling a set */

  function compileSet(set) {
    var symbols = (set.Formelzeichen || []).slice();
    var compiled = {
      name: set.Name || '(unnamed)',
      category: set.Untermenu || 'Uncategorised',
      symbols: symbols,
      units: (set.Einheiten || []).slice(),
      descriptions: (set.Beschreibung || []).slice(),
      equations: [],
      problems: [],
      raw: set
    };
    (set.Formeln || []).forEach(function (text, idx) {
      var eq = { text: text, index: idx };
      var parts = M.splitEquation(text);
      if (!parts) {
        eq.error = 'No comma: expected "quantity, expression"';
        compiled.problems.push({ formula: text, message: eq.error });
        compiled.equations.push(eq);
        return;
      }
      try {
        eq.lhs = M.parse(parts[0]);
        eq.rhs = M.parse(parts[1]);
        eq.syms = unique(M.symbolsOf(eq.lhs).concat(M.symbolsOf(eq.rhs)));
        eq.unknownSyms = eq.syms.filter(function (s) { return symbols.indexOf(s) >= 0; });
        eq.foreign = eq.syms.filter(function (s) {
          return symbols.indexOf(s) < 0 && !Object.prototype.hasOwnProperty.call(M.CONSTANTS, s);
        });
        if (eq.foreign.length) {
          eq.error = 'Not declared: ' + eq.foreign.join(', ');
          compiled.problems.push({ formula: text, message: eq.error });
        }
      } catch (err) {
        eq.error = err.message || String(err);
        compiled.problems.push({ formula: text, message: eq.error });
      }
      compiled.equations.push(eq);
    });
    return compiled;
  }

  function unique(arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }

  /* ------------------------------------------------- Exact rearranging */

  /* Solves A = target for name, provided name occurs in A exactly once. */
  function invert(A, name, target, env) {
    var ambiguous = false, guard = 0;
    while (guard++ < 200) {
      if (!isFinite(target)) throw new Error('No real result');
      if (A.k === 'sym') {
        if (A.n !== name) throw new Error('Unexpected variable');
        return { value: target, ambiguous: ambiguous };
      }
      switch (A.k) {
        case 'add':
          if (M.containsSymbol(A.a, name)) { target -= M.evaluate(A.b, env); A = A.a; }
          else { target -= M.evaluate(A.a, env); A = A.b; }
          break;
        case 'sub':
          if (M.containsSymbol(A.a, name)) { target += M.evaluate(A.b, env); A = A.a; }
          else { target = M.evaluate(A.a, env) - target; A = A.b; }
          break;
        case 'mul':
          if (M.containsSymbol(A.a, name)) { target /= M.evaluate(A.b, env); A = A.a; }
          else { target /= M.evaluate(A.a, env); A = A.b; }
          break;
        case 'div':
          if (M.containsSymbol(A.a, name)) { target *= M.evaluate(A.b, env); A = A.a; }
          else {
            var num = M.evaluate(A.a, env);
            if (target === 0) throw new Error('Division by zero');
            target = num / target; A = A.b;
          }
          break;
        case 'neg':
          target = -target; A = A.a;
          break;
        case 'pow':
          if (M.containsSymbol(A.a, name)) {
            var p = M.evaluate(A.b, env);
            if (p === 0) throw new Error('An exponent of 0 cannot be inverted');
            if (target < 0) {
              if (Math.abs(p % 2) === 1) target = -Math.pow(-target, 1 / p);
              else throw new Error('No real root');
            } else {
              target = Math.pow(target, 1 / p);
              if (Math.abs(p % 2) === 0) ambiguous = true;
            }
            A = A.a;
          } else {
            var base = M.evaluate(A.a, env);
            if (base <= 0 || target <= 0) throw new Error('Logarithm is undefined here');
            target = Math.log(target) / Math.log(base); A = A.b;
          }
          break;
        case 'fn':
          if (A.n === 'logb') {
            if (M.containsSymbol(A.args[0], name)) {
              var b = M.evaluate(A.args[1], env);
              target = Math.pow(b, target); A = A.args[0];
            } else {
              var x = M.evaluate(A.args[0], env);
              if (target === 0) throw new Error('Base cannot be determined');
              target = Math.pow(x, 1 / target); A = A.args[1];
            }
          } else {
            var fn = M.FUNCS[A.n];
            if (!fn || !fn.inv) throw new Error('Function ' + A.n + ' cannot be inverted');
            if (fn.ambiguous) ambiguous = true;
            target = fn.inv(target);
            A = A.args[0];
          }
          break;
        default:
          throw new Error('Cannot be rearranged');
      }
    }
    throw new Error('Rearranging gave up');
  }

  /* ----------------------------------------------- Numeric root finding */

  var MANTISSAS = [1, 1.5, 2.2, 3.3, 4.7, 6.8];

  function candidateGrid(env) {
    var xs = [0];
    for (var e = -15; e <= 15; e++) {
      for (var m = 0; m < MANTISSAS.length; m++) {
        var v = MANTISSAS[m] * Math.pow(10, e);
        xs.push(v, -v);
      }
    }
    /* Known values as extra starting points (same order of magnitude) */
    Object.keys(env).forEach(function (k) {
      var v = env[k];
      if (typeof v === 'number' && isFinite(v) && v !== 0) xs.push(v, -v, v * 2, v / 2);
    });
    return unique(xs.map(Number)).sort(function (a, b) { return a - b; });
  }

  /* Finds every sign change in the grid and refines it. */
  function findRoots(f, xs) {
    var roots = [], prevX = null, prevY = null;
    for (var i = 0; i < xs.length; i++) {
      var x = xs[i], y = f(x);
      if (isNaN(y)) { prevX = null; prevY = null; continue; }
      if (y === 0) { roots.push(x); prevX = x; prevY = y; continue; }
      if (prevX !== null && prevY !== null && ((prevY < 0 && y > 0) || (prevY > 0 && y < 0))) {
        var r = bisect(f, prevX, prevY, x, y);
        if (r !== null) roots.push(r);
      }
      prevX = x; prevY = y;
    }
    /* Drop duplicate roots */
    var out = [];
    roots.forEach(function (r) {
      for (var j = 0; j < out.length; j++) {
        var scale = Math.max(Math.abs(out[j]), Math.abs(r), 1e-300);
        if (Math.abs(out[j] - r) / scale < 1e-6) return;
      }
      out.push(r);
    });
    return out;
  }

  function numericSolve(eq, name, env) {
    var local = Object.create(null);
    Object.keys(env).forEach(function (k) { local[k] = env[k]; });
    /* Relative residual - so a sign change at a pole (denominator passing
     * through zero) is not mistaken for a solution. */
    function rest(x) {
      local[name] = x;
      try {
        var l = M.evaluate(eq.lhs, local), r = M.evaluate(eq.rhs, local);
        if (!isFinite(l - r)) return null;
        return { abs: l - r, rel: Math.abs(l - r) / Math.max(Math.abs(l), Math.abs(r), 1e-300) };
      } catch (e) { return null; }
    }
    function f(x) {
      var d = rest(x);
      return d ? d.abs : NaN;
    }
    var out = findRoots(f, candidateGrid(env)).filter(function (x) {
      var d = rest(x);
      return d && d.rel < 1e-6;
    });
    if (!out.length) return null;
    /* Prefer positive solutions (physically meaningful), smallest first */
    var pos = out.filter(function (r) { return r > 0; }).sort(function (a, b) { return a - b; });
    var neg = out.filter(function (r) { return r <= 0; }).sort(function (a, b) { return Math.abs(a) - Math.abs(b); });
    var ordered = pos.concat(neg);
    return { value: ordered[0], alternatives: ordered.slice(1), ambiguous: ordered.length > 1 };
  }

  function bisect(f, a, fa, b, fb) {
    for (var i = 0; i < 200; i++) {
      var mid = (a + b) / 2;
      if (mid === a || mid === b) break;
      var fm = f(mid);
      if (isNaN(fm)) return null;
      if (fm === 0) return mid;
      if ((fa < 0) !== (fm < 0)) { b = mid; fb = fm; } else { a = mid; fa = fm; }
      if (Math.abs(b - a) <= Math.abs(mid) * 1e-15) break;
    }
    return (a + b) / 2;
  }

  /* ---------------------------------------------- Solving one equation */

  function solveEquationFor(eq, name, env) {
    var occLhs = M.countSymbol(eq.lhs, name);
    var occRhs = M.countSymbol(eq.rhs, name);
    if (occLhs + occRhs === 1) {
      try {
        var A = occLhs === 1 ? eq.lhs : eq.rhs;
        var B = occLhs === 1 ? eq.rhs : eq.lhs;
        var target = M.evaluate(B, env);
        var r = invert(A, name, target, env);
        if (isFinite(r.value)) return { value: r.value, method: 'rearranged', ambiguous: r.ambiguous, alternatives: [] };
      } catch (err) { /* -> fall back to the numeric route */ }
    }
    var num = numericSolve(eq, name, env);
    if (num && isFinite(num.value)) {
      return { value: num.value, method: 'numeric', ambiguous: num.ambiguous, alternatives: num.alternatives };
    }
    return null;
  }

  /* ------------------------------------------------------- Main routine */

  /* Repeatedly solves every equation that has exactly one unknown left. */
  function propagate(usable, values, steps, used) {
    var progress = true, rounds = 0;
    while (progress && rounds++ < 64) {
      progress = false;
      for (var i = 0; i < usable.length; i++) {
        var eq = usable[i];
        if (used[eq.index]) continue;
        var unknown = eq.unknownSyms.filter(function (s) { return !(s in values); });
        if (unknown.length !== 1) continue;
        var res = null;
        try { res = solveEquationFor(eq, unknown[0], values); } catch (e) { res = null; }
        if (res) {
          values[unknown[0]] = res.value;
          used[eq.index] = true;
          if (steps) {
            steps.push({
              symbol: unknown[0], value: res.value, equation: eq,
              method: res.method, ambiguous: res.ambiguous, alternatives: res.alternatives || []
            });
          }
          progress = true;
        }
      }
    }
  }

  function copyValues(values) {
    var v = Object.create(null);
    Object.keys(values).forEach(function (k) { v[k] = values[k]; });
    return v;
  }

  /* Coupled equations: assume one unknown, work everything out from it and
   * drive the residual of a still-open equation to zero (substitution).
   * Solves cases like "P given, I wanted" with U = R*I and P = U*I. */
  var SHOOT_MANTISSAS = [1, 2.2, 4.7];

  function shootGrid(values) {
    var xs = [];
    for (var e = -12; e <= 12; e++) {
      for (var m = 0; m < SHOOT_MANTISSAS.length; m++) {
        var v = SHOOT_MANTISSAS[m] * Math.pow(10, e);
        xs.push(v, -v);
      }
    }
    Object.keys(values).forEach(function (k) {
      var v = values[k];
      if (typeof v === 'number' && isFinite(v) && v !== 0) xs.push(v, -v);
    });
    return unique(xs).sort(function (a, b) { return a - b; });
  }

  function trySubstitution(compiled, usable, values, steps) {
    var open = compiled.symbols.filter(function (s) { return !(s in values); });
    var tried = 0;

    for (var k = 0; k < open.length && tried < 6; k++) {
      var u = open[k];
      var inEquations = usable.filter(function (eq) { return eq.unknownSyms.indexOf(u) >= 0; });
      if (inEquations.length < 2) continue;
      tried++;

      /* Trial run: which equation is left over at the end? It has to depend
       * on the assumed value - otherwise it holds anyway and would happily
       * "confirm" any value at all. */
      var closing = null;
      var probes = [1, 2.2, 10, 0.47, 100];
      for (var p = 0; p < probes.length && !closing; p++) {
        var pv = copyValues(values);
        pv[u] = probes[p];
        var pused = {};
        propagate(usable, pv, null, pused);
        for (var q = 0; q < usable.length; q++) {
          var eq = usable[q];
          if (pused[eq.index]) continue;
          if (!eq.unknownSyms.every(function (s) { return s in pv; })) continue;
          var dependsOnU = eq.unknownSyms.some(function (s) { return !(s in values); });
          if (dependsOnU) { closing = eq; break; }
        }
      }
      if (!closing) continue;

      /* Residual of the closing equation, absolute and relative. */
      var residual = (function (closeEq, uName) {
        return function (x) {
          var v = copyValues(values);
          v[uName] = x;
          var used = {};
          propagate(usable, v, null, used);
          if (used[closeEq.index]) return null;
          for (var i = 0; i < closeEq.unknownSyms.length; i++) {
            if (!(closeEq.unknownSyms[i] in v)) return null;
          }
          try {
            var l = M.evaluate(closeEq.lhs, v), r = M.evaluate(closeEq.rhs, v);
            if (!isFinite(l - r)) return null;
            return { abs: l - r, rel: Math.abs(l - r) / Math.max(Math.abs(l), Math.abs(r), 1e-300) };
          } catch (e) { return null; }
        };
      })(closing, u);

      var f = function (x) {
        var d = residual(x);
        return d ? d.abs : NaN;
      };

      /* Degenerate? If the equation holds for every assumption it says
       * nothing about the quantity we are after - it is undetermined and must
       * not be "solved" with an arbitrary value. */
      var degenerate = true;
      for (var t = 0; t < probes.length && degenerate; t++) {
        var a = residual(probes[t] * 1e-3), b = residual(probes[t] * 1e3);
        if ((a && a.rel > 1e-9) || (b && b.rel > 1e-9)) degenerate = false;
      }
      if (degenerate) continue;

      /* Only genuine roots count, not poles. */
      var roots = findRoots(f, shootGrid(values)).filter(function (x) {
        var d = residual(x);
        return d && d.rel < 1e-6;
      });
      if (!roots.length) continue;
      var pos = roots.filter(function (r) { return r > 0; }).sort(function (a, b) { return a - b; });
      var neg = roots.filter(function (r) { return r <= 0; }).sort(function (a, b) { return Math.abs(a) - Math.abs(b); });
      var ordered = pos.concat(neg);

      values[u] = ordered[0];
      steps.push({
        symbol: u, value: ordered[0], equation: closing, method: 'substituted',
        ambiguous: ordered.length > 1, alternatives: ordered.slice(1)
      });
      return true;
    }
    return false;
  }

  /* inputs: { sym: number }  (already scaled to the base unit)
   * returns: { values, given, steps, conflicts, unresolved, notes } */
  function solve(compiled, inputs) {
    var values = Object.create(null);
    var given = [];
    compiled.symbols.forEach(function (s) {
      var v = inputs[s];
      if (typeof v === 'number' && isFinite(v)) { values[s] = v; given.push(s); }
    });

    var usable = compiled.equations.filter(function (eq) { return !eq.error && eq.lhs && eq.rhs; });
    var steps = [], conflicts = [], notes = [], used = {};

    propagate(usable, values, steps, used);

    /* Anything still open? Then try substitution. */
    if (given.length) {
      for (var round = 0; round < 3; round++) {
        if (!compiled.symbols.some(function (s) { return !(s in values); })) break;
        if (!trySubstitution(compiled, usable, values, steps)) break;
        propagate(usable, values, steps, used);
      }
    }

    /* Look for contradictions: check the fully determined equations */
    usable.forEach(function (eq) {
      var open = eq.unknownSyms.filter(function (s) { return !(s in values); });
      if (open.length) return;
      try {
        var l = M.evaluate(eq.lhs, values), r = M.evaluate(eq.rhs, values);
        var scale = Math.max(Math.abs(l), Math.abs(r), 1e-300);
        if (Math.abs(l - r) / scale > 1e-6) {
          conflicts.push({ equation: eq, lhs: l, rhs: r });
        }
      } catch (e) { /* ignore */ }
    });

    var unresolved = compiled.symbols.filter(function (s) { return !(s in values); });
    return {
      values: values, given: given, steps: steps,
      conflicts: conflicts, unresolved: unresolved, notes: notes
    };
  }

  NS.solver = {
    compileSet: compileSet,
    solve: solve,
    invert: invert,
    numericSolve: numericSolve,
    solveEquationFor: solveEquationFor
  };
})(window.FS = window.FS || {});
