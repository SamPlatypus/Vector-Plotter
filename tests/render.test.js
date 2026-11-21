'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Expr = require('../js/parser.js');

// render.js and presets.js attach themselves to a VP namespace on the global-ish root.
const render = require('../js/render.js');
const presets = require('../js/presets.js');
const VP = render.VP || globalThis.VP;
const PRESETS = (presets.VP || globalThis.VP).PRESETS;

function field(xs, ys, params = {}) {
  const f = Expr.compileField(Expr.parse(xs).ast, Expr.parse(ys).ast);
  const p = Object.assign({ a: 1, b: 1, c: 1 }, params);
  return (x, y, t, out) => f(x, y, t, p.a, p.b, p.c, out);
}

test('every preset parses and is finite somewhere in its view', () => {
  assert.ok(PRESETS.length >= 12);
  const ids = new Set();
  for (const p of PRESETS) {
    assert.ok(!ids.has(p.id), 'duplicate id ' + p.id);
    ids.add(p.id);
    const rx = Expr.parse(p.x);
    const ry = Expr.parse(p.y);
    assert.ok(rx.ok, `${p.id} x: ${rx.error && rx.error.message}`);
    assert.ok(ry.ok, `${p.id} y: ${ry.error && ry.error.message}`);
    assert.equal(p.view.length, 4);
    assert.ok(p.view[1] > p.view[0] && p.view[3] > p.view[2]);
    const f = field(p.x, p.y, p.params);
    const out = f(0.37, 0.61, 0, [0, 0]);
    assert.ok(Number.isFinite(out[0]) && Number.isFinite(out[1]), p.id + ' not finite at a sample point');
  }
});

test('fmt gives compact, consistent numbers', () => {
  assert.equal(VP.fmt(0), '0');
  assert.equal(VP.fmt(1e-12), '0');
  assert.equal(VP.fmt(1.2649), '1.26');
  assert.equal(VP.fmt(-0.99996), '−1.00');
  assert.equal(VP.fmt(12.345), '12.3');
  assert.equal(VP.fmt(0.012345), '0.0123');
  assert.equal(VP.fmt(4321.6), '4322');
  assert.equal(VP.fmt(2.5e-5), '2.50e−5');
  assert.equal(VP.fmt(-2.5e-5), '−2.50e−5');
  assert.equal(VP.fmt(NaN), 'undefined');
  assert.equal(VP.fmt(Infinity), '∞');
});

test('view transform round-trips and zooms about a point', () => {
  const v = new VP.View();
  v.w = 400; v.h = 300;
  v.fit([-5, 5, -5, 5], 0);
  assert.equal(v.scale, 30); // limited by height
  assert.ok(Math.abs(v.wx(v.sx(1.25)) - 1.25) < 1e-12);
  assert.ok(Math.abs(v.wy(v.sy(-2.5)) + 2.5) < 1e-12);
  assert.equal(v.sy(1) < v.sy(0), true); // y grows upward on screen
  const wx = v.wx(100);
  const wy = v.wy(50);
  v.zoomAt(100, 50, 2.5);
  assert.ok(Math.abs(v.wx(100) - wx) < 1e-9 && Math.abs(v.wy(50) - wy) < 1e-9);
});

test('divergence and curl match the textbook values', () => {
  const rot = VP.diffOps(field('-y', 'x'), 0, 0.7, -1.3);
  assert.ok(Math.abs(rot.div) < 1e-8 && Math.abs(rot.curl - 2) < 1e-6);
  const src = VP.diffOps(field('x', 'y'), 0, 2, 3);
  assert.ok(Math.abs(src.div - 2) < 1e-6 && Math.abs(src.curl) < 1e-8);
  const shear = VP.diffOps(field('y', '0'), 0, 1, 1);
  assert.ok(Math.abs(shear.div) < 1e-8 && Math.abs(shear.curl + 1) < 1e-6);
  const g = VP.diffOps(field('x^2 y', 'sin(x) y'), 0, 0.5, 2);
  assert.ok(Math.abs(g.div - (2 * 0.5 * 2 + Math.sin(0.5))) < 1e-6);
  assert.ok(Math.abs(g.curl - (Math.cos(0.5) * 2 - 0.25)) < 1e-6);
});

test('streamlines close around a vortex and stop at a sink', () => {
  const v = new VP.View();
  v.w = 400; v.h = 400;
  v.fit([-5, 5, -5, 5], 0);
  const loop = VP.trace(field('-y', 'x'), 0, 2, 0, v, 1);
  assert.equal(loop.closed, true);
  // Every point stays on the circle r = 2.
  for (let i = 0; i < loop.pts.length; i += 2) {
    assert.ok(Math.abs(Math.hypot(loop.pts[i], loop.pts[i + 1]) - 2) < 0.02);
  }
  const sink = VP.trace(field('-x', '-y'), 0, 3, 1, v, 1);
  const n = sink.pts.length;
  assert.ok(Math.hypot(sink.pts[n - 2], sink.pts[n - 1]) < 0.1, 'should end near the origin');
});

test('particles advance along the field and stay usable', () => {
  const v = new VP.View();
  v.w = 300; v.h = 300;
  v.fit([-3, 3, -3, 3], 0);
  const ps = new VP.Particles();
  ps.configure(200, 10, v);
  assert.equal(ps.n, 200);
  const f = field('-y', 'x');
  const r0 = Array.from({ length: ps.n }, (_, i) => Math.hypot(ps.x[i], ps.y[i]));
  ps.step(f, 0, 1 / 60, 1 / 60, v, 3);
  let moved = 0;
  for (let i = 0; i < ps.n; i++) {
    assert.ok(Number.isFinite(ps.x[i]) && Number.isFinite(ps.y[i]));
    // Rotation preserves radius (to first order) unless the particle was recycled.
    if (Math.abs(Math.hypot(ps.x[i], ps.y[i]) - r0[i]) < 0.01) moved++;
  }
  assert.ok(moved > ps.n * 0.8);
  // A singular field must not produce NaNs.
  const bad = field('1/x', '1/y');
  for (let k = 0; k < 30; k++) ps.step(bad, 0, 1 / 60, 1 / 60, v, 1);
  for (let i = 0; i < ps.n; i++) assert.ok(Number.isFinite(ps.x[i]) && Number.isFinite(ps.y[i]));
});
