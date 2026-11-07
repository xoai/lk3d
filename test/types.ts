// Type check of the declarations (npm run typecheck): a page's use of lk3d must compile, and mistakes must not.
import LK3D, { mount, type Scene, type Figure } from 'lk3d';
import { validate } from 'lk3d/validate';
import LK3DX, { sceneToGLB } from 'lk3d/export';

const scene: Scene = {
  w: 16,
  h: 9,
  style: 'studio',
  env: 'night',
  scale: { bar: { length: 1, label: '10 cm' } },
  parts: [
    {
      id: 'lens',
      name: 'Lens',
      material: 'glass',
      refract: 1,
      shapes: [
        {
          lathe: [
            [-0.08, 0],
            [0, 1],
            [0.08, 0],
          ],
          closed: true,
        },
      ],
    },
    {
      id: 'object',
      shapes: [{ cylinder: { r: 0.03, x0: 0, x1: 0.3 }, rot: [0, 0, 90] }],
      handle: { slide: { axis: [1, 0, 0] }, min: -5, max: 0 },
    },
    {
      id: 'ring',
      shapes: [{ torus: [1, 0.03] }],
      handle: { turn: { axis: [1, 0, 0] }, moves: ['lens'] },
      surface: { kind: 'knurl', strength: 0.6 },
    },
  ],
};
LK3D.defaults.locale = 'vi';
const fig: Figure = mount(document.body, scene, {
  onHandle: (id, v) => console.log(id, v.toFixed(1)),
  handleText: (id, v) => `d = ${-v * 10} cm`,
  locale: 'en',
});
fig.set({ explode: 1, glow: { lens: 0.5 } });
const rays = fig.lines({ count: 3, color: '#ffcc55' });
rays.set(0, [0, 0, 0], [1, 1, 0]);
const { yaw, pitch } = fig.camera();
fig.view({ yaw, pitch: pitch + 10 });
fig.select(fig.selected === 'lens' ? null : 'lens');
fig.handle('object')?.set(-3);
const problems: { path: string; message: string }[] = validate(scene);
// a scene from someone else: the full rules first, and a phone's limit on triangles
mount(document.body, scene, { validate, maxTriangles: 1e6 });
// @ts-expect-error validate is a function of the scene, not a switch
mount(document.body, scene, { validate: true });

// @ts-expect-error a slide handle needs its range
const bad1: Scene = { parts: [{ id: 'a', shapes: [{ sphere: 1 }], handle: { slide: { axis: [1, 0, 0] } } }] };
// @ts-expect-error not a material
const bad2: Scene = { parts: [{ id: 'a', shapes: [{ sphere: 1 }], material: 'velvet' }] };
// @ts-expect-error a box is three numbers
const bad3: Scene = { parts: [{ id: 'a', shapes: [{ box: [1, 1] }] }] };
// @ts-expect-error looks are ink, studio or pen
fig.set({ style: 'photo' });
fig.flow({
  path: [
    [0, 0, 0],
    [1, 0, 0],
  ],
  // @ts-expect-error a flow's ramp is a preset, a colour or colours
  ramp: 3,
});
const themed: Scene = { parts: [], theme: 'blueprint', style: 'pen' };
// @ts-expect-error not a theme
const bad5: Scene = { parts: [], theme: 'neon' };
// flows, themes and slow motion
const air = fig.flow({
  paths: [
    [
      [0, 0, 0],
      [1, 0, 0],
    ],
  ],
  count: 200,
  ramp: ['#2a66ab', '#e3801f'],
  spread: 0.05,
});
air.speed = 0.4;
air.set({ amount: 0.5 });
fig.set({ theme: 'dark', timeScale: 0.2, style: 'pen' });
LK3D.themes.night = { ...LK3D.themes.dark, bg: '#000000' };
// the format's version, an orthographic camera, waiting for the whole figure, and stepping time
const versioned: Scene = { lk3d: 1, parts: [], view: { projection: 'ortho' } };
// @ts-expect-error there is no format 2 yet
const bad6: Scene = { lk3d: 2, parts: [] };
void fig.ready.then((f) => f.select('lens'));
fig.set({ projection: 'ortho' });
const jet = fig.stream({
  path: [
    [0, 0, 0],
    [2, 0, 0],
  ],
  radius: [
    [0, 0.3],
    [1, 0.1, 0.6],
  ],
  ramp: 'heat',
  speed: 2,
});
jet.density = 0.5;
jet.set({ speed: 3, turbulence: 0.8 });
fig.zoom(4, 120, 80);
fig.view({ zoom: fig.zoomLevel * 2 });
const edged: Scene = { edges: true, parts: [{ id: 'a', shapes: [{ sphere: 1 }], edges: false }] };
void edged;
LK3D.clock.speed = 0;
LK3D.clock.step(100);
// a timeline: the clock set to its time, the camera placed at once, chosen labels, drawn at once, a point projected
LK3D.clock.set(2500);
fig.view('front', { ms: 0 });
fig.focus(['lens'], { ms: 0 });
fig.set({ camera: { yaw: 10, zoom: 2, target: [0, 0, 0] }, labels: ['lens', 'object'], transparent: true });
const drawn: boolean = fig.drawNow();
const onStage: [number, number] | null = fig.project([0, 0, 0], 'lens');
const film = mount(document.body, scene, { transparent: true, labels: [] });
LK3D.themes.film = { ...LK3D.themes.dark, bg: 'transparent' };
// @ts-expect-error a label mode it does not have
fig.set({ labels: 'some' });
// @ts-expect-error the camera in degrees and scene units, not a string
fig.set({ camera: 'front' });
fig.set({ cut: 0.4, section: { normal: [1, 0, 0], offset: 0.2 } });
void [drawn, onStage, film];
void [problems, bad1, bad2, bad3, themed, bad5, versioned, bad6, fig.theme, fig.timeScale];

// the exporter: lk3d itself with it set, and a scene straight to .glb
const glb: Uint8Array = sceneToGLB(scene, { animate: true, motion: {} });
const sameEngine: typeof LK3D = LK3DX;
void glb;
void sameEngine;
// @ts-expect-error  a scene's motions are numbers
sceneToGLB(scene, { motion: { lift: 'up' } });
