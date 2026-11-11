// The cell tour (examples/cell-tour.html): the animal cell of cell.json, made as detailed as an illustrated cell film: nuclear pores, loose chromatin, smooth ER, membrane proteins, centrioles of nine triplets,
// and the three fibres of the cytoskeleton; guided steps in the film's order; the paths messenger RNA takes out of the
// pores (extras, for the page); and a close-up of the membrane's two layers, a scene of its own for an inset.
//   node examples/cell-tour.mjs        → examples/scenes/cell-tour.json, cell-tour-bilayer.json (the same each time)
// The cell is 1 unit in radius (10 µm). Its quarter y > 0, z > 0 is cut away, and what lies on the two cut faces (the
// plane z = 0 where y > 0, the plane y = 0 where z > 0) is drawn halved there; anything whole stays out of that quarter.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scenes'),
  base = JSON.parse(fs.readFileSync(path.join(HERE, 'cell.json'), 'utf8'));

// ---- small tools: a seeded random number, vectors, a direction as a shape's rot (its x axis turned onto it)
let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646,
  between = (a, b) => a + (b - a) * random(),
  round = (v) => +v.toFixed(4),
  P = (p) => p.map(round),
  len = (v) => Math.hypot(...v),
  scale = (v, k) => v.map((x) => x * k),
  add = (a, b) => a.map((x, i) => x + b[i]),
  sub = (a, b) => a.map((x, i) => x - b[i]),
  norm = (v) => scale(v, 1 / (len(v) || 1)),
  onSphere = () => {
    const z = between(-1, 1),
      t = between(0, 2 * Math.PI);
    return [Math.sqrt(1 - z * z) * Math.cos(t), Math.sqrt(1 - z * z) * Math.sin(t), z];
  },
  aim = (d) => {
    const [x, y, z] = norm(d);
    return [0, round((Math.asin(-z) * 180) / Math.PI), round((Math.atan2(y, x) * 180) / Math.PI)];
  };
// whether a ball of radius r at p stays out of the open quarter (with a margin)
const kept = (p, r = 0) => p[1] < -r - 0.004 || p[2] < -r - 0.004;
// a path that stays in the kept part of the cell
const keptPath = (points, r) => points.every((p) => kept(p, r));

const parts = structuredClone(base.parts),
  part = (id) => parts.find((each) => each.id === id);

// ---- the cell membrane's proteins: channels through it, pointing outwards
const proteins = [];
while (proteins.length < 90) {
  const d = onSphere(),
    p = scale(d, 0.9875);
  if (!kept(p, 0.03)) continue;
  proteins.push({ cylinder: { r: 0.011, x0: -0.024, x1: 0.024 }, at: P(p), rot: aim(d) });
}
parts.splice(1, 0, {
  id: 'membrane-proteins',
  name: 'Membrane proteins',
  note: 'span the membrane: channels and pumps that let things in and out, and receptors that pass on signals.',
  group: 'mang',
  material: 'plastic',
  color: '#4d7fc4',
  shapes: proteins,
});

// ---- nuclear pores: rings in the nucleus's double wall, on all of its kept surface
const pores = [];
while (pores.length < 70) {
  const d = onSphere(),
    p = scale(d, 0.3125);
  if (!kept(p, 0.03) || pores.some((other) => len(sub(other.at, p)) < 0.06)) continue;
  pores.push({ torus: [0.015, 0.0045], at: P(p), rot: aim(d) });
}
parts.splice(parts.findIndex((each) => each.id === 'mang-nhan') + 1, 0, {
  id: 'nuclear-pores',
  name: 'Nuclear pores',
  note: 'gates through the double wall of the nucleus: messenger RNA, copied from the DNA, leaves through them. A real nucleus has thousands.',
  group: 'nhan',
  material: 'plastic',
  color: '#f1ecf8',
  shapes: pores,
});

// ---- chromatin: more loose thread on the nucleus's two cut faces (the DNA, about two metres of it in a human cell)
const chromatin = part('chat-nhiem-sac');
for (const face of ['z', 'y'])
  for (let k = 0; k < 16; k++) {
    let a = between(0.12, 0.25), // (polar on the face: a from the centre, t from +x towards the cut quarter)
      t = between(0.1, Math.PI - 0.1),
      heading = between(0, 2 * Math.PI);
    const points = [];
    for (let s = 0; s < 14; s++) {
      const u = a * Math.cos(t),
        v = a * Math.sin(t);
      points.push(face === 'z' ? [round(u), round(v), 0.003] : [round(u), 0.003, round(v)]);
      heading += between(-0.9, 0.9);
      a = Math.max(0.11, Math.min(0.27, a + 0.018 * Math.cos(heading)));
      t = Math.max(0.05, Math.min(Math.PI - 0.05, t + 0.12 * Math.sin(heading)));
    }
    const inside = points.filter((p) => len(p) < 0.275 && len(p) > 0.1);
    if (inside.length > 4) chromatin.shapes.push({ tube: inside, r: 0.0045, color: '#7b5aa8' });
  }

// ---- smooth ER: a network of tubes, without ribosomes, just behind the cut face z = 0
const nodes = [];
for (let x = -0.5; x <= -0.06; x += 0.065)
  for (let y = 0.5; y <= 0.86; y += 0.065)
    for (const z of [-0.025, -0.085]) {
      const p = [x + between(-0.02, 0.02), y + between(-0.02, 0.02), z + between(-0.008, 0.008)];
      if (len(p) < 0.92 && len(sub(p, [-0.3, 0.6, 0])) > 0.075 && len(p) > 0.5) nodes.push(p);
    }
const smoothTubes = [];
for (let i = 0; i < nodes.length; i++)
  for (let j = i + 1; j < nodes.length; j++) {
    const gap = len(sub(nodes[i], nodes[j]));
    if (gap < 0.095 && random() < 0.6) {
      const middle = add(scale(add(nodes[i], nodes[j]), 0.5), [between(-0.01, 0.01), between(-0.01, 0.01), 0]);
      const route = [nodes[i], middle, nodes[j]];
      if (keptPath(route, 0.011)) smoothTubes.push({ tube: route.map(P), r: 0.0085 });
    }
  }
parts.splice(
  parts.findIndex((each) => each.id === 'ribosome'),
  0,
  {
    id: 'smooth-er',
    name: 'Smooth endoplasmic reticulum',
    note: 'a network of tubes without ribosomes: it makes fats and stores calcium.',
    group: 'luoi',
    material: 'membrane',
    color: '#5fc0e6',
    label: P(nodes[Math.floor(nodes.length / 2)]),
    shapes: smoothTubes,
  },
);

// ---- the centrosome: two centrioles at right angles, each a ring of nine triplets of microtubules
const centrosome = part('trung-the');
centrosome.note =
  'two centrioles at right angles, each a ring of nine triplets of microtubules; the cell’s microtubules grow out from around them.';
centrosome.shapes = [-0.0055, 0, 0.0055].flatMap((shift, k) => [
  { cylinder: { r: 0.0032, x0: 0.03, x1: 0.11 }, at: [0, round(0.0175 + 0.0012 * k), shift], repeat: 9 },
  {
    cylinder: { r: 0.0032, x0: -0.04, x1: 0.04 },
    rot: [0, 0, 90],
    at: [shift, 0, round(0.0175 + 0.0012 * k)],
    repeat: { n: 9, axis: 'y' },
  },
]);

// ---- the cytoskeleton: microtubules from the centrosome round the nucleus to the membrane, actin under the
// membrane, intermediate filaments from the nucleus to the membrane; all inside the kept part of the cell
const centre = [-0.06, -0.045, 0.41],
  aroundNucleus = (p, room = 0.37) => (len(p) < room ? scale(norm(p), room) : p);
const microtubules = [];
for (let tries = 0; microtubules.length < 46 && tries < 4000; tries++) {
  const end = scale(onSphere(), 0.94),
    route = [];
  for (let s = 0; s <= 10; s++) route.push(aroundNucleus(add(centre, scale(sub(end, centre), s / 10))));
  if (keptPath(route, 0.01) && len(sub(end, centre)) > 0.6) microtubules.push({ tube: route.map(P), r: 0.0055 });
}
const actin = [];
for (let tries = 0; actin.length < 320 && tries < 20000; tries++) {
  // (a filament along the membrane's inside, and now and then a branch from its middle at about 70 degrees)
  const start = onSphere(),
    turn = norm(sub(onSphere(), scale(start, 0.98))),
    route = [];
  for (let s = 0; s <= 6; s++) {
    const d = norm(add(start, scale(turn, 0.05 * s + between(-0.01, 0.01))));
    route.push(scale(d, between(0.93, 0.95)));
  }
  if (!keptPath(route, 0.01)) continue;
  actin.push({ tube: route.map(P), r: 0.0042 });
  if (random() < 0.45) {
    const root = route[3],
      side = norm(sub(add(scale(norm(sub(route[4], route[2])), 0.34), scale(norm(onSphere()), 0.94)), [0, 0, 0])),
      branch = [
        root,
        scale(norm(add(norm(root), scale(side, 0.06))), 0.94),
        scale(norm(add(norm(root), scale(side, 0.12))), 0.935),
      ];
    if (keptPath(branch, 0.01)) actin.push({ tube: branch.map(P), r: 0.0036 });
  }
}
const filaments = [];
for (let tries = 0; filaments.length < 26 && tries < 4000; tries++) {
  const from = onSphere(),
    to = norm(add(from, scale(onSphere(), 0.6))),
    route = [];
  for (let s = 0; s <= 9; s++) {
    const r = 0.34 + (0.6 * s) / 9,
      wave = [between(-1, 1), between(-1, 1), between(-1, 1)];
    route.push(add(scale(norm(add(scale(from, 1 - s / 9), scale(to, s / 9))), r), scale(wave, 0.02)));
  }
  if (keptPath(route, 0.01)) filaments.push({ tube: route.map(P), r: 0.0045 });
}
const fibre = (id, name, note, color, shapes) => ({
  id,
  name,
  note,
  group: 'cytoskeleton',
  material: 'plastic',
  color,
  shapes,
});
parts.push(
  fibre(
    'microtubules',
    'Microtubules',
    'hollow tubes of protein that grow out from the centrosome: tracks along which motor proteins carry cargo.',
    '#3f9a5a',
    microtubules,
  ),
  fibre(
    'actin',
    'Actin filaments',
    'the thinnest fibres, a branching mesh under the membrane that shapes the cell’s edge and lets it move.',
    '#dc4352',
    actin,
  ),
  fibre(
    'intermediate-filaments',
    'Intermediate filaments',
    'tough fibres like rope, from the nucleus to the membrane: they hold the cell together under strain.',
    '#9b7b55',
    filaments,
  ),
);

// ---- mitochondria: the inner membrane folded into cristae, drawn on the cut face over a darker matrix, in place of the
// plain plates. Each half-mitochondrion lies on a cut face: its own x along it, its face the plane y = 0 (on the face
// z = 0 of the cell, rotated) or z = 0; the fold is a closed line round fingers that reach in from both sides
const fold = () => {
  const L = 0.085,
    r = 0.036, // (the inner membrane's half-width and the straight part's half-length)
    points = [];
  const finger = (u, side) => {
    // (down from the top edge, side 1, or up from the bottom, -1: in, round its tip, out)
    const w = 0.0075,
      reach = 0.047;
    points.push([u - w, side * r], [u - w, side * (r - reach + w)]);
    for (let k = 1; k < 6; k++) {
      const a = Math.PI + (k / 6) * Math.PI * side;
      points.push([u + w * Math.cos(a), side * (r - reach + w) + w * Math.sin(a) * side * side]);
    }
    points.push([u + w, side * (r - reach + w)], [u + w, side * r]);
  };
  for (const u of [-0.06, -0.02, 0.02, 0.06]) finger(u, 1);
  for (let k = 0; k <= 8; k++) {
    const a = Math.PI / 2 - (k / 8) * Math.PI;
    points.push([L + r * Math.cos(a), r * Math.sin(a)]);
  }
  for (const u of [0.04, 0, -0.04]) finger(u, -1);
  for (let k = 0; k <= 8; k++) {
    const a = -Math.PI / 2 - (k / 8) * Math.PI;
    points.push([-L + r * Math.cos(a), r * Math.sin(a)]);
  }
  return points.map(([u, v]) => [round(u), round(v)]);
};
for (const id of ['ti-the-1', 'ti-the-2', 'ti-the-3', 'ti-the-4']) {
  const mito = part(id),
    onY = mito.shapes[0].from === 90, // (its face the plane y = 0; else z = 0)
    outline = fold(),
    lift = 0.0016;
  mito.shapes = [
    mito.shapes[0],
    // the matrix inside the inner membrane, a shade darker, on the face
    {
      extrude: { outline, depth: 0.0028 },
      at: onY ? [0, lift, 0] : [0, 0, lift],
      rot: onY ? [-90, 0, 0] : [0, 0, 0],
      color: '#c9582a',
    },
    // the inner membrane: one line round every fold
    {
      tube: [...outline, outline[0]].map(([u, v]) => (onY ? [u, 0.0032, v] : [u, v, 0.0032])),
      r: 0.0034,
      color: '#ffe0bf',
    },
  ];
}
part('ti-the-1').note =
  'uses oxygen to turn food into ATP, the cell’s fuel; its inner membrane is folded into cristae, so it has room for more of the machinery that makes ATP.';

// ---- the Golgi apparatus: curved cisternae with swollen rims, cis (yellow) to trans (orange), vesicles budding at their
// ends; on the cut face z = 0, as the base cell's, and through the cell behind it
const golgi = part('golgi'),
  bend = [0.8, 0.8], // (the stack's centre of curvature, on the face)
  toward = (a, r) => [bend[0] + r * Math.cos(a), bend[1] + r * Math.sin(a)],
  shades = ['#f3d873', '#f0c35d', '#eaaa4f', '#e29245', '#d97a3c'],
  buds = [];
golgi.shapes = shades.map((color, k) => {
  const R = 0.505 - 0.034 * k,
    lumen = 0.0075,
    rim = 0.0145,
    from = ((198 + 3 * k) * Math.PI) / 180,
    to = ((262 - 3 * k) * Math.PI) / 180,
    outline = [];
  for (let s = 0; s <= 14; s++) outline.push(toward(from + ((to - from) * s) / 14, R + lumen));
  const bulb = (a, ahead) => {
    // (a swollen rim at the end at angle a, round from the outside to the inside, bulging ahead along the arc)
    const [cx, cy] = toward(a, R),
      radial = [Math.cos(a), Math.sin(a)],
      tangent = [-Math.sin(a) * ahead, Math.cos(a) * ahead];
    for (let s = 0; s <= 8; s++) {
      const t = (s / 8) * Math.PI,
        d = [radial[0] * Math.cos(t) + tangent[0] * Math.sin(t), radial[1] * Math.cos(t) + tangent[1] * Math.sin(t)];
      outline.push([cx + rim * d[0], cy + rim * d[1]]);
    }
    buds.push([cx + tangent[0] * (rim + 0.016), cy + tangent[1] * (rim + 0.016)]);
  };
  bulb(to, 1);
  for (let s = 14; s >= 0; s--) outline.push(toward(from + ((to - from) * s) / 14, R - lumen));
  bulb(from, -1);
  return { extrude: { outline: outline.map((p) => p.map(round)), depth: 0.2 }, color };
});
part('tui-van-chuyen').shapes.push(
  ...buds.map(([x, y], k) => ({
    shell: { r: round(0.013 + 0.003 * (k % 3)), from: 180, to: 360 },
    at: [round(x), round(y), 0.003],
  })),
);

// ---- messenger RNA's way out: from a pore, outwards, then towards the rough ER (for the page's moving dots)
const mrna = pores
  .filter((pore) => len(pore.at) && kept(scale(pore.at, 1.5), 0.02))
  .slice(0, 8)
  .map((pore) => {
    const d = norm(pore.at);
    return [scale(d, 0.25), scale(d, 0.3125), scale(d, 0.36), add(scale(d, 0.42), [0.02, 0.03, -0.02])].map(P);
  });

// ---- the steps, in the film's order (what each leaves out goes back to the start: so each hides the cytoskeleton,
// shown only in its own steps)
const fibres = ['cytoskeleton'],
  inside = ['luoi', 'ribosome', 'golgi', 'lysosome', 'ti-the', 'trung-the'];
const steps = [
  {
    id: 'cell',
    title: 'One human cell',
    text: 'About 20 micrometres across: a bag of watery cytoplasm, its parts each with a job. Cut open here to show them.',
    view: 'home',
    hide: fibres,
  },
  {
    id: 'membrane',
    title: 'Cell membrane',
    text: 'A film of fats, two layers thick, with proteins set in it: gates that let things in and out.',
    labels: ['mang-te-bao', 'membrane-proteins'],
    // (close to its outside, seen face on: the proteins in it)
    view: { yaw: 16, pitch: -27, zoom: 2.6, target: P(norm([0.25, -0.45, 0.86])) },
    hide: fibres,
  },
  {
    id: 'nucleus',
    title: 'Nucleus',
    text: 'Stores the DNA, the instructions for making proteins: about two metres of it, drawn here as loose thread.',
    focus: ['nhan'],
    labels: ['mang-nhan', 'chat-nhiem-sac', 'nhan-con'],
    view: { yaw: -20, pitch: 25 },
    hide: fibres,
  },
  {
    id: 'pores',
    title: 'Nuclear pores',
    text: 'Gates through the wall of the nucleus. Messenger RNA, a copy of a gene, leaves through them for the ribosomes.',
    focus: ['nhan'],
    labels: ['nuclear-pores'],
    hide: [...fibres, ...inside, 'mang', 'chat'],
    view: { yaw: -40, pitch: 30 },
  },
  {
    id: 'rough-er',
    title: 'Rough ER',
    text: 'Folded membranes round the nucleus, studded with ribosomes, which make proteins.',
    focus: ['luoi-noi-chat'],
    labels: ['luoi-noi-chat', 'ribosome'],
    view: { yaw: -30, pitch: 35 },
    hide: fibres,
  },
  {
    id: 'smooth-er',
    title: 'Smooth ER',
    text: 'A network of tubes without ribosomes: it makes fats and stores calcium.',
    focus: ['smooth-er'],
    labels: ['smooth-er'],
    view: { yaw: -10, pitch: 20 },
    hide: fibres,
  },
  {
    id: 'golgi',
    title: 'Golgi apparatus',
    text: 'Finishes, sorts and ships proteins, in small vesicles.',
    focus: ['golgi'],
    labels: ['golgi', 'tui-van-chuyen'],
    view: { yaw: -15, pitch: 30 },
    hide: fibres,
  },
  {
    id: 'mitochondria',
    title: 'Mitochondria',
    text: 'Use oxygen to turn food into ATP, the cell’s fuel. A real cell has hundreds, often in a network.',
    focus: ['ti-the-1'],
    labels: ['ti-the-1'],
    select: 'ti-the-1',
    view: { yaw: -35, pitch: 28 },
    hide: fibres,
  },
  {
    id: 'lysosomes',
    title: 'Lysosomes',
    text: 'Bags of acid and enzymes that break down worn-out parts.',
    focus: ['lysosome'],
    labels: ['lysosome'],
    view: { yaw: -25, pitch: 30 },
    hide: fibres,
  },
  {
    id: 'cytoskeleton',
    title: 'Cytoskeleton',
    text: 'Fibres of protein that shape the cell and carry its cargo: microtubules, actin filaments and intermediate filaments.',
    hide: [...inside.filter((group) => group !== 'trung-the'), 'chat'],
    xray: true,
    labels: ['microtubules', 'actin', 'intermediate-filaments'],
    view: 'home',
  },
  {
    id: 'centrosome',
    title: 'Centrosome',
    text: 'Two centrioles at right angles, each nine triplets of microtubules: the cell’s microtubules grow out from here.',
    focus: ['trung-the'],
    labels: ['trung-the', 'microtubules'],
    hide: ['luoi', 'ribosome', 'golgi', 'lysosome', 'ti-the', 'actin', 'intermediate-filaments'],
    view: { yaw: -30, pitch: 25, zoom: 3.2 },
  },
];

const cell = {
  ...base,
  title: 'A human cell, part by part',
  alt: 'A human cell cut open: its membrane with proteins, the nucleus with its pores and chromatin, rough and smooth endoplasmic reticulum, the Golgi apparatus, mitochondria, lysosomes, the centrosome and the fibres of the cytoskeleton.',
  scale: {
    ...base.scale,
    note: 'The membrane, its proteins, the pores, ribosomes, fibres and centrioles are drawn larger than they are',
  },
  parts,
  steps,
  extras: { mrna },
};
fs.writeFileSync(path.join(HERE, 'cell-tour.json'), JSON.stringify(cell));

// ---- the close-up: a patch of the membrane's two layers of fats, a protein channel through them
const heads = [],
  tails = [];
for (const sign of [1, -1])
  // (the outer layer, then the inner)
  for (let k = 0; k < 15; k++) {
    const x = -0.7 + k * 0.1;
    if (Math.abs(x) < 0.12) continue; // (the channel's place)
    heads.push({ sphere: 0.045, at: P([x, sign * 0.2, 0]) });
    for (const dx of [-0.015, 0.015])
      tails.push({
        tube: [
          [x + dx, sign * 0.16, 0],
          [x + dx * 1.6, sign * 0.09, 0],
          [x + dx, sign * 0.03, 0],
        ].map(P),
        r: 0.009,
      });
  }
const bilayer = {
  title: 'The cell membrane, close up',
  alt: 'Two layers of fat molecules, their heads outwards and their tails meeting in the middle, with a protein channel through them.',
  w: 16,
  h: 9,
  style: 'ink',
  ground: false,
  section: false,
  view: { yaw: -15, pitch: 12 },
  scale: { note: '5 to 10 nm thick: under a 2 000th of the cell’s width' }, // (the cell 20 µm across)
  parts: [
    {
      id: 'heads',
      name: 'Water-loving heads',
      color: '#e2a35f',
      material: 'matte',
      shapes: heads,
      label: [-0.6, 0.25, 0],
    },
    { id: 'tails', name: 'Fatty tails', color: '#e8d6a4', material: 'matte', shapes: tails, label: [0.45, -0.1, 0] },
    {
      id: 'channel',
      name: 'Channel protein',
      color: '#4d7fc4',
      material: 'plastic',
      shapes: [{ cylinder: { r: 0.075, ri: 0.03, x0: -0.26, x1: 0.26 }, rot: [0, 0, 90] }],
      label: [0, 0.27, 0],
    },
  ],
};
fs.writeFileSync(path.join(HERE, 'cell-tour-bilayer.json'), JSON.stringify(bilayer));
console.log(
  `cell-tour.json: ${parts.length} parts; ${proteins.length} membrane proteins, ${pores.length} pores, ${smoothTubes.length} smooth-ER tubes, ` +
    `${microtubules.length} microtubules, ${actin.length} actin filaments, ${filaments.length} intermediate filaments, ${mrna.length} mRNA paths`,
);
