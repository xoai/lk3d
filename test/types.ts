// Type check of the declarations (npm run typecheck): a page's use of lk3d must compile, and mistakes must not.
import LK3D, { mount, type Scene, type Figure } from 'lk3d';
import { validate } from 'lk3d/validate';

const scene: Scene = {
  w: 16, h: 9, style: 'studio', env: 'night', scale: { bar: { length: 1, label: '10 cm' } },
  parts: [
    { id: 'lens', name: 'Lens', material: 'glass', refract: 1, shapes: [{ lathe: [[-0.08, 0], [0, 1], [0.08, 0]], closed: true }] },
    { id: 'object', shapes: [{ cylinder: { r: 0.03, x0: 0, x1: 0.3 }, rot: [0, 0, 90] }], handle: { slide: { axis: [1, 0, 0] }, min: -5, max: 0 } },
    { id: 'ring', shapes: [{ torus: [1, 0.03] }], handle: { turn: { axis: [1, 0, 0] }, moves: ['lens'] }, surface: { kind: 'knurl', strength: 0.6 } },
  ],
};
LK3D.defaults.locale = 'vi';
const fig: Figure = mount(document.body, scene, { onHandle: (id, v) => console.log(id, v.toFixed(1)), handleText: (id, v) => `d = ${-v * 10} cm`, locale: 'en' });
fig.set({ explode: 1, glow: { lens: 0.5 } });
const rays = fig.lines({ count: 3, color: '#ffcc55' }); rays.set(0, [0, 0, 0], [1, 1, 0]);
const { yaw, pitch } = fig.camera(); fig.view({ yaw, pitch: pitch + 10 });
fig.select(fig.selected === 'lens' ? null : 'lens');
fig.handle('object')?.set(-3);
const problems: { path: string; message: string }[] = validate(scene);

// @ts-expect-error a slide handle needs its range
const bad1: Scene = { parts: [{ id: 'a', shapes: [{ sphere: 1 }], handle: { slide: { axis: [1, 0, 0] } } }] };
// @ts-expect-error not a material
const bad2: Scene = { parts: [{ id: 'a', shapes: [{ sphere: 1 }], material: 'velvet' }] };
// @ts-expect-error a box is three numbers
const bad3: Scene = { parts: [{ id: 'a', shapes: [{ box: [1, 1] }] }] };
// @ts-expect-error looks are ink or studio
fig.set({ style: 'photo' });
void [problems, bad1, bad2, bad3];
