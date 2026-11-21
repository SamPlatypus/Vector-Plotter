/*
 * Vector Plotter — app controller.
 * Wires the equation editor, presets, display controls, gestures, the probe
 * readout and the animation loop together. State persists in localStorage.
 */
(function () {
  'use strict';

  const VP = window.VP;
  const Expr = VP.Expr;
  const fmt = VP.fmt;
  const esc = Expr.escapeHTML;
  const $ = (id) => document.getElementById(id);

  const STORAGE_KEY = 'vector-plotter:v1';
  const HINT_KEY = 'vector-plotter:hinted';
  const PARAMS = ['a', 'b', 'c'];
  const PARAM_RANGE = 5;

  const coarsePointer = matchMedia('(pointer: coarse)').matches;
  const canHover = matchMedia('(hover: hover)').matches;
  // Particles are tuned so a "strong" arrow on screen (95th percentile) moves at
  // about this many pixels per second at 1× speed. That keeps weak fields lively
  // and strong ones readable; relative speeds within a field are preserved.
  const FLOW_PX_PER_SEC = 170;
  const PROBE_TIPS_KEY = 'vector-plotter:probe-tips';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');

  const DEFAULTS = {
    arrows: true,
    density: 55,
    mode: 'uniform',
    size: 1,
    colorArrows: true,
    particles: null, // null = pick a count that suits the screen
    trail: 18,
    speed: 50,
    colorParticles: false,
    grid: true,
    theme: 'auto',
  };

  // ------------------------------------------------------------------ DOM

  const stage = $('stage');
  const cvField = $('cv-field');
  const cvFlow = $('cv-flow');
  const ctxField = cvField.getContext('2d', { alpha: false });
  const ctxFlow = cvFlow.getContext('2d');
  const panel = $('panel');
  const inputs = { x: $('in-x'), y: $('in-y') };
  const previews = { x: $('pv-x'), y: $('pv-y') };
  const eqRows = { x: inputs.x.closest('.eq'), y: inputs.y.closest('.eq') };
  const readout = $('readout');
  const ro = {
    pos: $('ro-pos'), fx: $('ro-fx'), fy: $('ro-fy'), mag: $('ro-mag'), ang: $('ro-ang'),
    div: $('ro-div'), divNote: $('ro-div-note'), curl: $('ro-curl'), curlNote: $('ro-curl-note'),
  };
  const btnPlay = $('btn-play');
  const hint = $('hint');

  // ------------------------------------------------------------------ state

  const state = {
    good: { x: null, y: null }, // last ASTs that parsed
    ok: { x: true, y: true },
    fieldFn: (x, y, t, a, b, c, out) => { out[0] = 0; out[1] = 0; return out; },
    vars: new Set(),
    params: { a: 1, b: 1, c: 1 },
    t: 0,
    playing: !reducedMotion,
    presetId: null,
    presetView: [-5, 5, -5, 5],
    settings: Object.assign({}, DEFAULTS),
  };
  const P = state.params;
  const evalField = (x, y, t, out) => state.fieldFn(x, y, t, P.a, P.b, P.c, out);

  const view = new VP.View();
  const fieldLayer = new VP.FieldLayer();
  const particles = new VP.Particles();
  let theme = VP.THEMES.dark;
  let dpr = 1;
  let sized = false;
  let pendingView = null;
  let norm = 1;
  let autoParticles = 800;
  const dirty = { field: true, flow: true, probe: true };
  const markAll = () => { dirty.field = dirty.flow = dirty.probe = true; };

  const probe = { active: false, pinned: false, touch: false, x: 0, y: 0, v: [0, 0] };
  let probeGeom = null;

  // ------------------------------------------------------------------ helpers

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const spacingFor = (d) => 84 * Math.pow(18 / 84, d / 100);
  const speedFor = (s) => Math.pow(8, (s - 50) / 50);
  const isSheetLayout = () => getComputedStyle(panel).borderTopLeftRadius !== '0px';
  const sheetOverlap = () => Math.max(0, -parseFloat(getComputedStyle(panel).marginTop) || 0);

  function setFill(range) {
    const min = parseFloat(range.min);
    const max = parseFloat(range.max);
    const pct = ((parseFloat(range.value) - min) / (max - min)) * 100;
    range.style.setProperty('--fill', clamp(pct, 0, 100) + '%');
  }
  function particleCount() {
    return state.settings.particles == null ? autoParticles : state.settings.particles;
  }

  // ------------------------------------------------------------------ persistence

  let saveTimer = 0;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 350);
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        v: 1,
        x: inputs.x.value,
        y: inputs.y.value,
        params: state.params,
        presetId: state.presetId,
        presetView: state.presetView,
        settings: state.settings,
        view: { cx: view.cx, cy: view.cy, scale: view.scale },
      }));
    } catch (e) { /* private mode or storage full: fine, just don't persist */ }
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && s.v === 1 && typeof s.x === 'string' && typeof s.y === 'string') return s;
    } catch (e) { /* ignore */ }
    return null;
  }

  // ------------------------------------------------------------------ equation editing

  function renderPreview(comp, res, text) {
    const row = eqRows[comp];
    row.classList.toggle('valid', res.ok);
    row.classList.toggle('invalid', !res.ok);
    if (res.ok) {
      previews[comp].innerHTML = '<span class="reads">reads as</span>' + Expr.toHTML(res.ast);
      return;
    }
    const err = res.error;
    let html = '<span class="err">' + esc(err.message) + '</span>';
    if (text.trim()) {
      const s = clamp(err.start, 0, text.length);
      const e = clamp(err.end, s, text.length);
      html += '<span class="src">' + esc(text.slice(0, s)) + '<mark>' + (esc(text.slice(s, e)) || '&nbsp;') +
        '</mark>' + esc(text.slice(e)) + '</span>';
    }
    previews[comp].innerHTML = html;
  }

  function onEquationInput(comp) {
    const text = inputs[comp].value;
    const res = Expr.parse(text);
    state.ok[comp] = res.ok;
    if (res.ok) state.good[comp] = res.ast;
    renderPreview(comp, res, text);
    rebuildField();
  }

  function rebuildField() {
    if (!state.good.x || !state.good.y) return;
    state.fieldFn = Expr.compileField(state.good.x, state.good.y);
    state.vars = Expr.usedVars(state.good.y, Expr.usedVars(state.good.x));
    $('stale').hidden = state.ok.x && state.ok.y;
    $('sum-eq').innerHTML = '<span class="pp">(</span>' + Expr.toHTML(state.good.x) + ', ' +
      Expr.toHTML(state.good.y) + '<span class="pp">)</span>';
    syncParamsVisibility();
    syncTimeUI(true);
    syncPresetHighlight();
    markAll();
    saveSoon();
  }

  // ------------------------------------------------------------------ chips (quick insert)

  const CHIPS = [
    ['x'], ['y'], ['t', 't', '', 'time'], ['r', 'r', '', 'distance from origin'], ['θ', 'θ', '', 'angle'],
    ['a'], ['b'], ['c'], null,
    ['+', '+', 'op'], ['−', '-', 'op'], ['×', '*', 'op'], ['÷', '/', 'op'], ['^', '^', 'op'], ['²', '^2', 'op', 'squared'],
    ['(', '(', 'op'], [')', ')', 'op'], null,
    ['π', 'π', 'cst', 'pi'], ['sin', 'sin', 'fn'], ['cos', 'cos', 'fn'], ['tan', 'tan', 'fn'], ['exp', 'exp', 'fn'],
    ['√', 'sqrt', 'fn', 'square root'], ['ln', 'ln', 'fn'], ['abs', 'abs', 'fn'], ['atan2', 'atan2', 'fn'],
    ['⌫', null, 'del', 'delete'],
  ];
  let lastFocused = 'x';

  function buildChips() {
    const bar = $('chips');
    for (const c of CHIPS) {
      const b = document.createElement('button');
      b.type = 'button';
      if (!c) { b.className = 'chip sep'; b.tabIndex = -1; b.setAttribute('aria-hidden', 'true'); bar.appendChild(b); continue; }
      const [label, insert = label, kind = '', name] = c;
      b.className = 'chip' + (kind ? ' ' + kind : '');
      b.textContent = label;
      b.setAttribute('aria-label', 'Insert ' + (name || label));
      // Keep the text field focused (and the phone keyboard up) while tapping chips.
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => insertChip(insert, kind));
      bar.appendChild(b);
    }
  }

  function insertChip(text, kind) {
    const comp = lastFocused;
    const el = inputs[comp];
    const v = el.value;
    let start = el.selectionStart == null ? v.length : el.selectionStart;
    let end = el.selectionEnd == null ? v.length : el.selectionEnd;
    if (document.activeElement !== el) { start = end = v.length; }

    if (kind === 'del') {
      if (start === end && start > 0) el.setRangeText('', start - 1, end, 'end');
      else el.setRangeText('', start, end, 'end');
    } else if (kind === 'fn') {
      const sel = v.slice(start, end);
      const pre = /[\p{L}]$/u.test(v.slice(0, start)) ? ' ' : '';
      el.setRangeText(pre + text + '(' + sel + ')', start, end, 'end');
      if (!sel) {
        const caret = start + pre.length + text.length + 1;
        el.setSelectionRange(caret, caret);
      }
    } else {
      // Keep words apart so "a" + "tan" doesn't become "atan".
      const before = v.slice(0, start);
      const after = v.slice(end);
      const letter = /[\p{L}]/u;
      const pre = letter.test(text[0]) && /[\p{L}]$/u.test(before) ? ' ' : '';
      const post = letter.test(text[text.length - 1]) && letter.test(after[0] || '') ? ' ' : '';
      el.setRangeText(pre + text + post, start, end, 'end');
    }
    el.focus({ preventScroll: true });
    onEquationInput(comp);
  }

  // ------------------------------------------------------------------ parameters (a, b, c)

  const paramEls = {};
  function buildParams() {
    const host = $('params');
    for (const name of PARAMS) {
      const row = document.createElement('div');
      row.className = 'param';
      row.hidden = true;
      row.innerHTML =
        '<label class="param-name" for="p-' + name + '">' + name + '</label>' +
        '<input type="range" id="p-' + name + '" min="-' + PARAM_RANGE + '" max="' + PARAM_RANGE + '" step="0.01">' +
        '<input type="number" class="param-num" step="any" aria-label="Value of ' + name + '">';
      host.appendChild(row);
      const range = row.querySelector('input[type=range]');
      const num = row.querySelector('.param-num');
      paramEls[name] = { row, range, num };
      range.addEventListener('input', () => setParam(name, parseFloat(range.value), 'range'));
      num.addEventListener('input', () => {
        const v = parseFloat(num.value);
        if (isFinite(v)) setParam(name, v, 'num');
      });
      num.addEventListener('change', () => { num.value = String(round2(state.params[name])); });
      num.addEventListener('keydown', (e) => { if (e.key === 'Enter') num.blur(); });
    }
  }
  const round2 = (v) => Math.round(v * 100) / 100;

  function setParam(name, v, from) {
    state.params[name] = v;
    const { range, num } = paramEls[name];
    if (from !== 'range') {
      const lim = Math.abs(v) > PARAM_RANGE ? Math.ceil(Math.abs(v) * 1.5) : PARAM_RANGE;
      if (from === 'reset' || lim > parseFloat(range.max)) { range.min = String(-lim); range.max = String(lim); }
      range.value = String(v);
    }
    if (from !== 'num') num.value = String(round2(v));
    setFill(range);
    markAll();
    saveSoon();
  }

  function syncParamsVisibility() {
    let any = false;
    for (const name of PARAMS) {
      const used = state.vars.has(name);
      paramEls[name].row.hidden = !used;
      any = any || used;
    }
    $('params-tip').hidden = any;
  }

  // ------------------------------------------------------------------ time

  let lastTimeText = '';
  function syncTimeUI(force) {
    const usesT = state.vars.has('t');
    $('time-group').hidden = !usesT;
    $('time-badge').hidden = !usesT;
    if (!usesT) return;
    const txt = state.t.toFixed(1);
    if (!force && txt === lastTimeText) return;
    lastTimeText = txt;
    $('t-val').textContent = state.t.toFixed(2);
    $('time-badge-val').textContent = txt;
  }

  // ------------------------------------------------------------------ presets

  const presetButtons = {};
  let thumbsFresh = false;
  const normalizeSrc = (s) => s.replace(/\s+/g, '').toLowerCase();

  function buildPresets() {
    const grid = $('preset-grid');
    for (const p of VP.PRESETS) {
      const ax = Expr.parse(p.x).ast;
      const ay = Expr.parse(p.y).ast;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML =
        '<canvas aria-hidden="true"></canvas>' +
        '<div class="p-body">' +
        '<div class="p-tag">' + esc(p.tag) + '</div>' +
        '<div class="p-name">' + esc(p.name) + '</div>' +
        '<div class="p-eq">(' + Expr.toHTML(ax) + ', ' + Expr.toHTML(ay) + ')</div>' +
        '<div class="p-blurb">' + esc(p.blurb) + '</div>' +
        '</div>';
      b.addEventListener('click', () => applyPreset(p.id));
      grid.appendChild(b);
      presetButtons[p.id] = { el: b, ax, ay, preset: p };
    }
  }

  function renderThumbs() {
    if (thumbsFresh || $('pane-presets').hidden) return;
    thumbsFresh = true;
    for (const id in presetButtons) {
      const { el, ax, ay, preset } = presetButtons[id];
      const f = Expr.compileField(ax, ay);
      const pp = Object.assign({ a: 1, b: 1, c: 1 }, preset.params);
      VP.drawThumb(el.querySelector('canvas'), (x, y, t, out) => f(x, y, 0, pp.a, pp.b, pp.c, out), preset.view, theme);
    }
  }

  function applyPreset(id) {
    const p = VP.PRESETS.find((q) => q.id === id);
    if (!p) return;
    inputs.x.value = p.x;
    inputs.y.value = p.y;
    for (const name of PARAMS) {
      const v = p.params && p.params[name] != null ? p.params[name] : 1;
      setParam(name, v, 'reset');
    }
    state.presetId = p.id;
    state.presetView = p.view.slice();
    state.t = 0;
    onEquationInput('x');
    onEquationInput('y');
    fitView();
    particles.reseed(view);
    clearProbe();
    markAll();
    saveSoon();
  }

  function syncPresetHighlight() {
    const sx = normalizeSrc(inputs.x.value);
    const sy = normalizeSrc(inputs.y.value);
    let match = null;
    for (const p of VP.PRESETS) {
      if (normalizeSrc(p.x) === sx && normalizeSrc(p.y) === sy) { match = p.id; break; }
    }
    for (const id in presetButtons) presetButtons[id].el.setAttribute('aria-pressed', String(id === match));
    if (match) state.presetId = match;
  }

  // ------------------------------------------------------------------ display controls

  const ui = {
    arrows: $('s-arrows'), density: $('s-density'), size: $('s-size'), colorArrows: $('s-colorArrows'),
    particles: $('s-particles'), trail: $('s-trail'), speed: $('s-speed'), colorParticles: $('s-colorParticles'),
    grid: $('s-grid'), mode: $('s-mode'), theme: $('s-theme'),
  };

  function trailWord(v) {
    if (v === 0) return 'Dots only';
    if (v <= 8) return 'Short';
    if (v <= 30) return 'Medium';
    return 'Long';
  }

  function syncOutputs() {
    const s = state.settings;
    const spacing = spacingFor(s.density);
    $('o-density').textContent = '≈ ' + Math.max(1, Math.round((view.w * view.h) / (spacing * spacing))) + ' arrows';
    $('o-size').textContent = Math.round(s.size * 100) + '%';
    const n = particleCount();
    $('o-particles').textContent = n === 0 ? 'Off' : n.toLocaleString();
    $('o-trail').textContent = trailWord(s.trail);
    const sp = speedFor(s.speed);
    $('o-speed').textContent = (sp < 1 ? sp.toFixed(2) : sp.toFixed(1)) + '×';
  }

  function syncDisplayUI() {
    const s = state.settings;
    ui.arrows.checked = s.arrows;
    ui.density.value = s.density;
    ui.size.value = s.size;
    ui.colorArrows.checked = s.colorArrows;
    ui.particles.value = particleCount();
    ui.trail.value = s.trail;
    ui.speed.value = s.speed;
    ui.colorParticles.checked = s.colorParticles;
    ui.grid.checked = s.grid;
    for (const r of [ui.density, ui.size, ui.particles, ui.trail, ui.speed]) setFill(r);
    for (const seg of [ui.mode, ui.theme]) {
      const key = seg === ui.mode ? 'mode' : 'theme';
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.v === s[key]));
    }
    syncOutputs();
  }

  function bindDisplay() {
    const s = state.settings;
    const onChange = (fn) => () => { fn(); syncOutputs(); markAll(); saveSoon(); };

    ui.arrows.addEventListener('change', onChange(() => { s.arrows = ui.arrows.checked; }));
    ui.colorArrows.addEventListener('change', onChange(() => { s.colorArrows = ui.colorArrows.checked; }));
    ui.colorParticles.addEventListener('change', onChange(() => { s.colorParticles = ui.colorParticles.checked; }));
    ui.grid.addEventListener('change', onChange(() => { s.grid = ui.grid.checked; }));

    const range = (el, fn) => el.addEventListener('input', onChange(() => { fn(parseFloat(el.value)); setFill(el); }));
    range(ui.density, (v) => { s.density = v; });
    range(ui.size, (v) => { s.size = v; });
    range(ui.speed, (v) => { s.speed = v; });
    range(ui.particles, (v) => { s.particles = v; configureParticles(); });
    range(ui.trail, (v) => { s.trail = v; configureParticles(); });

    const seg = (el, key, after) => el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      s[key] = b.dataset.v;
      for (const x of el.querySelectorAll('button')) x.setAttribute('aria-checked', String(x === b));
      if (after) after();
      syncOutputs(); markAll(); saveSoon();
    });
    seg(ui.mode, 'mode');
    seg(ui.theme, 'theme', applyTheme);

    $('btn-reseed').addEventListener('click', () => { particles.reseed(view); dirty.flow = true; });
    $('btn-reset-all').addEventListener('click', () => {
      Object.assign(state.settings, DEFAULTS);
      applyTheme();
      configureParticles();
      syncDisplayUI();
      markAll();
      saveSoon();
    });
  }

  function configureParticles() {
    particles.configure(particleCount(), state.settings.trail, view);
    dirty.flow = true;
  }

  // ------------------------------------------------------------------ theme

  function applyTheme() {
    const pref = state.settings.theme;
    const resolved = pref === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : pref;
    document.documentElement.dataset.theme = resolved;
    theme = VP.THEMES[resolved];
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#10151f' : '#ffffff');
    $('legend-bar').style.background = VP.rampCSS(theme.ramp);
    thumbsFresh = false;
    renderThumbs();
    markAll();
  }
  darkQuery.addEventListener('change', () => { if (state.settings.theme === 'auto') applyTheme(); });

  // ------------------------------------------------------------------ view & sizing

  function fitView() {
    const r = state.presetView;
    const top = 12;
    const bottom = sheetOverlap() + 12;
    const w = Math.max(10, view.w - 24);
    const h = Math.max(10, view.h - top - bottom);
    view.scale = Math.min(w / (r[1] - r[0]), h / (r[3] - r[2]));
    view.cx = (r[0] + r[1]) / 2;
    const midSy = (top + view.h - bottom) / 2;
    view.cy = (r[2] + r[3]) / 2 + (midSy - view.h / 2) / view.scale;
    onViewChanged();
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [cvField, cvFlow]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    view.w = w;
    view.h = h;
    if (!sized) {
      sized = true;
      autoParticles = Math.round(clamp((w * h) / 360, 300, 1800) / 50) * 50;
      if (pendingView && pendingView.scale > 0 && isFinite(pendingView.cx) && isFinite(pendingView.cy)) {
        view.cx = pendingView.cx; view.cy = pendingView.cy; view.scale = pendingView.scale;
      } else {
        fitView();
      }
      configureParticles();
      syncDisplayUI();
    }
    syncOutputs();
    markAll();
  }

  function onViewChanged() {
    markAll();
    saveSoon();
  }

  // ------------------------------------------------------------------ probe & readout

  const DIRS = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];

  function setProbe(x, y, pinned, touch) {
    probe.active = true;
    probe.pinned = pinned;
    probe.touch = touch;
    probe.x = x;
    probe.y = y;
    readout.hidden = false;
    // A hover probe's card lets the mouse pass through to the plot underneath.
    readout.classList.toggle('passive', !pinned);
    dirty.probe = true;
  }
  /** The "what's the yellow line" note is for newcomers: retire it after a few probes. */
  function probeTipsSeen() {
    try { return Number(localStorage.getItem(PROBE_TIPS_KEY)) || 0; } catch (e) { return 0; }
  }
  function noteProbeUse() {
    const n = probeTipsSeen() + 1;
    try { localStorage.setItem(PROBE_TIPS_KEY, String(n)); } catch (e) { /* ignore */ }
    if (n > 3) $('ro-foot').hidden = true;
  }

  function clearProbe() {
    probe.active = false;
    probe.pinned = false;
    probeGeom = null;
    readout.hidden = true;
    dirty.probe = true;
  }

  /**
   * Keep the readout card from sitting on top of the probe it describes.
   * It stays put unless it covers the probe; then it tries the other spots.
   */
  const SPOTS = ['', 'flip', 'low'];
  let autoCompactOK = true; // false once the user expands/shrinks the card themselves
  let autoCompacted = false;
  function placeReadout() {
    if (readout.hidden) return;
    const px = view.sx(probe.x);
    const py = view.sy(probe.y);
    const covers = () => {
      const pad = 20;
      const x = readout.offsetLeft;
      const y = readout.offsetTop;
      return px > x - pad && px < x + readout.offsetWidth + pad && py > y - pad && py < y + readout.offsetHeight + pad;
    };
    if (!covers()) return;
    const trySpots = () => {
      for (const spot of SPOTS) {
        readout.classList.toggle('flip', spot === 'flip');
        readout.classList.toggle('low', spot === 'low');
        if (!covers()) return true;
      }
      return false;
    };
    if (trySpots()) return;
    // Small screen: no spot is clear, so fall back to the compact card.
    if (autoCompactOK && !readout.classList.contains('compact')) {
      readout.classList.add('compact');
      autoCompacted = true;
      if (trySpots()) return;
    }
    readout.classList.remove('flip', 'low');
  }

  function updateProbe() {
    if (!probe.active) { probeGeom = null; return; }
    const out = evalField(probe.x, probe.y, state.t, [0, 0]);
    const fx = out[0];
    const fy = out[1];
    probe.v[0] = fx;
    probe.v[1] = fy;
    probeGeom = {
      fwd: VP.trace(evalField, state.t, probe.x, probe.y, view, 1),
      back: VP.trace(evalField, state.t, probe.x, probe.y, view, -1),
    };

    placeReadout();

    const m = Math.hypot(fx, fy);
    ro.pos.textContent = '(' + fmt(probe.x) + ', ' + fmt(probe.y) + ')';
    ro.fx.textContent = fmt(fx);
    ro.fy.textContent = fmt(fy);
    ro.mag.textContent = fmt(m);
    if (m > 0 && m < Infinity) {
      let deg = (Math.atan2(fy, fx) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      ro.ang.textContent = DIRS[Math.round(deg / 45) % 8] + ' ' + deg.toFixed(1) + '°';
    } else {
      ro.ang.textContent = m === 0 ? 'none (F = 0)' : '—';
    }

    const d = VP.diffOps(evalField, state.t, probe.x, probe.y);
    const eps = 1e-5 * Math.max(1, norm);
    const show = (v) => (Math.abs(v) < eps ? '0' : fmt(v));
    ro.div.textContent = isFinite(d.div) ? show(d.div) : '—';
    ro.curl.textContent = isFinite(d.curl) ? show(d.curl) : '—';
    ro.divNote.textContent = !isFinite(d.div) ? '' : d.div > eps ? 'spreading out' : d.div < -eps ? 'squeezing in' : 'balanced';
    ro.curlNote.textContent = !isFinite(d.curl) ? '' : d.curl > eps ? '↺ counter-clockwise' : d.curl < -eps ? '↻ clockwise' : 'no spin';
  }

  // Tap the card to shrink/expand it. Only count presses that *started* on the card:
  // a tap on the plot makes the card appear under the finger, and the browser's
  // follow-up click would otherwise land on it.
  let pressOnReadout = false;
  readout.addEventListener('pointerdown', () => { pressOnReadout = true; });
  readout.addEventListener('click', (e) => {
    const ours = pressOnReadout;
    pressOnReadout = false;
    if (!ours || e.target.closest('#ro-close')) return;
    readout.classList.toggle('compact');
    autoCompactOK = false;
    autoCompacted = false;
  });
  $('ro-close').addEventListener('click', (e) => { e.stopPropagation(); clearProbe(); });

  // ------------------------------------------------------------------ gestures

  const pointers = new Map();
  let gesture = null;

  function local(e) {
    const r = cvFlow.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function nearProbe(p, type) {
    if (!probe.active) return false;
    const d = Math.hypot(p.x - view.sx(probe.x), p.y - view.sy(probe.y));
    return d < (type === 'mouse' ? 12 : 32);
  }

  function startPinch() {
    const [a, b] = [...pointers.values()];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    gesture = {
      type: 'pinch',
      d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
      s0: view.scale,
      wx: view.wx(mx),
      wy: view.wy(my),
    };
  }
  function updatePinch() {
    const [a, b] = [...pointers.values()];
    const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    view.scale = clamp((gesture.s0 * d) / gesture.d0, 0.05, 2e5);
    view.cx = gesture.wx - (mx - view.w / 2) / view.scale;
    view.cy = gesture.wy + (my - view.h / 2) / view.scale;
    onViewChanged();
  }

  cvFlow.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dismissHint();
    if (document.activeElement && document.activeElement.blur && coarsePointer) document.activeElement.blur();
    try { cvFlow.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const p = local(e);
    pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y });
    if (pointers.size === 1) {
      gesture = probe.pinned && nearProbe(p, e.pointerType) ? { type: 'probe', moved: false } : { type: 'tap' };
    } else if (pointers.size === 2) {
      startPinch();
    }
  });

  cvFlow.addEventListener('pointermove', (e) => {
    const p = local(e);
    const rec = pointers.get(e.pointerId);
    if (!rec) {
      if (e.pointerType === 'mouse' && canHover) {
        if (!probe.pinned) setProbe(view.wx(p.x), view.wy(p.y), false, false);
        stage.classList.toggle('over-probe', probe.pinned && nearProbe(p, 'mouse'));
      }
      return;
    }
    const dx = p.x - rec.x;
    const dy = p.y - rec.y;
    rec.x = p.x;
    rec.y = p.y;
    if (!gesture) return;
    if (gesture.type === 'tap') {
      const slop = e.pointerType === 'mouse' ? 4 : 9;
      if (Math.hypot(p.x - rec.sx, p.y - rec.sy) > slop) {
        gesture = { type: 'pan' };
        stage.classList.add('panning');
        view.cx -= (p.x - rec.sx) / view.scale;
        view.cy += (p.y - rec.sy) / view.scale;
        onViewChanged();
      }
    } else if (gesture.type === 'pan') {
      view.cx -= dx / view.scale;
      view.cy += dy / view.scale;
      onViewChanged();
    } else if (gesture.type === 'probe') {
      gesture.moved = true;
      setProbe(view.wx(p.x), view.wy(p.y), true, e.pointerType !== 'mouse');
    } else if (gesture.type === 'pinch' && pointers.size >= 2) {
      updatePinch();
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    const p = local(e);
    if (e.type === 'pointerup' && gesture) {
      if (gesture.type === 'tap') {
        // A fresh probe gets the full card again (it re-shrinks only if it must).
        if (autoCompacted) { readout.classList.remove('compact'); autoCompacted = false; }
        autoCompactOK = true;
        setProbe(view.wx(p.x), view.wy(p.y), true, e.pointerType !== 'mouse');
        noteProbeUse();
      } else if (gesture.type === 'probe' && !gesture.moved && e.pointerType === 'mouse') {
        probe.pinned = false; // click the pinned probe again to let it follow the mouse
        readout.classList.add('passive');
      }
    }
    if (pointers.size === 1 && gesture && gesture.type === 'pinch') {
      const r = [...pointers.values()][0];
      r.sx = r.x; r.sy = r.y;
      gesture = { type: 'pan' };
    } else if (pointers.size === 0) {
      gesture = null;
      stage.classList.remove('panning');
    }
  }
  cvFlow.addEventListener('pointerup', endPointer);
  cvFlow.addEventListener('pointercancel', endPointer);
  cvFlow.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse' || probe.pinned || pointers.size) return;
    if (e.relatedTarget && stage.contains(e.relatedTarget)) return; // onto an overlay, still on the plot
    clearProbe();
  });

  cvFlow.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    const k = e.deltaMode === 1 ? 0.06 : 0.0016;
    view.zoomAt(p.x, p.y, Math.exp(-clamp(e.deltaY, -300, 300) * k));
    onViewChanged();
  }, { passive: false });

  // Safari's own pinch-zoom would fight ours.
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // ------------------------------------------------------------------ keyboard

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const tag = (t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' && tag !== 'button') { e.preventDefault(); setPlaying(!state.playing); }
    else if (e.key === 'f' || e.key === 'F') fitView();
    else if (e.key === 'Escape') clearProbe();
    else if (e.key === '+' || e.key === '=') { view.zoomAt(view.w / 2, view.h / 2, 1.25); onViewChanged(); }
    else if (e.key === '-' || e.key === '_') { view.zoomAt(view.w / 2, view.h / 2, 0.8); onViewChanged(); }
  });

  // ------------------------------------------------------------------ panel / tabs

  const paneScroll = {};
  function selectTab(name) {
    const body = $('panel-body');
    if (panel.dataset.pane) paneScroll[panel.dataset.pane] = body.scrollTop;
    panel.dataset.pane = name;
    for (const tab of document.querySelectorAll('.tab')) {
      const on = tab.dataset.pane === name;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      $('pane-' + tab.dataset.pane).hidden = !on;
    }
    body.scrollTop = paneScroll[name] || 0;
    if (name === 'presets') renderThumbs();
    if (name === 'display') syncOutputs();
  }
  function setCollapsed(on) {
    panel.classList.toggle('collapsed', on);
    $('grip').setAttribute('aria-expanded', String(!on));
    $('grip').setAttribute('aria-label', on ? 'Expand panel' : 'Collapse panel');
  }

  function bindPanel() {
    for (const tab of document.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => {
        const selected = tab.getAttribute('aria-selected') === 'true';
        if (isSheetLayout() && selected && !panel.classList.contains('collapsed')) { setCollapsed(true); return; }
        selectTab(tab.dataset.pane);
        setCollapsed(false);
      });
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const tabs = [...document.querySelectorAll('.tab')];
        const i = tabs.indexOf(tab);
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        selectTab(next.dataset.pane);
        next.focus();
      });
    }
    $('grip').addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));
    $('summary').addEventListener('click', () => {
      selectTab('field');
      setCollapsed(false);
    });

    // Swipe the sheet's header down/up to collapse/expand it.
    const top = panel.querySelector('.panel-top');
    let startY = null;
    top.addEventListener('pointerdown', (e) => { startY = e.clientY; });
    top.addEventListener('pointerup', (e) => {
      if (startY == null || !isSheetLayout()) return;
      const dy = e.clientY - startY;
      startY = null;
      if (dy > 36) setCollapsed(true);
      else if (dy < -36) setCollapsed(false);
    });
    top.addEventListener('pointercancel', () => { startY = null; });
  }

  // ------------------------------------------------------------------ equation input wiring

  function bindEquations() {
    for (const comp of ['x', 'y']) {
      const el = inputs[comp];
      el.addEventListener('input', () => onEquationInput(comp));
      el.addEventListener('focus', () => {
        lastFocused = comp;
        document.body.classList.add('editing');
        dismissHint();
      });
      el.addEventListener('blur', () => {
        setTimeout(() => {
          const a = document.activeElement;
          if (a !== inputs.x && a !== inputs.y) document.body.classList.remove('editing');
        }, 60);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (comp === 'x') inputs.y.focus();
        else el.blur();
      });
    }
    $('t-reset').addEventListener('click', () => {
      state.t = 0;
      syncTimeUI(true);
      markAll();
    });
  }

  // ------------------------------------------------------------------ play / pause

  function setPlaying(on) {
    state.playing = on;
    document.body.classList.toggle('paused', !on);
    btnPlay.setAttribute('aria-label', on ? 'Pause animation' : 'Play animation');
  }
  btnPlay.addEventListener('click', () => setPlaying(!state.playing));
  $('btn-fit').addEventListener('click', fitView);

  // ------------------------------------------------------------------ first-run hint

  let hintTimer = 0;
  function showHint() {
    try { if (localStorage.getItem(HINT_KEY)) return; } catch (e) { /* ignore */ }
    hint.innerHTML = coarsePointer
      ? '<b>Tap</b> anywhere to read the arrow there<br><b>Drag</b> to pan · <b>pinch</b> to zoom'
      : '<b>Hover</b> to read the field · <b>click</b> to pin it<br><b>Drag</b> to pan · <b>scroll</b> to zoom';
    hint.hidden = false;
    hintTimer = setTimeout(dismissHint, 7000);
  }
  function dismissHint() {
    if (hint.hidden || hint.classList.contains('fade')) return;
    clearTimeout(hintTimer);
    hint.classList.add('fade');
    setTimeout(() => { hint.hidden = true; }, 600);
    try { localStorage.setItem(HINT_KEY, '1'); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ render loop

  let lastLegend = '';
  function drawField() {
    const s = state.settings;
    ctxField.setTransform(dpr, 0, 0, dpr, 0, 0);
    const flowing = particleCount() > 0;
    norm = fieldLayer.draw(ctxField, view, evalField, state.t, {
      grid: s.grid,
      arrows: s.arrows,
      spacing: spacingFor(s.density),
      mode: s.mode,
      size: s.size,
      color: s.colorArrows,
      alpha: flowing ? theme.arrowAlpha * 0.72 : theme.arrowAlpha,
      smooth: state.playing && state.vars.has('t'),
      insets: { top: 0, bottom: sheetOverlap() },
    }, theme);
    const label = fmt(norm);
    if (label !== lastLegend) {
      lastLegend = label;
      $('legend-max').textContent = label + '+';
    }
    $('legend').hidden = !(s.arrows && s.colorArrows) && !(s.colorParticles && flowing);
  }

  function drawFlow() {
    ctxFlow.setTransform(1, 0, 0, 1, 0, 0);
    ctxFlow.clearRect(0, 0, cvFlow.width, cvFlow.height);
    ctxFlow.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (particles.n) {
      particles.draw(ctxFlow, view, theme, {
        trail: state.settings.trail,
        color: state.settings.colorParticles,
        width: 1.35,
      }, norm);
    }
    if (probe.active) VP.drawProbe(ctxFlow, view, probe, probeGeom, theme, probe.touch);
  }

  // If the device can't keep up (sustained < 25 fps), trim the automatic particle
  // count. A count the user picked themselves is left alone.
  let slowFor = 0;
  function governor(realDt) {
    if (!state.playing || !particles.n || state.settings.particles != null) return;
    slowFor = realDt > 0.04 ? slowFor + realDt : Math.max(0, slowFor - realDt);
    if (slowFor > 1.5 && autoParticles > 200) {
      slowFor = 0;
      autoParticles = Math.max(200, Math.round((autoParticles * 0.7) / 50) * 50);
      configureParticles();
      syncDisplayUI();
    }
  }

  let last = performance.now();
  function frame(now) {
    const realDt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (sized) {
      governor(realDt);
      if (state.playing) {
        const dt = realDt * speedFor(state.settings.speed);
        if (particles.n) {
          const k = clamp(FLOW_PX_PER_SEC / Math.max(1e-12, norm * view.scale), 1e-6, 1e6);
          particles.step(evalField, state.t, dt * k, realDt, view, norm);
        }
        state.t += dt;
        dirty.flow = true;
        if (state.vars.has('t')) {
          dirty.field = true;
          dirty.probe = true;
          syncTimeUI(false);
        }
      }
      if (dirty.field) { drawField(); dirty.field = false; }
      if (dirty.probe) { updateProbe(); dirty.flow = true; dirty.probe = false; }
      if (dirty.flow) { drawFlow(); dirty.flow = false; }
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ phone keyboard / viewport

  function bindViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      if (Math.abs(vv.scale - 1) > 0.01) return; // page zoomed: leave layout alone
      root.style.setProperty('--app-h', Math.round(vv.height) + 'px');
      if (vv.offsetTop > 0) window.scrollTo(0, 0);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
  }

  // ------------------------------------------------------------------ boot

  function boot() {
    buildChips();
    buildParams();
    buildPresets();
    bindEquations();
    bindDisplay();
    bindPanel();
    bindViewport();

    const saved = load();
    if (saved) {
      Object.assign(state.settings, DEFAULTS, saved.settings || {});
      state.presetView = Array.isArray(saved.presetView) && saved.presetView.length === 4 ? saved.presetView : state.presetView;
      state.presetId = saved.presetId || null;
      pendingView = saved.view || null;
      inputs.x.value = saved.x;
      inputs.y.value = saved.y;
      for (const name of PARAMS) {
        const v = saved.params && isFinite(saved.params[name]) ? saved.params[name] : 1;
        setParam(name, v, 'reset');
      }
      onEquationInput('x');
      onEquationInput('y');
      if (!state.good.x) { inputs.x.value = '-y'; onEquationInput('x'); }
      if (!state.good.y) { inputs.y.value = 'x'; onEquationInput('y'); }
    } else {
      const p = VP.PRESETS.find((q) => q.id === VP.DEFAULT_PRESET) || VP.PRESETS[0];
      inputs.x.value = p.x;
      inputs.y.value = p.y;
      for (const name of PARAMS) setParam(name, p.params && p.params[name] != null ? p.params[name] : 1, 'reset');
      state.presetId = p.id;
      state.presetView = p.view.slice();
      onEquationInput('x');
      onEquationInput('y');
    }

    if (probeTipsSeen() > 3) $('ro-foot').hidden = true;
    applyTheme();
    setPlaying(state.playing);
    selectTab('field');
    syncDisplayUI();

    new ResizeObserver(resize).observe(stage);
    requestAnimationFrame(frame);
    setTimeout(showHint, 700);

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
      });
    }

    // Exposed for debugging and automated checks.
    window.VP.app = { state, view, particles, applyPreset, setProbe, clearProbe, fitView, setPlaying };
  }

  boot();
})();
