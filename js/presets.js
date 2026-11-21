/*
 * Vector Plotter — preset fields.
 * view: [xmin, xmax, ymin, ymax] that should be visible after loading.
 * params: starting slider values for a, b, c (only the ones the formula uses matter).
 */
(function (root) {
  'use strict';

  const PRESETS = [
    {
      id: 'rotation', name: 'Rotation', tag: 'Basics',
      blurb: 'Pure spin around the origin. No spreading, all curl.',
      x: '-y', y: 'x', view: [-5, 5, -5, 5],
    },
    {
      id: 'source', name: 'Source', tag: 'Basics',
      blurb: 'Everything streams straight outward.',
      x: 'x', y: 'y', view: [-5, 5, -5, 5],
    },
    {
      id: 'sink', name: 'Sink', tag: 'Basics',
      blurb: 'Everything drains into the origin.',
      x: '-x', y: '-y', view: [-5, 5, -5, 5],
    },
    {
      id: 'saddle', name: 'Saddle', tag: 'Basics',
      blurb: 'In along one axis, out along the other.',
      x: 'x', y: '-y', view: [-5, 5, -5, 5],
    },
    {
      id: 'shear', name: 'Shear', tag: 'Basics',
      blurb: 'Layers sliding past each other: straight lines, yet curl ≠ 0.',
      x: 'y', y: '0', view: [-5, 5, -5, 5],
    },
    {
      id: 'spiral', name: 'Spiral', tag: 'Try the slider',
      blurb: 'Drag a across 0 to flip from spiralling in to spiralling out.',
      x: 'a x - y', y: 'x + a y', params: { a: -0.2 }, view: [-5, 5, -5, 5],
    },
    {
      id: 'pendulum', name: 'Pendulum', tag: 'Physics',
      blurb: 'Angle vs. speed of a swinging pendulum. a is friction.',
      x: 'y', y: '-sin(x) - a y', params: { a: 0.15 }, view: [-7, 7, -4, 4],
    },
    {
      id: 'vanderpol', name: 'Van der Pol', tag: 'Physics',
      blurb: 'Every path settles onto the same loop (a limit cycle).',
      x: 'y', y: 'a(1 - x^2)y - x', params: { a: 1 }, view: [-4, 4, -4, 4],
    },
    {
      id: 'hopf', name: 'Limit circle', tag: 'Try the slider',
      blurb: 'Paths settle on a circle of radius √a. Make a negative and it vanishes.',
      x: 'a x - y - x r^2', y: 'x + a y - y r^2', params: { a: 1 }, view: [-2.5, 2.5, -2.5, 2.5],
    },
    {
      id: 'predator', name: 'Predator & prey', tag: 'Biology',
      blurb: 'Rabbits (x) and foxes (y) boom and bust in endless cycles.',
      x: 'a x - x y', y: 'x y - b y', params: { a: 1, b: 1 }, view: [-0.4, 3.6, -0.4, 3.6],
    },
    {
      id: 'duffing', name: 'Double well', tag: 'Physics',
      blurb: 'A ball rolling between two valleys. a is damping.',
      x: 'y', y: 'x - x^3 - a y', params: { a: 0.25 }, view: [-2.2, 2.2, -1.8, 1.8],
    },
    {
      id: 'dipole', name: 'Dipole', tag: 'Electricity',
      blurb: 'Field lines from a + charge at (1, 0) to a − charge at (−1, 0).',
      x: '(x-1)/((x-1)^2 + y^2) - (x+1)/((x+1)^2 + y^2)',
      y: 'y/((x-1)^2 + y^2) - y/((x+1)^2 + y^2)',
      view: [-4, 4, -4, 4],
    },
    {
      id: 'cylinder', name: 'Around a cylinder', tag: 'Fluids',
      blurb: 'Ideal fluid flowing past a round post of radius 1.',
      x: '1 - (x^2 - y^2)/r^4', y: '-2x y/r^4', view: [-4, 4, -3, 3],
    },
    {
      id: 'whirlpool', name: 'Whirlpool', tag: 'Fluids',
      blurb: 'A swirling drain. a sets how hard it pulls inward.',
      x: '(-y - a x)/r^2', y: '(x - a y)/r^2', params: { a: 0.3 }, view: [-4, 4, -4, 4],
    },
    {
      id: 'cells', name: 'Convection cells', tag: 'Fluids',
      blurb: 'A checkerboard of counter-rotating eddies.',
      x: 'sin(x) cos(y)', y: '-cos(x) sin(y)', view: [-6.3, 6.3, -6.3, 6.3],
    },
    {
      id: 'gradient', name: 'Uphill (gradient)', tag: 'Calculus',
      blurb: 'Points uphill on the surface sin x · cos y. Zero curl everywhere.',
      x: 'cos(x) cos(y)', y: '-sin(x) sin(y)', view: [-6.3, 6.3, -6.3, 6.3],
    },
    {
      id: 'sway', name: 'Swaying cells', tag: 'Changes over time',
      blurb: 'The eddies rock back and forth as t ticks. a is the sway.',
      x: 'sin(x + a sin(t)) cos(y)', y: '-cos(x + a sin(t)) sin(y)', params: { a: 1 }, view: [-6.3, 6.3, -6.3, 6.3],
    },
    {
      id: 'breathing', name: 'Breathing vortex', tag: 'Changes over time',
      blurb: 'Spins steadily while it breathes in and out.',
      x: '-y + a x sin(t)', y: 'x + a y sin(t)', params: { a: 0.6 }, view: [-5, 5, -5, 5],
    },
  ];

  (root.VP = root.VP || {}).PRESETS = PRESETS;
  (root.VP).DEFAULT_PRESET = 'pendulum';
})(typeof self !== 'undefined' ? self : this);
