/*
 * Vector Plotter — expression engine.
 *
 * Turns text such as "-sin(x) - a y" into a fast function. User text is never
 * handed to eval: it is tokenized against a fixed vocabulary, parsed into a
 * small AST, and the AST (not the text) is compiled.
 *
 * Friendly syntax on purpose:
 *   2x, 3(x+1), (x+1)(x-1)   implicit multiplication
 *   sin x, sin 2x, sinx      function calls without parentheses
 *   x², x^2, x**2            powers;  sin^2 x  ==  sin(x)^2
 *   −, ×, ·, ÷, π, θ, √      unicode from phone keyboards
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- vocabulary

  const VARIABLES = {
    x: 'x', y: 'y', t: 't', r: 'r', theta: 'theta', 'θ': 'theta',
    a: 'a', b: 'b', c: 'c',
  };
  const VAR_JS = { x: 'x', y: 'y', t: 't', r: 'r', theta: 'th', a: 'a', b: 'b', c: 'c' };
  const VAR_HTML = { x: 'x', y: 'y', t: 't', r: 'r', theta: 'θ', a: 'a', b: 'b', c: 'c' };

  const CONSTANTS = { pi: 'pi', 'π': 'pi', e: 'e' };
  const CONST_VALUE = { pi: Math.PI, e: Math.E };
  const CONST_JS = { pi: 'Math.PI', e: 'Math.E' };

  const H = {
    sec: (v) => 1 / Math.cos(v),
    csc: (v) => 1 / Math.sin(v),
    cot: (v) => 1 / Math.tan(v),
    mod: (u, v) => ((u % v) + v) % v,
  };

  function fn(min, max, impl, js, label, example) {
    return { min, max, impl, js, label, example };
  }
  const FUNCTIONS = {
    sin: fn(1, 1, Math.sin, 'Math.sin', 'sin'),
    cos: fn(1, 1, Math.cos, 'Math.cos', 'cos'),
    tan: fn(1, 1, Math.tan, 'Math.tan', 'tan'),
    sec: fn(1, 1, H.sec, 'H.sec', 'sec'),
    csc: fn(1, 1, H.csc, 'H.csc', 'csc'),
    cot: fn(1, 1, H.cot, 'H.cot', 'cot'),
    asin: fn(1, 1, Math.asin, 'Math.asin', 'arcsin'),
    acos: fn(1, 1, Math.acos, 'Math.acos', 'arccos'),
    atan: fn(1, 1, Math.atan, 'Math.atan', 'arctan'),
    sinh: fn(1, 1, Math.sinh, 'Math.sinh', 'sinh'),
    cosh: fn(1, 1, Math.cosh, 'Math.cosh', 'cosh'),
    tanh: fn(1, 1, Math.tanh, 'Math.tanh', 'tanh'),
    exp: fn(1, 1, Math.exp, 'Math.exp', 'exp'),
    ln: fn(1, 1, Math.log, 'Math.log', 'ln'),
    log: fn(1, 1, Math.log10, 'Math.log10', 'log'),
    sqrt: fn(1, 1, Math.sqrt, 'Math.sqrt', '√'),
    cbrt: fn(1, 1, Math.cbrt, 'Math.cbrt', '∛'),
    abs: fn(1, 1, Math.abs, 'Math.abs', 'abs'),
    sign: fn(1, 1, Math.sign, 'Math.sign', 'sign'),
    floor: fn(1, 1, Math.floor, 'Math.floor', 'floor'),
    ceil: fn(1, 1, Math.ceil, 'Math.ceil', 'ceil'),
    round: fn(1, 1, Math.round, 'Math.round', 'round'),
    atan2: fn(2, 2, Math.atan2, 'Math.atan2', 'atan2', 'atan2(y, x)'),
    mod: fn(2, 2, H.mod, 'H.mod', 'mod', 'mod(x, 2)'),
    pow: fn(2, 2, Math.pow, 'Math.pow', 'pow', 'pow(x, 3)'),
    min: fn(2, Infinity, Math.min, 'Math.min', 'min', 'min(x, y)'),
    max: fn(2, Infinity, Math.max, 'Math.max', 'max', 'max(x, y)'),
    hypot: fn(2, Infinity, Math.hypot, 'Math.hypot', 'hypot', 'hypot(x, y)'),
  };
  const FUNC_ALIASES = { arcsin: 'asin', arccos: 'acos', arctan: 'atan', sgn: 'sign', '√': 'sqrt' };
  // sin^-1(x) means arcsin(x), not 1/sin(x)
  const INVERSES = { sin: 'asin', cos: 'acos', tan: 'atan' };

  // Longest match wins, so "sinx" -> sin x, "xy" -> x y, "atan2" beats "atan".
  const WORDS = []
    .concat(Object.keys(VARIABLES), Object.keys(CONSTANTS), Object.keys(FUNCTIONS), Object.keys(FUNC_ALIASES))
    .sort((p, q) => q.length - p.length);

  const OPS = {
    '+': '+', '-': '-', '−': '-', '–': '-', '—': '-',
    '*': '*', '×': '*', '·': '*', '⋅': '*', '∙': '*', '•': '*',
    '/': '/', '÷': '/', '∕': '/',
    '^': '^',
  };
  const OP_TEXT = { '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^' };
  const SUPERSCRIPTS = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
    '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-',
  };

  const VAR_HINT = 'Try x, y, t, r, θ, the sliders a, b, c, or a function like sin(…).';

  // ---------------------------------------------------------------- errors

  function ParseError(message, start, end) {
    this.message = message;
    this.start = start;
    this.end = Math.max(end, start);
    this.isParseError = true;
  }

  function isFunctionName(name) {
    return Object.prototype.hasOwnProperty.call(FUNCTIONS, name) ||
      Object.prototype.hasOwnProperty.call(FUNC_ALIASES, name);
  }
  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  // ---------------------------------------------------------------- tokenizer

  function tokenize(src) {
    // Lower-case char by char so indices still line up with the original text.
    let s = '';
    for (const ch of src) s += ch.length === 1 && ch.toLowerCase().length === 1 ? ch.toLowerCase() : ch;
    const tokens = [];
    let i = 0;
    const n = s.length;
    while (i < n) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }

      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] || ''))) {
        const start = i;
        while (i < n && /[0-9]/.test(s[i])) i++;
        if (s[i] === '.') { i++; while (i < n && /[0-9]/.test(s[i])) i++; }
        if (s[i] === '.') throw new ParseError('A number can only have one decimal point', start, i + 1);
        const text = src.slice(start, i);
        const value = parseFloat(text);
        if (!isFinite(value)) throw new ParseError('That number is too large', start, i);
        tokens.push({ type: 'num', value, text, start, end: i });
        continue;
      }

      if (ch === '*' && s[i + 1] === '*') {
        tokens.push({ type: 'op', value: '^', text: '**', start: i, end: i + 2 });
        i += 2; continue;
      }
      if (has(OPS, ch)) {
        tokens.push({ type: 'op', value: OPS[ch], text: ch, start: i, end: i + 1 });
        i++; continue;
      }
      if (ch === '(' || ch === '[') { tokens.push({ type: 'lparen', text: ch, start: i, end: i + 1 }); i++; continue; }
      if (ch === ')' || ch === ']') { tokens.push({ type: 'rparen', text: ch, start: i, end: i + 1 }); i++; continue; }
      if (ch === ',') { tokens.push({ type: 'comma', text: ch, start: i, end: i + 1 }); i++; continue; }

      if (has(SUPERSCRIPTS, ch)) {
        const start = i;
        let digits = '';
        while (i < n && has(SUPERSCRIPTS, s[i])) digits += SUPERSCRIPTS[s[i++]];
        const value = Number(digits);
        if (!isFinite(value)) throw new ParseError('That superscript isn’t a number', start, i);
        tokens.push({ type: 'sup', value, text: src.slice(start, i), start, end: i });
        continue;
      }

      const word = WORDS.find((w) => s.startsWith(w, i));
      if (word) {
        tokens.push({ type: 'name', value: word, text: src.slice(i, i + word.length), start: i, end: i + word.length });
        i += word.length;
        continue;
      }

      if (/\p{L}/u.test(ch)) {
        const start = i;
        while (i < n && /\p{L}/u.test(s[i])) i++;
        const name = src.slice(start, i);
        throw new ParseError('Unknown name “' + name + '”. ' + VAR_HINT, start, i);
      }
      throw new ParseError('“' + ch + '” isn’t something I can use here', i, i + 1);
    }
    return tokens;
  }

  // ---------------------------------------------------------------- parser

  function bin(op, left, right) { return { type: 'bin', op, left, right }; }

  function Parser(tokens) {
    this.toks = tokens;
    this.i = 0;
  }
  Parser.prototype = {
    peek() { return this.toks[this.i]; },
    next() { return this.toks[this.i++]; },
    done() { return this.i >= this.toks.length; },
    isOp(tok, a, b) { return !!tok && tok.type === 'op' && (tok.value === a || tok.value === b); },
    startsFactor(tok) { return !!tok && (tok.type === 'num' || tok.type === 'name' || tok.type === 'lparen'); },

    parseExpression() {
      let node = this.parseTerm();
      while (this.isOp(this.peek(), '+', '-')) {
        const op = this.next().value;
        node = bin(op, node, this.parseTerm());
      }
      return node;
    },

    parseTerm() {
      let node = this.parseUnary();
      for (;;) {
        const tok = this.peek();
        if (this.isOp(tok, '*', '/')) {
          this.next();
          node = bin(tok.value, node, this.parseUnary());
        } else if (this.startsFactor(tok)) {
          node = bin('*', node, this.parsePower()); // implicit: 2x, x(y+1)
        } else {
          return node;
        }
      }
    },

    parseUnary() {
      const tok = this.peek();
      if (this.isOp(tok, '-')) { this.next(); return { type: 'neg', arg: this.parseUnary() }; }
      if (this.isOp(tok, '+')) { this.next(); return this.parseUnary(); }
      return this.parsePower();
    },

    parsePower() {
      const base = this.parsePostfix();
      if (this.isOp(this.peek(), '^')) {
        const caret = this.next();
        if (this.done()) throw new ParseError('Add an exponent after “^”', caret.start, caret.end);
        return { type: 'pow', base, exp: this.parseUnary() };
      }
      return base;
    },

    parsePostfix() {
      let node = this.parsePrimary();
      while (this.peek() && this.peek().type === 'sup') {
        const s = this.next();
        node = { type: 'pow', base: node, exp: { type: 'num', value: s.value, text: String(s.value) } };
      }
      return node;
    },

    parsePrimary() {
      const tok = this.peek();
      if (!tok) this.endedEarly();
      if (tok.type === 'num') {
        this.next();
        return { type: 'num', value: tok.value, text: tok.text };
      }
      if (tok.type === 'lparen') {
        this.next();
        const after = this.peek();
        if (after && after.type === 'rparen') {
          throw new ParseError('Empty parentheses — put something inside “( )”', tok.start, after.end);
        }
        const inner = this.parseExpression();
        const close = this.peek();
        if (!close) throw new ParseError('Missing a closing “)”', tok.start, tok.end);
        if (close.type !== 'rparen') this.unexpected(close);
        this.next();
        return inner;
      }
      if (tok.type === 'name') return this.parseName();
      return this.unexpected(tok);
    },

    parseName() {
      const tok = this.next();
      const word = tok.value;
      if (has(VARIABLES, word)) return { type: 'var', name: VARIABLES[word] };
      if (has(CONSTANTS, word)) return { type: 'const', name: CONSTANTS[word] };

      const name = FUNC_ALIASES[word] || word;
      const spec = FUNCTIONS[name];
      const example = spec.example || spec.label + '(x)';

      // sin^2 x, sin²(x), sin^-1(x)
      let power = null;
      if (this.isOp(this.peek(), '^')) {
        this.next();
        if (this.isOp(this.peek(), '-')) {
          this.next();
          power = { type: 'neg', arg: this.parsePrimary() };
        } else {
          power = this.parsePrimary();
        }
      } else if (this.peek() && this.peek().type === 'sup') {
        const s = this.next();
        power = { type: 'num', value: s.value, text: String(s.value) };
      }

      let args;
      const nxt = this.peek();
      if (nxt && nxt.type === 'lparen') {
        args = this.parseArgs(tok, spec, example);
      } else if (this.isOp(nxt, '-')) {
        args = [this.parseUnary()];
      } else if (this.startsFactor(nxt)) {
        // sin x, sin 2x, sin x^2 — the argument runs until the next function name.
        let arg = this.parsePower();
        for (;;) {
          const p = this.peek();
          if (!p || !(p.type === 'num' || (p.type === 'name' && !isFunctionName(p.value)))) break;
          arg = bin('*', arg, this.parsePower());
        }
        args = [arg];
      } else {
        throw new ParseError(spec.label + ' needs an input, e.g. ' + example, tok.start, tok.end);
      }

      if (args.length < spec.min || args.length > spec.max) {
        const count = spec.min === spec.max ? String(spec.min) : 'at least ' + spec.min;
        const plural = spec.min === 1 && spec.max === 1 ? 'input' : 'inputs';
        throw new ParseError(spec.label + ' takes ' + count + ' ' + plural + ', e.g. ' + example, tok.start, tok.end);
      }

      let node = { type: 'call', name, args };
      if (power) {
        const isMinusOne = power.type === 'neg' && power.arg.type === 'num' && power.arg.value === 1;
        if (isMinusOne && INVERSES[name]) node = { type: 'call', name: INVERSES[name], args };
        else node = { type: 'pow', base: node, exp: power };
      }
      return node;
    },

    parseArgs(nameTok, spec, example) {
      const open = this.next();
      const args = [];
      const first = this.peek();
      if (first && first.type === 'rparen') {
        throw new ParseError(spec.label + '( ) is empty — try ' + example, nameTok.start, first.end);
      }
      for (;;) {
        args.push(this.parseExpression());
        const t = this.peek();
        if (!t) throw new ParseError('Missing a closing “)”', open.start, open.end);
        if (t.type === 'comma') { this.next(); continue; }
        if (t.type === 'rparen') { this.next(); return args; }
        this.unexpected(t);
      }
    },

    endedEarly() {
      const last = this.toks[this.toks.length - 1];
      if (last && last.type === 'op') {
        throw new ParseError('Finish the expression after “' + OP_TEXT[last.value] + '”', last.start, last.end);
      }
      if (last && last.type === 'comma') {
        throw new ParseError('Add another input after the comma', last.start, last.end);
      }
      const end = last ? last.end : 0;
      throw new ParseError('The expression ends too early', end, end);
    },

    unexpected(tok) {
      switch (tok.type) {
        case 'rparen':
          throw new ParseError('Extra “)” — there’s no “(” to match it', tok.start, tok.end);
        case 'comma':
          throw new ParseError('Commas only separate function inputs, like atan2(y, x)', tok.start, tok.end);
        case 'sup':
          throw new ParseError('Put something before the superscript', tok.start, tok.end);
        case 'op':
          throw new ParseError('Something’s missing before “' + OP_TEXT[tok.value] + '”', tok.start, tok.end);
        default:
          throw new ParseError('Unexpected “' + tok.text + '”', tok.start, tok.end);
      }
    },
  };

  /**
   * Parse text into an AST.
   * @returns {{ok: true, ast: object, vars: Set<string>} | {ok: false, error: {message, start, end}}}
   */
  function parse(src) {
    try {
      if (typeof src !== 'string' || !src.trim()) {
        throw new ParseError('Type an expression here (use 0 for “nothing”)', 0, 0);
      }
      const tokens = tokenize(src);
      const p = new Parser(tokens);
      const ast = p.parseExpression();
      if (!p.done()) p.unexpected(p.peek());
      return { ok: true, ast, vars: usedVars(ast) };
    } catch (e) {
      if (e && e.isParseError) return { ok: false, error: { message: e.message, start: e.start, end: e.end } };
      throw e;
    }
  }

  function usedVars(ast, out) {
    out = out || new Set();
    (function walk(n) {
      switch (n.type) {
        case 'var': out.add(n.name); break;
        case 'neg': walk(n.arg); break;
        case 'bin': walk(n.left); walk(n.right); break;
        case 'pow': walk(n.base); walk(n.exp); break;
        case 'call': n.args.forEach(walk); break;
        default: break;
      }
    })(ast);
    return out;
  }

  // ---------------------------------------------------------------- compiler

  function toJS(n) {
    switch (n.type) {
      case 'num': return '(' + String(n.value) + ')';
      case 'var': return VAR_JS[n.name];
      case 'const': return CONST_JS[n.name];
      case 'neg': return '(-' + toJS(n.arg) + ')';
      case 'bin': return '(' + toJS(n.left) + n.op + toJS(n.right) + ')';
      case 'pow': return 'Math.pow(' + toJS(n.base) + ',' + toJS(n.exp) + ')';
      case 'call': return FUNCTIONS[n.name].js + '(' + n.args.map(toJS).join(',') + ')';
      default: throw new Error('Unknown node ' + n.type);
    }
  }

  function evalNode(n, env) {
    switch (n.type) {
      case 'num': return n.value;
      case 'var': return env[n.name];
      case 'const': return CONST_VALUE[n.name];
      case 'neg': return -evalNode(n.arg, env);
      case 'bin': {
        const l = evalNode(n.left, env);
        const r = evalNode(n.right, env);
        switch (n.op) {
          case '+': return l + r;
          case '-': return l - r;
          case '*': return l * r;
          default: return l / r;
        }
      }
      case 'pow': return Math.pow(evalNode(n.base, env), evalNode(n.exp, env));
      case 'call': return FUNCTIONS[n.name].impl.apply(null, n.args.map((a) => evalNode(a, env)));
      default: return NaN;
    }
  }

  /**
   * Compile two ASTs into f(x, y, t, a, b, c, out) that writes [Fx, Fy] into out.
   * Uses generated code from the whitelisted AST for speed; falls back to a tree
   * walker if the page forbids runtime code generation (strict CSP).
   */
  function compileField(astX, astY) {
    const vars = usedVars(astY, usedVars(astX));
    let pre = '';
    if (vars.has('r')) pre += 'var r=Math.sqrt(x*x+y*y);';
    if (vars.has('theta')) pre += 'var th=Math.atan2(y,x);';
    const body = '"use strict";return function(x,y,t,a,b,c,out){' + pre +
      'out[0]=' + toJS(astX) + ';out[1]=' + toJS(astY) + ';return out;};';
    try {
      // eslint-disable-next-line no-new-func
      const f = new Function('H', body)(H);
      f(0.3, 0.7, 0, 1, 1, 1, [0, 0]);
      return f;
    } catch (err) {
      const env = { x: 0, y: 0, t: 0, a: 0, b: 0, c: 0, r: 0, theta: 0 };
      return function (x, y, t, a, b, c, out) {
        env.x = x; env.y = y; env.t = t; env.a = a; env.b = b; env.c = c;
        env.r = Math.sqrt(x * x + y * y);
        env.theta = Math.atan2(y, x);
        out[0] = evalNode(astX, env);
        out[1] = evalNode(astY, env);
        return out;
      };
    }
  }

  /** Convenience for single expressions (used by tests). */
  function compileExpression(ast) {
    const f = compileField(ast, { type: 'num', value: 0, text: '0' });
    const out = [0, 0];
    return function (x, y, t, a, b, c) {
      return f(x || 0, y || 0, t || 0, a || 0, b || 0, c || 0, out)[0];
    };
  }

  // ---------------------------------------------------------------- pretty printer

  function prec(n) {
    if (n.type === 'bin') return n.op === '+' || n.op === '-' ? 1 : 2;
    if (n.type === 'neg') return 3;
    if (n.type === 'pow') return 4;
    return 5;
  }
  function paren(html) { return '<span class="pp">(</span>' + html + '<span class="pp">)</span>'; }
  function isNumeric(n) { return n.type === 'num' || (n.type === 'neg' && n.arg.type === 'num'); }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  /** Render an AST as readable math HTML (italic variables, superscripts, ·, −). */
  function toHTML(n) {
    switch (n.type) {
      case 'num': return '<span class="num">' + escapeHTML(n.text != null ? n.text : String(n.value)) + '</span>';
      case 'var': return '<i>' + VAR_HTML[n.name] + '</i>';
      case 'const': return n.name === 'pi' ? '<span class="cst">π</span>' : '<i>e</i>';
      case 'neg': {
        const inner = toHTML(n.arg);
        return '−' + (prec(n.arg) < 2 || n.arg.type === 'neg' ? paren(inner) : inner);
      }
      case 'bin': {
        let L = toHTML(n.left);
        let R = toHTML(n.right);
        if (n.op === '+' || n.op === '-') {
          if ((n.op === '-' && prec(n.right) <= 1) || n.right.type === 'neg') R = paren(R);
          return L + (n.op === '+' ? ' + ' : ' − ') + R;
        }
        const leftIsDiv = n.left.type === 'bin' && n.left.op === '/';
        const rightWrapped = prec(n.right) <= 2 || n.right.type === 'neg';
        if (prec(n.left) < 2 || leftIsDiv) L = paren(L);
        if (rightWrapped) R = paren(R);
        if (n.op === '/') return L + '<span class="op">/</span>' + R;
        const rightIsWordy = rightWrapped || n.right.type === 'var' || n.right.type === 'const' ||
          n.right.type === 'call' || (n.right.type === 'pow' && n.right.base.type !== 'num');
        if (isNumeric(n.left) && !leftIsDiv && rightIsWordy) return L + R;
        return L + '<span class="op">·</span>' + R;
      }
      case 'pow': {
        let B = toHTML(n.base);
        if (prec(n.base) < 5) B = paren(B);
        return B + '<sup>' + toHTML(n.exp) + '</sup>';
      }
      case 'call': {
        const args = n.args.map(toHTML).join(', ');
        if (n.name === 'abs') return '|' + args + '|';
        return '<span class="fn">' + FUNCTIONS[n.name].label + '</span>' + paren(args);
      }
      default: return '?';
    }
  }

  const api = {
    parse,
    usedVars,
    compileField,
    compileExpression,
    toHTML,
    escapeHTML,
    FUNCTIONS,
    VARIABLES,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.VP = root.VP || {}).Expr = api;
})(typeof self !== 'undefined' ? self : this);
