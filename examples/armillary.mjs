// The armillary sphere (examples/armillary.html): a desk instrument of rings that models the sky, set for Hà Nội's
// latitude, with a cage of celestial circles that turns about the polar axis, guided steps, and what must be true of it
// (expect), checked by lk3d check.
//   node examples/armillary.mjs        → examples/scenes/armillary.json (the same each time)
// Units: centimetres. North is +x, up is +y, so east is +z (x × y). The polar axis rises above the north horizon by the
// latitude (Hà Nội, 21.03° N). Parts on the celestial sphere are written in a "polar frame" whose x is the polar axis
// and turned into place with rot [0, 0, LAT].
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePlace } from '../src/place.js'; // (a part placed by relation gets its at here, before writing)

const LAT = 21.03; // Hà Nội
const EPS = 23.44; // the obliquity of the ecliptic
const D = Math.PI / 180;
const r2 = (v) => Math.round(v * 1000) / 1000;
const polar = ([x, y, z]) => [
  r2(x * Math.cos(LAT * D) - y * Math.sin(LAT * D)),
  r2(x * Math.sin(LAT * D) + y * Math.cos(LAT * D)),
  r2(z),
];

// a band round the x axis at x = c: width w (along x), from radius ri to ro (a short tube: its broad face looks out)
const band = (c, w, ri, ro, extra = {}) => ({
  lathe: [
    [c - w / 2, ri],
    [c - w / 2, ro],
    [c + w / 2, ro],
    [c + w / 2, ri],
  ],
  closed: true,
  ...extra,
});
// a flat washer round the x axis: thickness t along x, from radius ri to ro
const washer = (x0, t, ri, ro, extra = {}) => ({
  lathe: [
    [x0, ri],
    [x0, ro],
    [x0 + t, ro],
    [x0 + t, ri],
  ],
  closed: true,
  ...extra,
});

// radii on the celestial cage (outer faces)
const R_SOL = [19.1, 19.6]; // solstitial colure
const R_EQX = [19.6, 20.1]; // equinoctial colure, outside the solstitial one where they cross at the poles
const R_CIRCLE = 19.1; // equator, tropics, polar circles: their outer faces touch the colures
const DEPTH = 0.5; // radial depth of the narrow rings
const R_ECL = [17.4, 18.6]; // the ecliptic: a broad band just inside the equator
const MER = [20.6, 22.4]; // meridian ring (fixed)
const HOR = [22.8, 27.0]; // horizon ring (fixed)

const parallel = (id, name, decl, note, color) => {
  const c = R_CIRCLE * Math.sin(decl * D),
    ro = R_CIRCLE * Math.cos(decl * D);
  return {
    id,
    name,
    note,
    group: 'sky',
    color,
    material: 'gold',
    rot: [0, 0, LAT],
    label: polar([c, 0, ro - 0.1]),
    shapes: [band(c, 0.7, ro - DEPTH, ro, { seg: 96 })],
  };
};

// a horizon arm: a smooth curve (cubic Bézier) from the pillar's knop out and up to the horizon ring's underside
const arm = Array.from({ length: 17 }, (_, i) => {
  const t = i / 16,
    u = 1 - t,
    P = [
      [1.4, -29.8],
      [13, -29.8],
      [25.6, -17],
      [24.9, -0.6],
    ];
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [r2(w.reduce((s, k, j) => s + k * P[j][0], 0)), r2(w.reduce((s, k, j) => s + k * P[j][1], 0)), 0];
});
const brass = '#b88a3e',
  darkBrass = '#8a6528',
  sky = '#c9a24c',
  wood = '#6b4a2f';

const parts = [
  // ---- the stand
  {
    id: 'base',
    name: 'Base',
    group: 'stand',
    color: wood,
    material: 'wood',
    note: 'A turned foot that keeps the instrument level, so the horizon ring lies flat.',
    label: [-6.9, -35.6, 6.9],
    shapes: [
      {
        lathe: [
          [-37, 0],
          [-37, 11],
          [-36.4, 11],
          [-36, 10.3],
          [-35.5, 9.8],
          [-35.2, 7],
          [-34.6, 5.2],
          [-34.5, 0],
        ],
        rot: [0, 0, 90],
        seg: 64,
      },
    ],
  },
  {
    id: 'pillar',
    name: 'Pillar',
    group: 'stand',
    color: wood,
    material: 'wood',
    note: 'The turned column that carries the meridian ring in its cradle and the four arms of the horizon ring.',
    shapes: [
      {
        lathe: [
          [-34.5, 0],
          [-34.5, 3.0],
          [-33.6, 2.4],
          [-32.4, 1.5],
          [-30.8, 1.5],
          [-30.2, 2.5],
          [-29.4, 2.5],
          [-28.8, 1.4],
          [-26.2, 1.2],
          [-25.0, 1.7],
          [-24.2, 2.0],
          [-24.2, 0],
        ],
        rot: [0, 0, 90],
        smooth: true,
        seg: 48,
      },
    ],
  },
  {
    id: 'cradle',
    name: 'Cradle',
    group: 'stand',
    color: darkBrass,
    material: 'gold',
    note: 'Two cheeks that hold the meridian ring upright in the plane running north and south.',
    shapes: [
      { box: [3.2, 1.8, 2.2], at: [0, -23.3, 0] },
      { box: [2.6, 2.4, 0.5], at: [0, -21.2, 0.55] },
      { box: [2.6, 2.4, 0.5], at: [0, -21.2, -0.55] },
    ],
  },
  {
    id: 'arms',
    name: 'Horizon arms',
    group: 'stand',
    color: darkBrass,
    material: 'gold',
    note: 'Four curved arms from the pillar that hold the horizon ring level.',
    shapes: [{ tube: arm, r: 0.45, rot: [0, 45, 0], repeat: { n: 4, axis: 'y' } }],
  },
  // ---- the fixed rings
  {
    id: 'horizon',
    name: 'Horizon ring',
    group: 'frame',
    color: brass,
    material: 'gold',
    note: 'The observer’s horizon: the sky above its plane can be seen, the half below cannot. Its marks give the directions of the compass.',
    label: [-25, 0, -0.2],
    shapes: [
      washer(-0.6, 0.6, HOR[0], HOR[1], { rot: [0, 0, 90], seg: 128 }),
      { box: [1.6, 0.06, 0.12], at: [26.0, 0.03, 0], repeat: { n: 32, axis: 'y' }, detail: 0.5 },
      { box: [3.4, 0.1, 0.32], at: [24.9, 0.05, 0], repeat: { n: 4, axis: 'y' } },
    ],
  },
  {
    id: 'meridian',
    name: 'Meridian ring',
    group: 'frame',
    color: brass,
    material: 'gold',
    note: 'The great circle through the poles and the point overhead, running north and south. It holds the polar axis, and its degrees set the latitude.',
    label: [-15.3, 15.3, 0.3],
    shapes: [
      washer(-0.3, 0.6, MER[0], MER[1], { rot: [0, 90, 0], seg: 128 }),
      { box: [0.9, 0.07, 0.06], at: [21.95, 0, 0.32], repeat: { n: 72, axis: 'z' }, detail: 0.5 },
      { box: [1.5, 0.12, 0.08], at: [21.65, 0, 0.33], repeat: { n: 12, axis: 'z' } },
    ],
  },
  {
    id: 'clamps',
    name: 'Meridian clamps',
    group: 'frame',
    color: darkBrass,
    material: 'gold',
    note: 'Where the meridian ring passes the horizon ring, north and south: they hold the two at right angles.',
    shapes: [
      { box: [1.0, 1.4, 1.6], at: [22.6, -0.3, 0] },
      { box: [1.0, 1.4, 1.6], at: [-22.6, -0.3, 0] },
    ],
  },
  {
    id: 'axis',
    name: 'Polar axis',
    group: 'frame',
    color: darkBrass,
    material: 'steel',
    rot: [0, 0, LAT],
    note: `The axis the sky turns about, pointing at the celestial poles. It rises above the north horizon by the observer’s latitude: ${LAT.toFixed(0)}° for Hà Nội.`,
    label: polar([10, 0, 0]),
    shapes: [
      { cylinder: { r: 0.3, x0: -23.0, x1: 23.0 }, seg: 16 },
      { sphere: 0.6, at: [23.2, 0, 0], seg: 16 },
      { sphere: 0.6, at: [-23.2, 0, 0], seg: 16 },
    ],
  },
  {
    id: 'earth',
    name: 'Earth',
    color: '#3f7fc4',
    studioColor: '#2f6db0',
    material: 'paint',
    rot: [0, 0, LAT],
    note: 'A small Earth at the centre, as in Ptolemy’s picture of the cosmos: the sky turns around it, it stays still.',
    shapes: [
      { sphere: 3.0, seg: 48 },
      { torus: [3.0, 0.07], color: '#e8d9a8' },
    ],
  },
  // ---- the celestial cage: it turns about the polar axis
  {
    id: 'bearings',
    name: 'Pole bearings',
    group: 'sky',
    color: darkBrass,
    material: 'gold',
    rot: [0, 0, LAT],
    note: 'Sleeves on the polar axis where the colures meet, at the celestial poles: the whole cage turns on them.',
    shapes: [
      { cylinder: { r: 0.75, ri: 0.3, x0: 18.4, x1: 20.3 }, seg: 24 },
      { cylinder: { r: 0.75, ri: 0.3, x0: -20.3, x1: -18.4 }, seg: 24 },
    ],
  },
  {
    id: 'solstitial',
    name: 'Solstitial colure',
    group: 'sky',
    color: sky,
    material: 'gold',
    rot: [0, 0, LAT],
    note: 'The great circle through the celestial poles and the two solstices, where the ecliptic is farthest from the equator.',
    shapes: [band(0, 0.8, R_SOL[0], R_SOL[1], { rot: [0, 90, 0], seg: 128 })],
  },
  {
    id: 'equinoctial',
    name: 'Equinoctial colure',
    group: 'sky',
    color: sky,
    material: 'gold',
    rot: [0, 0, LAT],
    note: 'The great circle through the celestial poles and the two equinoxes, where the ecliptic crosses the equator.',
    label: [0, 0, R_EQX[1] - 0.1],
    shapes: [band(0, 0.8, R_EQX[0], R_EQX[1], { rot: [0, 0, 90], seg: 128 })],
  },
  {
    id: 'equator',
    name: 'Celestial equator',
    group: 'sky',
    color: '#c98a3a',
    material: 'gold',
    rot: [0, 0, LAT],
    accent: true,
    note: 'Earth’s equator projected on the sky, halfway between the poles. Its 24 marks are the hours of the sky’s daily turn.',
    label: polar([0, R_CIRCLE - 0.2, 0]),
    shapes: [
      band(0, 1.0, R_CIRCLE - DEPTH, R_CIRCLE, { seg: 128 }),
      { box: [0.08, 0.3, 0.16], at: [0.54, R_CIRCLE - 0.25, 0], repeat: 24 },
    ],
  },
  parallel(
    'cancer',
    'Tropic of Cancer',
    EPS,
    'The circle 23.44° north of the equator: the Sun reaches it at the June solstice, its farthest north.',
    sky,
  ),
  parallel(
    'capricorn',
    'Tropic of Capricorn',
    -EPS,
    'The circle 23.44° south of the equator: the Sun reaches it at the December solstice, its farthest south.',
    sky,
  ),
  parallel('arctic', 'Arctic circle', 90 - EPS, 'The circle 23.44° from the north celestial pole (66.56° north).', sky),
  parallel(
    'antarctic',
    'Antarctic circle',
    -(90 - EPS),
    'The circle 23.44° from the south celestial pole (66.56° south).',
    sky,
  ),
  {
    id: 'ecliptic',
    name: 'Ecliptic',
    group: 'sky',
    color: '#d0662b',
    material: 'gold',
    rot: [0, 0, LAT + EPS],
    accent: true,
    note: 'The Sun’s yearly path among the stars, tilted 23.44° to the equator. The band is the zodiac, cut into twelve signs of 30°.',
    shapes: [
      band(0, 2.6, R_ECL[0], R_ECL[1], { seg: 128 }),
      { box: [2.6, 0.14, 0.18], at: [0, R_ECL[1] + 0.06, 0], repeat: 12 },
      { box: [0.9, 0.08, 0.08], at: [0.85, R_ECL[1] + 0.04, 0], repeat: { n: 36, start: 5 }, detail: 0.5 },
      { torus: [R_ECL[1] + 0.02, 0.05], rot: [0, 0, 0] },
    ],
  },
];

// points for the dimensions (scene coordinates at rest)
const Rm = (R_ECL[0] + R_ECL[1]) / 2;
const scene = {
  lk3d: 1,
  title: 'An armillary sphere',
  alt: 'An armillary sphere on a wooden stand: a fixed horizon ring and an upright meridian ring hold a polar axis tilted at 21°, about which a cage of rings turns: the celestial equator, the tropics, the polar circles, two colures and the broad tilted band of the ecliptic, with a small Earth at the centre.',
  unit: 'cm',
  style: 'pen',
  section: false,
  w: 16,
  h: 11,
  narrow: '1 / 1.15',
  view: { yaw: -32, pitch: 16 },
  scale: {
    note: 'A desk instrument about 74 cm tall. The Earth at the centre is drawn far larger than it would be at the scale of the sky.',
  },
  parts,
  motions: [
    {
      id: 'day',
      name: 'The sky’s daily turn',
      range: [0, 360],
      loop: true,
      speed: 24,
      tracks: [
        {
          parts: ['sky'],
          turn: {
            axis: polar([1, 0, 0]).map((v) => r2(v)),
            center: [0, 0, 0],
            keys: [
              [0, 0],
              [360, -360],
            ],
          },
        },
      ],
    },
  ],
  dimensions: [
    {
      id: 'latitude',
      name: 'the latitude: the height of the celestial pole above the horizon',
      angle: [[24.6, 0, 0], [0, 0, 0], polar([24.6, 0, 0])],
      radius: 14,
      arms: true,
      digits: 0,
      hidden: true,
    },
    {
      id: 'obliquity',
      name: 'the tilt of the ecliptic to the equator',
      angle: [
        { part: 'equator', at: polar([0, Rm, 0]) },
        [0, 0, 0],
        { part: 'ecliptic', at: polar([-Rm * Math.sin(EPS * D), Rm * Math.cos(EPS * D), 0]) },
      ],
      radius: 15,
      digits: 1,
      hidden: true,
    },
  ],
  // what must be true of the instrument, checked by lk3d check
  expect: [
    { inside: 'earth', of: 'sky' }, // (the Earth within the turning cage, as it turns)
    { touches: 'bearings', with: 'axis' },
    { above: 'horizon', of: 'base', by: [30, 36] },
    { size: 'meridian', axis: 'y', is: [44.6, 45] },
    { seen: 'equator', step: 'turn' },
    { clear: 'equator', of: 'axis' },
  ],
  steps: [
    {
      id: 'whole',
      title: 'An armillary sphere',
      view: 'home',
      text: 'A model of the sky made of rings, each one a circle that astronomers draw on the sky. A small Earth sits at the centre, as in Ptolemy’s picture of the cosmos.',
    },
    {
      id: 'frame',
      title: 'Horizon and meridian',
      labels: ['horizon', 'meridian', 'axis'],
      dimensions: ['latitude'],
      view: { yaw: -2, pitch: 6 },
      text: 'These rings stay still. The <b>horizon</b> ring splits the sky we see from the half below; the upright <b>meridian</b> ring runs north and south through the point overhead. The axis rises above the north horizon by the latitude: 21° for Hà Nội.',
    },
    {
      id: 'turn',
      title: 'The sky turns',
      labels: ['equator', 'axis', 'earth'],
      play: ['day'],
      view: 'home',
      text: 'Everything inside the meridian turns about the polar axis, once a day, east to west. The <b>celestial equator</b> turns in its own plane, halfway between the poles; its 24 marks are hours.',
    },
    {
      id: 'parallels',
      title: 'Tropics and polar circles',
      labels: ['cancer', 'capricorn', 'arctic', 'antarctic'],
      view: { yaw: -32, pitch: 4 },
      text: 'Four smaller circles run parallel to the equator: the <b>tropics</b>, 23.44° north and south of it, which the Sun reaches at the solstices; and the <b>polar circles</b>, 23.44° from the poles.',
    },
    {
      id: 'ecliptic',
      title: 'The ecliptic',
      labels: ['ecliptic', 'solstitial', 'equinoctial'],
      dimensions: ['obliquity'],
      select: 'ecliptic',
      view: { yaw: -58, pitch: 22 },
      text: 'The broad band is the <b>ecliptic</b>, the Sun’s path through the year, tilted 23.44° to the equator. It touches the tropics at the solstices and crosses the equator at the equinoxes, where the two <b>colures</b> cross it.',
    },
  ],
};
fs.writeFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'scenes', 'armillary.json'),
  JSON.stringify(resolvePlace(scene)),
);
