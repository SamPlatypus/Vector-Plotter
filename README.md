# Vector Plotter

An offline vector-field plotter for phones and desktops. Type a field
**F(x, y) = (Fx, Fy)**, see the arrows and flowing particles update as you type,
and tap anywhere to read the vector there.

It's an installable web app (PWA): plain HTML, CSS and JavaScript with no
dependencies and no build step. After the first visit it works with no network.

## Features

- **Live equation editor.** Two inputs (sideways and up/down parts), parsed on
  every keystroke. A "reads as" line shows exactly how your formula was
  understood (`2xsin y` → 2x·sin(y)). If something's wrong, the bad part is
  highlighted with a plain-English message, and the plot keeps showing the last
  valid field.
- **Forgiving syntax.** `2x`, `x y`, `3(x+1)`, `sin x`, `x²`, `x**2`, `−`, `×`,
  `π`, `θ`. Phone auto-capitalisation is harmless (`Sin(X)` works).
- **Sliders.** Use `a`, `b` or `c` in a formula and a slider appears.
- **Time.** Use `t` and the field changes as the animation runs.
- **18 presets** with live thumbnails: rotation, source, sink, saddle, shear,
  spiral, pendulum, Van der Pol, limit circle, predator–prey, double well,
  dipole, flow past a cylinder, whirlpool, convection cells, a gradient field,
  and two time-varying fields.
- **Arrow controls.** Density, size, same-length or length-shows-strength,
  colour by strength (with a legend).
- **Animated flow.** Particles with fading trails (from dots to long streaks),
  adjustable count and speed, optional colour-by-speed, and play/pause.
- **Probe readout.** Tap (phone) or hover (desktop) to see the position, **F**,
  |**F**|, direction, divergence and curl, each with a plain-language hint
  ("spreading out", "↺ counter-clockwise"). The streamline through that point
  is drawn: solid ahead, dashed behind. Drag the pinned probe to move it.
- **Pan and zoom.** Drag, pinch, mouse wheel. Reset with the corner button or `F`.
- Light and dark themes, safe-area aware, works in portrait and landscape.
  Your field and settings are saved on the device.

Keyboard (desktop): `Space` play/pause · `F` reset view · `+`/`−` zoom ·
`Esc` remove the probe.

## Run it

```sh
npm start          # http://localhost:8080  (no install step needed)
npm test           # unit tests for the parser, maths and presets
```

`npm start` runs `scripts/serve.js`, a tiny static server. Any static server
works; the app only needs to be served over http(s) for offline mode to switch
on. Opening `index.html` straight from disk also works, just without offline
caching.

## Put it on your phone

A phone will only install a web app served over **HTTPS**, so host the folder
once on any static host. With GitHub Pages:

1. Repository **Settings → Pages**.
2. **Source:** "Deploy from a branch", choose the branch and `/ (root)`.
3. Open the published URL on your phone, then:
   - **iPhone/iPad (Safari):** Share → **Add to Home Screen**.
   - **Android (Chrome):** ⋮ menu → **Install app** (or **Add to Home screen**).

It launches full-screen like a native app and keeps working in airplane mode.

## What you can type

| | |
|---|---|
| Variables | `x`, `y`, `t` (time), `r` (distance from origin), `θ` or `theta` (angle) |
| Sliders | `a`, `b`, `c` |
| Constants | `pi` or `π`, `e` |
| Operators | `+ - * / ^` and brackets. Multiplication can be implied: `2x`, `x y`, `(x+1)(x-1)` |
| Functions | `sin cos tan sec csc cot`, `asin acos atan atan2(y, x)`, `sinh cosh tanh`, `exp ln log sqrt cbrt abs`, `min max mod pow hypot floor ceil round sign` |

`sin x` means `sin(x)`, `sin 2x` means `sin(2x)`, `sin^2 x` means `sin(x)²`,
and `sin^-1 x` means `arcsin(x)`. `log` is base 10, `ln` is natural.

## How it works

| File | Role |
|---|---|
| `js/parser.js` | Tokenizer, recursive-descent parser, compiler and pretty-printer. User text is never passed to `eval`: only an AST built from a fixed vocabulary is compiled. |
| `js/render.js` | View transform, grid/axes, batched arrow drawing, particle system (RK2, ring-buffer trails), streamline tracing, numeric divergence/curl. |
| `js/presets.js` | The preset fields. |
| `js/app.js` | UI wiring, gestures, probe readout, persistence, animation loop. |
| `sw.js` | Service worker: precaches everything, serves from cache, refreshes in the background. |

Some deliberate choices:

- **Arrow colours** are scaled to the 95th percentile of what's on screen, so
  one singularity doesn't wash everything else out. Values above it show the
  top colour (the legend reads "max+").
- **Particle speed** is normalised so a strong arrow moves at a comfortable
  on-screen pace whatever the field's units. Relative speeds within a field are
  kept. Particles that run into a singularity or come to rest at an equilibrium
  are respawned, so they don't pile up.
- If a device can't hold 25 fps, the automatic particle count steps down. A
  count you set yourself is never changed.

When you change the list of cached files, bump `VERSION` in `sw.js`.
