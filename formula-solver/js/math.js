/* math.js - tokenizer, parser, evaluation and typesetting of formulas.
 * Understands the sympy notation of the original Python version:
 *   "Rges, R1 + R2"        -> equation (left side, right side)
 *   "PR1, Pow(Iges, 2)*R1" -> Pow(a, b)
 *   "Gu, 20*log(Uout/Uin, 10)" -> log with a base
 */
(function (NS) {
  'use strict';

  var CONSTANTS = {
    pi: Math.PI, PI: Math.PI, Pi: Math.PI,
    E: Math.E, e: Math.E, euler: Math.E,
    tau: 2 * Math.PI,
    oo: Infinity
  };

  /* ---------------------------------------------------------------- Lexer */

  function tokenize(src) {
    var out = [], i = 0, n = src.length;
    while (i < n) {
      var c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
      if (c >= '0' && c <= '9' || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        var j = i;
        while (j < n && /[0-9._]/.test(src[j])) j++;
        if (src[j] === 'e' || src[j] === 'E') {
          var k = j + 1;
          if (src[k] === '+' || src[k] === '-') k++;
          if (/[0-9]/.test(src[k] || '')) { j = k; while (j < n && /[0-9]/.test(src[j])) j++; }
        }
        out.push({ t: 'num', v: parseFloat(src.slice(i, j).replace(/_/g, '')), p: i });
        i = j; continue;
      }
      if (/[A-Za-z_µΩÀ-ɏΑ-ω]/.test(c)) {
        var j2 = i;
        while (j2 < n && /[A-Za-z0-9_µΩÀ-ɏΑ-ω]/.test(src[j2])) j2++;
        out.push({ t: 'id', v: src.slice(i, j2), p: i });
        i = j2; continue;
      }
      if (c === '*' && src[i + 1] === '*') { out.push({ t: 'op', v: '**', p: i }); i += 2; continue; }
      if ('+-*/^(),'.indexOf(c) >= 0) { out.push({ t: c === '(' || c === ')' || c === ',' ? c : 'op', v: c, p: i }); i++; continue; }
      throw new ParseError('Unexpected character "' + c + '"', i);
    }
    out.push({ t: 'end', v: '', p: n });
    return out;
  }

  function ParseError(msg, pos) { this.name = 'ParseError'; this.message = msg; this.pos = pos; }
  ParseError.prototype = Object.create(Error.prototype);

  /* --------------------------------------------------------------- Parser */

  function Parser(src) { this.src = src; this.toks = tokenize(src); this.i = 0; }
  Parser.prototype.peek = function () { return this.toks[this.i]; };
  Parser.prototype.next = function () { return this.toks[this.i++]; };
  Parser.prototype.eat = function (t, v) {
    var tk = this.peek();
    if (tk.t === t && (v === undefined || tk.v === v)) { this.i++; return tk; }
    return null;
  };
  Parser.prototype.expect = function (t, v) {
    var tk = this.eat(t, v);
    if (!tk) throw new ParseError('"' + (v || t) + '" erwartet', this.peek().p);
    return tk;
  };

  Parser.prototype.parseExpression = function () { return this.parseAdditive(); };

  Parser.prototype.parseAdditive = function () {
    var node = this.parseMultiplicative();
    for (;;) {
      if (this.eat('op', '+')) node = { k: 'add', a: node, b: this.parseMultiplicative() };
      else if (this.eat('op', '-')) node = { k: 'sub', a: node, b: this.parseMultiplicative() };
      else return node;
    }
  };

  Parser.prototype.parseMultiplicative = function () {
    var node = this.parseUnary();
    for (;;) {
      if (this.eat('op', '*')) node = { k: 'mul', a: node, b: this.parseUnary() };
      else if (this.eat('op', '/')) node = { k: 'div', a: node, b: this.parseUnary() };
      else return node;
    }
  };

  Parser.prototype.parseUnary = function () {
    if (this.eat('op', '-')) return { k: 'neg', a: this.parseUnary() };
    if (this.eat('op', '+')) return this.parseUnary();
    return this.parsePower();
  };

  Parser.prototype.parsePower = function () {
    var base = this.parsePrimary();
    if (this.eat('op', '**') || this.eat('op', '^')) return { k: 'pow', a: base, b: this.parseUnary() };
    return base;
  };

  Parser.prototype.parsePrimary = function () {
    var tk = this.peek();
    if (tk.t === 'num') { this.next(); return { k: 'num', v: tk.v }; }
    if (tk.t === 'id') {
      this.next();
      if (this.eat('(')) {
        var args = [];
        if (!this.eat(')')) {
          do { args.push(this.parseExpression()); } while (this.eat(','));
          this.expect(')');
        }
        return normalizeCall(tk.v, args, tk.p);
      }
      return { k: 'sym', n: tk.v };
    }
    if (this.eat('(')) { var e = this.parseExpression(); this.expect(')'); return e; }
    throw new ParseError('Unexpected end of expression', tk.p);
  };

  /* Map function names onto an internal form (sympy compatible). */
  function normalizeCall(name, args, pos) {
    var low = name.toLowerCase();
    if (low === 'pow') {
      if (args.length !== 2) throw new ParseError('Pow(a, b) needs 2 arguments', pos);
      return { k: 'pow', a: args[0], b: args[1] };
    }
    if (low === 'log' || low === 'ln') {
      if (args.length === 2) return { k: 'fn', n: 'logb', args: args };
      if (args.length === 1) return { k: 'fn', n: 'ln', args: args };
      throw new ParseError('log() needs 1 or 2 arguments', pos);
    }
    if (low === 'abs') return { k: 'fn', n: 'abs', args: args };
    if (low === 'rational' && args.length === 2) return { k: 'div', a: args[0], b: args[1] };
    if (!FUNCS[low]) throw new ParseError('Unknown function "' + name + '"', pos);
    if (args.length !== 1) throw new ParseError(name + '() needs 1 argument', pos);
    return { k: 'fn', n: low, args: args };
  }

  /* Functions: f = evaluation, inv = inverse (used when rearranging) */
  var FUNCS = {
    sqrt:  { f: Math.sqrt,  inv: function (t) { if (t < 0) return NaN; return t * t; } },
    cbrt:  { f: Math.cbrt,  inv: function (t) { return t * t * t; } },
    exp:   { f: Math.exp,   inv: function (t) { return Math.log(t); } },
    ln:    { f: Math.log,   inv: function (t) { return Math.exp(t); } },
    log10: { f: Math.log10, inv: function (t) { return Math.pow(10, t); } },
    log2:  { f: Math.log2,  inv: function (t) { return Math.pow(2, t); } },
    abs:   { f: Math.abs,   inv: function (t) { return t < 0 ? NaN : t; }, ambiguous: true },
    sin:   { f: Math.sin,   inv: Math.asin, ambiguous: true },
    cos:   { f: Math.cos,   inv: Math.acos, ambiguous: true },
    tan:   { f: Math.tan,   inv: Math.atan, ambiguous: true },
    asin:  { f: Math.asin,  inv: Math.sin },
    acos:  { f: Math.acos,  inv: Math.cos },
    atan:  { f: Math.atan,  inv: Math.tan },
    sinh:  { f: Math.sinh,  inv: Math.asinh },
    cosh:  { f: Math.cosh,  inv: Math.acosh, ambiguous: true },
    tanh:  { f: Math.tanh,  inv: Math.atanh },
    asinh: { f: Math.asinh, inv: Math.sinh },
    acosh: { f: Math.acosh, inv: Math.cosh },
    atanh: { f: Math.atanh, inv: Math.tanh },
    deg:   { f: function (x) { return x * 180 / Math.PI; }, inv: function (t) { return t * Math.PI / 180; } },
    rad:   { f: function (x) { return x * Math.PI / 180; }, inv: function (t) { return t * 180 / Math.PI; } }
  };

  function parse(src) { 
    var p = new Parser(src);
    var e = p.parseExpression();
    if (p.peek().t !== 'end') throw new ParseError('Unexpected character', p.peek().p);
    return e;
  }

  /* Splits "lhs, rhs" at the first top-level comma. */
  function splitEquation(text) {
    var depth = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 0) return [text.slice(0, i), text.slice(i + 1)];
      else if (c === '=' && depth === 0 && text[i + 1] !== '=') return [text.slice(0, i), text.slice(i + 1)];
    }
    return null;
  }

  /* ------------------------------------------------------------ Evaluation */

  function MissingSymbol(name) { this.name = 'MissingSymbol'; this.message = 'Unknown: ' + name; this.sym = name; }
  MissingSymbol.prototype = Object.create(Error.prototype);

  function evaluate(node, env) {
    switch (node.k) {
      case 'num': return node.v;
      case 'sym':
        if (env && Object.prototype.hasOwnProperty.call(env, node.n)) {
          var v = env[node.n];
          if (typeof v !== 'number' || !isFinite(v)) throw new MissingSymbol(node.n);
          return v;
        }
        if (Object.prototype.hasOwnProperty.call(CONSTANTS, node.n)) return CONSTANTS[node.n];
        throw new MissingSymbol(node.n);
      case 'add': return evaluate(node.a, env) + evaluate(node.b, env);
      case 'sub': return evaluate(node.a, env) - evaluate(node.b, env);
      case 'mul': return evaluate(node.a, env) * evaluate(node.b, env);
      case 'div': return evaluate(node.a, env) / evaluate(node.b, env);
      case 'pow': return Math.pow(evaluate(node.a, env), evaluate(node.b, env));
      case 'neg': return -evaluate(node.a, env);
      case 'fn':
        if (node.n === 'logb') return Math.log(evaluate(node.args[0], env)) / Math.log(evaluate(node.args[1], env));
        return FUNCS[node.n].f(evaluate(node.args[0], env));
    }
    throw new Error('Unknown node ' + node.k);
  }

  function walk(node, fn) {
    fn(node);
    if (node.a) walk(node.a, fn);
    if (node.b) walk(node.b, fn);
    if (node.args) node.args.forEach(function (a) { walk(a, fn); });
  }

  function symbolsOf(node) {
    var s = {};
    walk(node, function (x) { if (x.k === 'sym' && !Object.prototype.hasOwnProperty.call(CONSTANTS, x.n)) s[x.n] = true; });
    return Object.keys(s);
  }

  function countSymbol(node, name) {
    var c = 0;
    walk(node, function (x) { if (x.k === 'sym' && x.n === name) c++; });
    return c;
  }

  function containsSymbol(node, name) { return countSymbol(node, name) > 0; }

  /* -------------------------------------------------------- Typesetting */

  var GREEK = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ',
    lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', rho: 'ρ',
    sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ',
    psi: 'ψ', omega: 'ω', Omega: 'Ω', Delta: 'Δ', Phi: 'Φ',
    Theta: 'Θ', Sigma: 'Σ', Lambda: 'Λ', Psi: 'Ψ', Gamma: 'Γ',
    Ohm: 'Ω'
  };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* "Rges" -> R<sub>ges</sub>, "tau" -> greek tau, "pi" -> greek pi */
  function prettySymbol(name) {
    if (Object.prototype.hasOwnProperty.call(CONSTANTS, name) && name !== 'e') {
      if (name.toLowerCase() === 'pi') return '<span class="m-const">π</span>';
      if (name === 'tau') return '<span class="m-const">τ</span>';
      if (name === 'E' || name === 'euler') return '<span class="m-const">e</span>';
    }
    var m = /^([A-Za-zµΩΑ-ω]+?)([0-9]*)$/.exec(name);
    var base = name, sub = '';
    if (GREEK[name]) { base = GREEK[name]; }
    else {
      var g = /^([A-Za-z]+)([0-9A-Za-z]*)$/.exec(name);
      if (g && GREEK[g[1]]) { base = GREEK[g[1]]; sub = g[2]; }
      else if (name.length > 1) { base = name[0]; sub = name.slice(1); }
      else if (m) { base = m[1]; sub = m[2]; }
    }
    return '<i class="m-var">' + esc(base) + '</i>' + (sub ? '<sub>' + esc(sub) + '</sub>' : '');
  }

  function plainSymbol(name) {
    var html = prettySymbol(name);
    return html.replace(/<sub>/g, '_').replace(/<\/?[^>]+>/g, '');
  }

  var PREC = { add: 1, sub: 1, mul: 2, div: 2, neg: 2.5, pow: 4, num: 9, sym: 9, fn: 9 };

  function renderMath(node, parentPrec) {
    parentPrec = parentPrec || 0;
    var html, prec = PREC[node.k] || 9;
    switch (node.k) {
      case 'num':
        html = '<span class="m-num">' + esc(formatPlainNumber(node.v)) + '</span>'; break;
      case 'sym':
        html = prettySymbol(node.n); break;
      case 'add':
        html = renderMath(node.a, 1) + '<span class="m-op">+</span>' + renderMath(node.b, 1); break;
      case 'sub':
        html = renderMath(node.a, 1) + '<span class="m-op">−</span>' + renderMath(node.b, 1.5); break;
      case 'mul':
        html = renderMath(node.a, 2) + '<span class="m-op m-dot">·</span>' + renderMath(node.b, 2); break;
      case 'div':
        html = '<span class="m-frac"><span class="m-nom">' + renderMath(node.a, 0) +
               '</span><span class="m-den">' + renderMath(node.b, 0) + '</span></span>';
        prec = 9; break;
      case 'neg':
        html = '<span class="m-op">−</span>' + renderMath(node.a, 2.5); break;
      case 'pow':
        if (node.b.k === 'div' || (node.b.k === 'neg' && node.b.a.k === 'div')) {
          html = renderMath(node.a, 5) + '<sup class="m-exp">' + renderMath(node.b, 0) + '</sup>';
        } else {
          html = renderMath(node.a, 5) + '<sup class="m-exp">' + renderMath(node.b, 0) + '</sup>';
        }
        break;
      case 'fn':
        if (node.n === 'sqrt') {
          html = '<span class="m-sqrt"><span class="m-radix">√</span><span class="m-rad">' +
                 renderMath(node.args[0], 0) + '</span></span>';
        } else if (node.n === 'logb') {
          html = '<span class="m-fn">log</span><sub>' + renderMath(node.args[1], 0) + '</sub>' +
                 '<span class="m-paren">(</span>' + renderMath(node.args[0], 0) + '<span class="m-paren">)</span>';
        } else {
          html = '<span class="m-fn">' + esc(node.n) + '</span><span class="m-paren">(</span>' +
                 renderMath(node.args[0], 0) + '<span class="m-paren">)</span>';
        }
        break;
      default:
        html = '?';
    }
    if (prec < parentPrec) html = '<span class="m-paren">(</span>' + html + '<span class="m-paren">)</span>';
    return html;
  }

  function formatPlainNumber(v) {
    if (!isFinite(v)) return v > 0 ? '∞' : '-∞';
    if (Math.abs(v) >= 1e6 || (v !== 0 && Math.abs(v) < 1e-4)) return v.toExponential(3).replace('e', '·10^');
    return String(parseFloat(v.toPrecision(10)));
  }

  function renderEquation(eq) {
    return '<span class="m-eq">' + renderMath(eq.lhs, 0) +
           '<span class="m-rel">=</span>' + renderMath(eq.rhs, 0) + '</span>';
  }

  NS.math = {
    CONSTANTS: CONSTANTS,
    FUNCS: FUNCS,
    ParseError: ParseError,
    MissingSymbol: MissingSymbol,
    parse: parse,
    splitEquation: splitEquation,
    evaluate: evaluate,
    symbolsOf: symbolsOf,
    countSymbol: countSymbol,
    containsSymbol: containsSymbol,
    renderMath: renderMath,
    renderEquation: renderEquation,
    prettySymbol: prettySymbol,
    plainSymbol: plainSymbol,
    esc: esc
  };
})(window.FS = window.FS || {});
