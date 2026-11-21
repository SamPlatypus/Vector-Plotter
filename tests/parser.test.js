'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Expr = require('../js/parser.js');

function ev(src, x = 0, y = 0, t = 0, a = 0, b = 0, c = 0) {
  const res = Expr.parse(src);
  assert.ok(res.ok, `expected "${src}" to parse, got: ${res.error && res.error.message}`);
  return Expr.compileExpression(res.ast)(x, y, t, a, b, c);
}
function close(actual, expected, eps = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `expected ${expected}, got ${actual}`);
}
function fails(src, pattern) {
  const res = Expr.parse(src);
  assert.equal(res.ok, false, `expected "${src}" to fail`);
  if (pattern) assert.match(res.error.message, pattern);
  return res.error;
}

test('operator precedence and associativity', () => {
  close(ev('1 + 2*3'), 7);
  close(ev('(1 + 2)*3'), 9);
  close(ev('2^3^2'), 512);
  close(ev('-x^2', 3), -9);
  close(ev('(-x)^2', 3), 9);
  close(ev('8/4/2'), 1);
  close(ev('2^-1'), 0.5);
  close(ev('10 - 4 - 3'), 3);
  close(ev('-3 + 5'), 2);
  close(ev('+x', 4), 4);
});

test('implicit multiplication', () => {
  close(ev('2x', 3), 6);
  close(ev('xy', 2, 5), 10);
  close(ev('3(x+1)', 2), 9);
  close(ev('(x+1)(x-1)', 3), 8);
  close(ev('2 sin(x) cos(y)', 0.3, 0.4), 2 * Math.sin(0.3) * Math.cos(0.4));
  close(ev('1/2x', 4), 2); // (1/2)·x, shown that way in the preview
  close(ev('a x - y', 2, 1, 0, 3), 5);
  close(ev('x2', 3), 6);
});

test('functions with and without parentheses', () => {
  close(ev('sin x', 0.5), Math.sin(0.5));
  close(ev('sinx', 0.5), Math.sin(0.5));
  close(ev('sin 2x', 0.5), Math.sin(1));
  close(ev('sin x^2', 1.5), Math.sin(2.25));
  close(ev('sin x cos y', 0.2, 0.3), Math.sin(0.2) * Math.cos(0.3));
  close(ev('sin^2 x + cos^2 x', 0.77), 1);
  close(ev('sin²(x)', 0.4), Math.sin(0.4) ** 2);
  close(ev('sin^-1(x)', 0.5), Math.asin(0.5));
  close(ev('atan2(y, x)', -1, 1), Math.atan2(1, -1));
  close(ev('max(x, y, 3)', 1, 2), 3);
  close(ev('mod(x, 3)', -1), 2);
  close(ev('log(100)'), 2);
  close(ev('ln(e)'), 1);
  close(ev('sqrt(16) + abs(-2)'), 6);
  close(ev('√x', 9), 3);
  close(ev('exp(-x)', 1), Math.exp(-1));
  close(ev('arctan(1)'), Math.PI / 4);
  close(ev('sec(0) + cot(pi/4)'), 2);
});

test('variables, constants and parameters', () => {
  close(ev('pi'), Math.PI);
  close(ev('2π'), 2 * Math.PI);
  close(ev('e^x', 2), Math.exp(2));
  close(ev('r', 3, 4), 5);
  close(ev('θ', 0, 1), Math.PI / 2);
  close(ev('theta', -1, 0), Math.PI);
  close(ev('a + b + c', 0, 0, 0, 1, 2, 3), 6);
  close(ev('t', 0, 0, 7), 7);
});

test('unicode and phone-keyboard input', () => {
  close(ev('−y', 0, 2), -2);
  close(ev('2×x', 3), 6);
  close(ev('x·y', 2, 3), 6);
  close(ev('x÷2', 3), 1.5);
  close(ev('x²+y³', 2, 2), 12);
  close(ev('x**2', 3), 9);
  close(ev('Sin(X)', 0.3), Math.sin(0.3)); // auto-capitalised keyboards
  close(ev('[x+1]*2', 1), 4);
});

test('helpful errors with positions', () => {
  fails('', /Type an expression/);
  fails('   ', /Type an expression/);
  fails('x +', /Finish the expression after “\+”/);
  fails('(x + 1', /Missing a closing/);
  fails('x + 1)', /Extra “\)”/);
  const unknown = fails('x + foo', /Unknown name “foo”/);
  assert.deepEqual([unknown.start, unknown.end], [4, 7]);
  fails('atan2(x)', /takes 2 inputs/);
  fails('sin', /needs an input/);
  fails('sin()', /is empty/);
  fails(',x', /Commas only/);
  fails('x * * y', /missing before/);
  fails('1.2.3', /one decimal point/);
  fails('x ^', /exponent/);
  fails('()', /Empty parentheses/);
  fails('x $ y', /isn’t something/);
});

test('usedVars reports variables for sliders and time', () => {
  const res = Expr.parse('a x + sin(t) - r');
  assert.ok(res.ok);
  assert.deepEqual([...res.vars].sort(), ['a', 'r', 't', 'x']);
});

test('compileField writes both components and handles r/θ', () => {
  const px = Expr.parse('-y + a r');
  const py = Expr.parse('x + θ');
  const f = Expr.compileField(px.ast, py.ast);
  const out = f(3, 4, 0, 2, 0, 0, [0, 0]);
  close(out[0], -4 + 10);
  close(out[1], 3 + Math.atan2(4, 3));
});

test('pretty printer is readable and safe', () => {
  const html = (s) => Expr.toHTML(Expr.parse(s).ast).replace(/<[^>]+>/g, '');
  assert.equal(html('-sin(x) - a*y'), '−sin(x) − a·y');
  assert.equal(html('2x^2'), '2x2'); // superscript rendered with <sup>
  assert.equal(html('1/2x'), '(1/2)·x');
  assert.equal(html('x - (y - 1)'), 'x − (y − 1)');
  assert.equal(html('x - -y'), 'x − (−y)');
  assert.equal(html('abs(x)'), '|x|');
  assert.equal(html('asin(x)'), 'arcsin(x)');
  assert.match(Expr.toHTML(Expr.parse('x^2').ast), /<sup>/);
});
