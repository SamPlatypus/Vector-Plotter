/*
 * Vector Plotter — drawing.
 *   View        world <-> screen transform (equal x/y scale so angles are honest)
 *   FieldLayer  grid, axes and the arrow grid (redrawn only when something changes)
 *   Particles   advected tracers with fading trails, stored in world coordinates
 *   Probe       streamline + marker for the tapped/hovered point
 */
(function (root) {
  'use strict';
  const VP = root.VP = root.VP || {};

  // ------------------------------------------------------------------ themes

  const THEMES = {
    dark: {
      bg: '#0a0e16',
      grid: 'rgba(148,163,184,0.085)',
      axis: 'rgba(160,174,198,0.42)',
      label: 'rgba(168,180,204,0.82)',
      mono: '#8da2c4',
      particle: '#eef3ff',
      probe: '#ffd166',
      probeSoft: 'rgba(255,209,102,0.18)',
      probeInk: '#0a0e16',
      ramp: [[0, '#4361ee'], [0.33, '#4cc9f0'], [0.6, '#80ed99'], [0.8, '#ffd166'], [1, '#ff6b6b']],
      arrowAlpha: 0.9,
      particleAlpha: 0.85,
    },
    light: {
      bg: '#f7f8fb',
      grid: 'rgba(30,41,59,0.07)',
      axis: 'rgba(30,41,59,0.38)',
      label: 'rgba(51,65,85,0.85)',
      mono: '#5b6b85',
      particle: '#33415a',
      probe: '#d97706',
      probeSoft: 'rgba(217,119,6,0.16)',
      probeInk: '#ffffff',
      ramp: [[0, '#3b5bdb'], [0.33, '#0c9fc4'], [0.6, '#2f9e44'], [0.8, '#e09800'], [1, '#e03131']],
      arrowAlpha: 0.92,
      particleAlpha: 0.55,
    },
  };

  function hexToRgb(h) {
    const v = parseInt(h.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function sampleRamp(stops, u) {
    u = Math.min(1, Math.max(0, u));
    let k = 0;
    while (k < stops.length - 2 && u > stops[k + 1][0]) k++;
    const [p0, c0] = stops[k];
    const [p1, c1] = stops[k + 1];
    const f = Math.min(1, Math.max(0, (u - p0) / (p1 - p0)));
    const A = hexToRgb(c0);
    const B = hexToRgb(c1);
    return 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * f) + ',' +
      Math.round(A[1] + (B[1] - A[1]) * f) + ',' + Math.round(A[2] + (B[2] - A[2]) * f) + ')';
  }
  function makeRamp(stops, bins) {
    const out = [];
    for (let i = 0; i < bins; i++) out.push(sampleRamp(stops, bins === 1 ? 0 : i / (bins - 1)));
    return out;
  }
  function rampCSS(stops) {
    return 'linear-gradient(90deg, ' + stops.map(([p, c]) => c + ' ' + Math.round(p * 100) + '%').join(', ') + ')';
  }

  // ------------------------------------------------------------------ numbers

  function niceStep(raw) {
    const e = Math.floor(Math.log10(raw));
    const base = Math.pow(10, e);
    const f = raw / base;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * base;
  }
  function tickLabel(v, step) {
    if (Math.abs(v) < step * 1e-6) return '0';
    let s;
    if (step >= 1e5 || step < 1e-4) s = v.toExponential(1);
    else s = v.toFixed(Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
    return s.replace('-', '−');
  }
  /** Compact, stable number formatting for readouts. */
  function fmt(v) {
    if (v === Infinity || v === -Infinity) return v > 0 ? '∞' : '−∞';
    if (!isFinite(v)) return 'undefined';
    const a = Math.abs(v);
    let s;
    if (a < 5e-10) s = '0';
    else if (a >= 1e5 || a < 1e-3) s = v.toExponential(2).replace('e+', 'e');
    else if (a >= 999.5) s = v.toFixed(0);
    else s = v.toPrecision(3); // 3 significant figures: 1.26, 12.3, 0.0123
    return s.replace(/-/g, '−');
  }

  // ------------------------------------------------------------------ view

  function View() {
    this.cx = 0; this.cy = 0; this.scale = 40; this.w = 1; this.h = 1;
  }
  View.prototype = {
    sx(x) { return this.w / 2 + (x - this.cx) * this.scale; },
    sy(y) { return this.h / 2 - (y - this.cy) * this.scale; },
    wx(sx) { return this.cx + (sx - this.w / 2) / this.scale; },
    wy(sy) { return this.cy - (sy - this.h / 2) / this.scale; },
    bounds() {
      const hw = this.w / 2 / this.scale;
      const hh = this.h / 2 / this.scale;
      return { xmin: this.cx - hw, xmax: this.cx + hw, ymin: this.cy - hh, ymax: this.cy + hh };
    },
    fit(r, padPx) {
      const pad = padPx || 0;
      const w = Math.max(10, this.w - 2 * pad);
      const h = Math.max(10, this.h - 2 * pad);
      this.cx = (r[0] + r[1]) / 2;
      this.cy = (r[2] + r[3]) / 2;
      this.scale = Math.min(w / (r[1] - r[0]), h / (r[3] - r[2]));
    },
    zoomAt(sx, sy, factor) {
      const x = this.wx(sx);
      const y = this.wy(sy);
      this.scale = Math.min(2e5, Math.max(0.05, this.scale * factor));
      this.cx = x - (sx - this.w / 2) / this.scale;
      this.cy = y + (sy - this.h / 2) / this.scale;
    },
  };

  // ------------------------------------------------------------------ grid

  const LABEL_FONT = '11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  function drawGrid(ctx, view, theme, insets) {
    const b = view.bounds();
    const step = niceStep(88 / view.scale);
    const w = view.w;
    const h = view.h;
    const ix0 = Math.ceil(b.xmin / step);
    const ix1 = Math.floor(b.xmax / step);
    const iy0 = Math.ceil(b.ymin / step);
    const iy1 = Math.floor(b.ymax / step);

    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    for (let i = ix0; i <= ix1; i++) {
      const sx = Math.round(view.sx(i * step)) + 0.5;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
    }
    for (let j = iy0; j <= iy1; j++) {
      const sy = Math.round(view.sy(j * step)) + 0.5;
      ctx.moveTo(0, sy); ctx.lineTo(w, sy);
    }
    ctx.stroke();

    const ax = Math.round(view.sx(0)) + 0.5;
    const ay = Math.round(view.sy(0)) + 0.5;
    ctx.strokeStyle = theme.axis;
    ctx.beginPath();
    if (ax >= 0 && ax <= w) { ctx.moveTo(ax, 0); ctx.lineTo(ax, h); }
    if (ay >= 0 && ay <= h) { ctx.moveTo(0, ay); ctx.lineTo(w, ay); }
    ctx.stroke();

    // Labels stick to the axis, or to the screen edge when the axis is off-screen.
    const top = (insets && insets.top) || 0;
    const bottom = (insets && insets.bottom) || 0;
    ctx.font = LABEL_FONT;
    ctx.fillStyle = theme.label;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const ly = Math.min(Math.max(ay + 4, top + 4), h - bottom - 16);
    for (let i = ix0; i <= ix1; i++) {
      if (i === 0) continue;
      ctx.fillText(tickLabel(i * step, step), view.sx(i * step) + 3, ly);
    }
    ctx.textBaseline = 'bottom';
    const lx = Math.min(Math.max(ax + 4, 4), w - 44);
    for (let j = iy0; j <= iy1; j++) {
      if (j === 0) continue;
      const sy = view.sy(j * step) - 2;
      if (sy < top + 14 || sy > h - bottom - 2) continue;
      ctx.fillText(tickLabel(j * step, step), lx, sy);
    }
    if (ax >= 0 && ax <= w && ay >= top && ay <= h - bottom) {
      ctx.textBaseline = 'top';
      ctx.fillText('0', ax + 4, ay + 4);
    }
  }

  // ------------------------------------------------------------------ arrows

  const ARROW_BINS = 24;

  function FieldLayer() {
    this.cap = 0;
    this.norm = 1;
    this.count = 0;
    this.out = [0, 0];
  }
  FieldLayer.prototype = {
    ensure(n) {
      if (n <= this.cap) return;
      this.cap = n;
      this.px = new Float32Array(n);
      this.py = new Float32Array(n);
      this.vx = new Float32Array(n);
      this.vy = new Float32Array(n);
      this.mag = new Float32Array(n);
      this.sorted = new Float32Array(n);
      this.bin = new Uint8Array(n);
      this.order = new Int32Array(n);
    },

    /**
     * @param f    (x, y, t, out) => out   field evaluator
     * @param opt  { grid, arrows, spacing, mode: 'uniform'|'magnitude', size, color, smooth, insets }
     * @returns the magnitude used as "full scale" (95th percentile of what's visible)
     */
    draw(ctx, view, f, t, opt, theme) {
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, view.w, view.h);
      if (opt.grid) drawGrid(ctx, view, theme, opt.insets);

      // Sample on a world-aligned lattice (offset by half a cell so we never sit
      // exactly on the origin, where many fields are singular).
      const spacing = opt.spacing;
      const ws = spacing / view.scale;
      const b = view.bounds();
      const i0 = Math.floor(b.xmin / ws) - 1;
      const i1 = Math.ceil(b.xmax / ws);
      const j0 = Math.floor(b.ymin / ws) - 1;
      const j1 = Math.ceil(b.ymax / ws);
      this.ensure((i1 - i0 + 1) * (j1 - j0 + 1));
      const out = this.out;
      let n = 0;
      let finite = 0;
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * ws;
        const sx = view.sx(x);
        if (sx < -spacing || sx > view.w + spacing) continue;
        for (let j = j0; j <= j1; j++) {
          const y = (j + 0.5) * ws;
          const sy = view.sy(y);
          if (sy < -spacing || sy > view.h + spacing) continue;
          f(x, y, t, out);
          const vx = out[0];
          const vy = out[1];
          const m = Math.sqrt(vx * vx + vy * vy);
          this.px[n] = sx; this.py[n] = sy;
          this.vx[n] = vx; this.vy[n] = vy;
          this.mag[n] = m;
          if (m < Infinity) this.sorted[finite++] = m;
          n++;
        }
      }
      this.count = n;

      let norm = 0;
      if (finite) {
        const s = this.sorted.subarray(0, finite).sort();
        norm = s[Math.floor(0.95 * (finite - 1))] || s[finite - 1];
      }
      if (!(norm > 0)) norm = 1;
      if (opt.smooth && this.norm > 0 && isFinite(this.norm)) norm = this.norm + (norm - this.norm) * 0.12;
      this.norm = norm;

      if (opt.arrows && n) this.drawArrows(ctx, opt, theme, norm);
      return norm;
    },

    drawArrows(ctx, opt, theme, norm) {
      const n = this.count;
      const spacing = opt.spacing;
      const size = opt.size || 1;
      const uniform = opt.mode !== 'magnitude';
      const ramp = theme._arrowRamp || (theme._arrowRamp = makeRamp(theme.ramp, ARROW_BINS));
      const bins = opt.color ? ARROW_BINS : 1;

      // Bucket arrows by colour so each colour is a single fill() call.
      const counts = new Int32Array(bins + 1);
      for (let k = 0; k < n; k++) {
        const m = this.mag[k];
        let bi = 0;
        if (bins > 1 && m < Infinity) bi = Math.min(bins - 1, Math.floor((m / norm) * (bins - 1) + 0.5));
        this.bin[k] = bi;
        counts[bi + 1]++;
      }
      for (let k = 1; k <= bins; k++) counts[k] += counts[k - 1];
      const fill = counts.slice();
      for (let k = 0; k < n; k++) this.order[fill[this.bin[k]]++] = k;

      ctx.globalAlpha = opt.alpha != null ? opt.alpha : theme.arrowAlpha;
      const full = spacing * 0.78 * size;
      for (let bi = 0; bi < bins; bi++) {
        if (counts[bi] === counts[bi + 1]) continue;
        ctx.fillStyle = bins > 1 ? ramp[bi] : theme.mono;
        ctx.beginPath();
        for (let q = counts[bi]; q < counts[bi + 1]; q++) {
          const k = this.order[q];
          const m = this.mag[k];
          const sx = this.px[k];
          const sy = this.py[k];
          if (!(m < Infinity)) continue; // undefined here: leave a gap
          const rel = m / norm;
          const len = uniform ? full : full * Math.min(rel, 1.3);
          if (m === 0 || rel < 1e-9 || len < 2.2) {
            const d = Math.max(1, 1.3 * size);
            ctx.rect(sx - d / 2, sy - d / 2, d, d);
            continue;
          }
          addArrow(ctx, sx, sy, this.vx[k] / m, -this.vy[k] / m, len, size);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };

  function addArrow(ctx, sx, sy, ux, uy, len, size) {
    const half = len / 2;
    const hl = Math.min(len * 0.42, 4.5 + 3.5 * size);
    const hw = hl * 0.58;
    const sw = Math.max(0.55, Math.min(1.05, len * 0.055)) * Math.sqrt(size);
    const tx = sx + ux * half;
    const ty = sy + uy * half;
    const bx = sx - ux * half;
    const by = sy - uy * half;
    const nx = tx - ux * hl;
    const ny = ty - uy * hl;
    const px = -uy;
    const py = ux;
    ctx.moveTo(bx + px * sw, by + py * sw);
    ctx.lineTo(nx + px * sw, ny + py * sw);
    ctx.lineTo(nx + px * hw, ny + py * hw);
    ctx.lineTo(tx, ty);
    ctx.lineTo(nx - px * hw, ny - py * hw);
    ctx.lineTo(nx - px * sw, ny - py * sw);
    ctx.lineTo(bx - px * sw, by - py * sw);
    ctx.closePath();
  }

  // ------------------------------------------------------------------ particles

  const PARTICLE_BINS = 8;

  function Particles() {
    this.n = 0;
    this.L = 0;
    this.head = 0;
    this.out = [0, 0];
  }
  Particles.prototype = {
    /** (Re)allocate for n particles with `trail` remembered steps. */
    configure(n, trail, view) {
      const L = Math.max(1, (trail | 0) + 1);
      if (n === this.n && L === this.L) return;
      this.n = n;
      this.L = L;
      this.head = 0;
      this.x = new Float64Array(n);
      this.y = new Float64Array(n);
      this.age = new Float32Array(n);
      this.life = new Float32Array(n);
      this.spd = new Float32Array(n);
      this.bin = new Uint8Array(n);
      this.order = new Int32Array(n);
      this.hist = new Float32Array(n * L * 2);
      for (let i = 0; i < n; i++) this.spawn(i, view, true);
    },

    reseed(view) {
      for (let i = 0; i < this.n; i++) this.spawn(i, view, true);
    },

    spawn(i, view, initial) {
      const b = view.bounds();
      const x = b.xmin + Math.random() * (b.xmax - b.xmin);
      const y = b.ymin + Math.random() * (b.ymax - b.ymin);
      this.x[i] = x;
      this.y[i] = y;
      const life = 1.6 + Math.random() * 4.4;
      this.life[i] = life;
      this.age[i] = initial ? Math.random() * life : 0;
      this.spd[i] = 0;
      const n = this.n;
      const H = this.hist;
      for (let s = 0; s < this.L; s++) {
        const o = (s * n + i) * 2;
        H[o] = x;
        H[o + 1] = y;
      }
    },

    /**
     * Advance every particle with a midpoint (RK2) step.
     * norm is the "typical" field strength on screen; particles that race into a
     * singularity (|F| far above it) or park at an equilibrium are recycled so they
     * don't pile up into blobs.
     */
    step(f, t, dt, realDt, view, norm) {
      const n = this.n;
      if (!n) return;
      const out = this.out;
      const b = view.bounds();
      const padX = (b.xmax - b.xmin) * 0.06;
      const padY = (b.ymax - b.ymin) * 0.06;
      const maxD = 9 / view.scale; // never jump more than ~9px per frame
      const head = (this.head + 1) % this.L;
      this.head = head;
      const H = this.hist;
      const half = dt * 0.5;
      const tooFast = (norm > 0 ? norm : 1) * 8;
      // Screen pixels per second for a unit of field strength (dt may be rescaled).
      const pxPerUnit = realDt > 0 ? (view.scale * dt) / realDt : view.scale;
      for (let i = 0; i < n; i++) {
        let x = this.x[i];
        let y = this.y[i];
        this.age[i] += realDt;
        let alive = this.age[i] < this.life[i];
        if (alive) {
          f(x, y, t, out);
          f(x + half * out[0], y + half * out[1], t + half, out);
          const vx = out[0];
          const vy = out[1];
          let dx = vx * dt;
          let dy = vy * dt;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (!(d < Infinity)) {
            alive = false;
          } else {
            if (d > maxD) { const k = maxD / d; dx *= k; dy *= k; }
            x += dx;
            y += dy;
            const sp = Math.sqrt(vx * vx + vy * vy);
            this.spd[i] = sp;
            if (x < b.xmin - padX || x > b.xmax + padX || y < b.ymin - padY || y > b.ymax + padY) alive = false;
            else if (sp > tooFast) alive = false;
            else if (sp * pxPerUnit < 3 && this.age[i] > 0.8) alive = false; // parked
          }
        }
        if (!alive) { this.spawn(i, view, false); continue; }
        this.x[i] = x;
        this.y[i] = y;
        const o = (head * n + i) * 2;
        H[o] = x;
        H[o + 1] = y;
      }
    },

    draw(ctx, view, theme, opt, norm) {
      const n = this.n;
      if (!n) return;
      const L = this.L;
      const H = this.hist;
      const s = view.scale;
      const hw = view.w / 2;
      const hh = view.h / 2;
      const cx = view.cx;
      const cy = view.cy;
      const trail = Math.min(opt.trail | 0, L - 1);

      // Group by colour (speed) so we can batch strokes.
      const bins = opt.color ? PARTICLE_BINS : 1;
      const ramp = theme._particleRamp || (theme._particleRamp = makeRamp(theme.ramp, PARTICLE_BINS));
      const counts = new Int32Array(bins + 1);
      for (let i = 0; i < n; i++) {
        let bi = 0;
        if (bins > 1) bi = Math.min(bins - 1, Math.floor((this.spd[i] / norm) * (bins - 1) + 0.5) | 0);
        this.bin[i] = bi;
        counts[bi + 1]++;
      }
      for (let k = 1; k <= bins; k++) counts[k] += counts[k - 1];
      const fill = counts.slice();
      for (let i = 0; i < n; i++) this.order[fill[this.bin[i]]++] = i;

      const base = theme.particleAlpha;
      ctx.lineCap = 'butt';
      ctx.lineWidth = opt.width || 1.4;
      for (let bi = 0; bi < bins; bi++) {
        const q0 = counts[bi];
        const q1 = counts[bi + 1];
        if (q0 === q1) continue;
        const color = bins > 1 ? ramp[bi] : theme.particle;
        ctx.strokeStyle = color;
        // Trail: one stroke per age, oldest faintest. Long trails use every other
        // remembered point, which halves the work with no visible difference.
        const stride = trail >= 12 ? 2 : 1;
        for (let j = 0; j + stride <= trail; j += stride) {
          const sA = (this.head - j + L) % L;
          const sB = (sA - stride + L) % L;
          const fade = 1 - j / trail;
          ctx.globalAlpha = base * fade * fade * 0.9 + 0.02;
          ctx.beginPath();
          for (let q = q0; q < q1; q++) {
            const i = this.order[q];
            const oa = (sA * n + i) * 2;
            const ob = (sB * n + i) * 2;
            const x1 = H[oa];
            const y1 = H[oa + 1];
            const x0 = H[ob];
            const y0 = H[ob + 1];
            if (x1 === x0 && y1 === y0) continue;
            ctx.moveTo(hw + (x1 - cx) * s, hh - (y1 - cy) * s);
            ctx.lineTo(hw + (x0 - cx) * s, hh - (y0 - cy) * s);
          }
          ctx.stroke();
        }
        // Heads
        const r = trail === 0 ? 1.4 : 1.05;
        ctx.globalAlpha = Math.min(1, base + 0.15);
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let q = q0; q < q1; q++) {
          const i = this.order[q];
          ctx.rect(hw + (this.x[i] - cx) * s - r, hh - (this.y[i] - cy) * s - r, 2 * r, 2 * r);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };

  // ------------------------------------------------------------------ probe

  /**
   * Trace the streamline through (x0, y0) by following the field's direction
   * in ~3px steps. dir = 1 forward, -1 backward.
   */
  function trace(f, t, x0, y0, view, dir) {
    const h = 3 / view.scale;
    const b = view.bounds();
    const padX = (b.xmax - b.xmin) * 0.1;
    const padY = (b.ymax - b.ymin) * 0.1;
    const pts = [x0, y0];
    const out = [0, 0];
    let x = x0;
    let y = y0;
    let closed = false;
    for (let k = 0; k < 900; k++) {
      f(x, y, t, out);
      let m = Math.sqrt(out[0] * out[0] + out[1] * out[1]);
      if (!(m > 1e-12 && m < Infinity)) break;
      let ux = (dir * out[0]) / m;
      let uy = (dir * out[1]) / m;
      f(x + 0.5 * h * ux, y + 0.5 * h * uy, t, out);
      m = Math.sqrt(out[0] * out[0] + out[1] * out[1]);
      if (!(m > 1e-12 && m < Infinity)) break;
      ux = (dir * out[0]) / m;
      uy = (dir * out[1]) / m;
      x += h * ux;
      y += h * uy;
      pts.push(x, y);
      if (x < b.xmin - padX || x > b.xmax + padX || y < b.ymin - padY || y > b.ymax + padY) break;
      if (k > 12 && Math.hypot(x - x0, y - y0) < h * 0.9) { closed = true; break; }
      // Spiralled into a point: stop instead of jittering in place.
      if (k >= 40 && k % 20 === 0) {
        const p = pts.length - 42;
        if (Math.hypot(x - pts[p], y - pts[p + 1]) < h * 1.5) break;
      }
    }
    return { pts, closed };
  }

  function drawPolyline(ctx, view, pts) {
    ctx.beginPath();
    ctx.moveTo(view.sx(pts[0]), view.sy(pts[1]));
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(view.sx(pts[i]), view.sy(pts[i + 1]));
  }

  /** Little chevrons along the forward streamline so direction is obvious. */
  function drawChevrons(ctx, view, pts, every) {
    let acc = every * 0.6;
    ctx.beginPath();
    for (let i = 2; i < pts.length; i += 2) {
      const x0 = view.sx(pts[i - 2]);
      const y0 = view.sy(pts[i - 1]);
      const x1 = view.sx(pts[i]);
      const y1 = view.sy(pts[i + 1]);
      const d = Math.hypot(x1 - x0, y1 - y0);
      acc += d;
      if (acc >= every && d > 0) {
        acc = 0;
        const ux = (x1 - x0) / d;
        const uy = (y1 - y0) / d;
        ctx.moveTo(x1 - ux * 6 + uy * 4.5, y1 - uy * 6 - ux * 4.5);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x1 - ux * 6 - uy * 4.5, y1 - uy * 6 + ux * 4.5);
      }
    }
    ctx.stroke();
  }

  function drawProbe(ctx, view, probe, geom, theme, touch) {
    const px = view.sx(probe.x);
    const py = view.sy(probe.y);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (geom) {
      if (geom.back.pts.length > 2) {
        ctx.strokeStyle = theme.probe;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 5]);
        drawPolyline(ctx, view, geom.back.pts);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (geom.fwd.pts.length > 2) {
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = theme.probe;
        ctx.lineWidth = 2;
        drawPolyline(ctx, view, geom.fwd.pts);
        ctx.stroke();
        ctx.lineWidth = 1.8;
        drawChevrons(ctx, view, geom.fwd.pts, 70);
      }
    }
    ctx.globalAlpha = 1;

    if (touch && probe.pinned) {
      ctx.fillStyle = theme.probeSoft;
      ctx.beginPath();
      ctx.arc(px, py, 22, 0, Math.PI * 2);
      ctx.fill();
    }

    // Vector arrow at the probe (fixed length; the readout gives the size).
    const v = probe.v;
    const m = v ? Math.hypot(v[0], v[1]) : 0;
    if (m > 0 && m < Infinity) {
      const ux = v[0] / m;
      const uy = -v[1] / m;
      const len = 44;
      ctx.fillStyle = theme.probe;
      ctx.beginPath();
      addArrow(ctx, px + ux * len / 2, py + uy * len / 2, ux, uy, len, 1.6);
      ctx.fill();
    }

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = theme.probeInk;
    ctx.beginPath();
    ctx.arc(px, py, 6.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = theme.probe;
    ctx.stroke();
    ctx.fillStyle = theme.probe;
    ctx.beginPath();
    ctx.arc(px, py, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Divergence and curl by central differences. */
  function diffOps(f, t, x, y) {
    const h = 1e-4 * Math.max(1, Math.abs(x), Math.abs(y));
    const o = [0, 0];
    f(x + h, y, t, o); const pxP = o[0]; const qxP = o[1];
    f(x - h, y, t, o); const pxM = o[0]; const qxM = o[1];
    f(x, y + h, t, o); const pyP = o[0]; const qyP = o[1];
    f(x, y - h, t, o); const pyM = o[0]; const qyM = o[1];
    const dPdx = (pxP - pxM) / (2 * h);
    const dQdx = (qxP - qxM) / (2 * h);
    const dPdy = (pyP - pyM) / (2 * h);
    const dQdy = (qyP - qyM) / (2 * h);
    return { div: dPdx + dQdy, curl: dQdx - dPdy };
  }

  /** Small static preview used on preset cards. */
  function drawThumb(canvas, fieldFn, range, theme) {
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const w = canvas.clientWidth || 160;
    const h = canvas.clientHeight || 100;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const view = new View();
    view.w = w; view.h = h;
    view.fit(range, 4);
    const layer = new FieldLayer();
    layer.draw(ctx, view, fieldFn, 0, {
      grid: false, arrows: true, spacing: 15, mode: 'uniform', size: 0.8, color: true,
    }, theme);
  }

  Object.assign(VP, {
    THEMES, View, FieldLayer, Particles, trace, drawProbe, diffOps, drawThumb,
    makeRamp, rampCSS, fmt,
  });
})(typeof self !== 'undefined' ? self : this);
