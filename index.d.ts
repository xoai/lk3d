// Types for lk3d: the options of mount(), the figure it returns, and the rest of the page API. The scene's own types
// (Scene, Part, Shape, Handle, Motion, Joint, …) are generated from schema/scene.schema.json into scene.d.ts and
// re-exported from here.

import type { Scene, Look, SceneTheme, Vec3, Color, JointFields } from './scene.js';
export * from './scene.js';

/** the themes lk3d has by name (a scene may also say 'auto') */
export type ThemeName = Exclude<SceneTheme, 'auto'>;
/** a theme's colours ("#rrggbb"): add one to LK3D.themes to use it by name */
export interface Theme {
  /** the page behind the model ('transparent': none); the words (and text lines); the lines (outlines, leader
   * lines, label borders) */
  bg: Color | 'transparent';
  ink: Color;
  line: Color;
  /** label backgrounds; hints and credits; the "not to scale" note; a chosen label */
  paper: Color;
  muted: Color;
  warn: Color;
  highlight: Color;
  /** the pen look's solids and its ground shadow */
  solid: Color;
  shadow: Color;
  /** light is added (not inked) on a dark page */
  dark: boolean;
}

/** a value read off another: times ratio (1) plus offset (0), or off keys [the other's value, this one's] */
export type Scaled = Omit<NonNullable<JointFields['follow']>, 'joint'>;
/** a motion as the page drives it */
export interface MotionHandle {
  readonly value: number;
  readonly playing: boolean;
  set(v: number): void;
  play(): void;
  stop(): void;
}

export interface Strings {
  model: string;
  hintTouch: string;
  hintMouse: string;
  /** what the keys do, for screen readers (the figure's description) */
  keys: string;
  /** the name of the list of parts, for screen readers */
  parts: string;
  credit: string;
  ai: string;
  apart: string;
  apartLabel: string;
  takeApart: string;
  putTogether: string;
  takeApartTitle: string;
  cut: string;
  cutTitle: string;
  xray: string;
  xrayTitle: string;
  labels: string;
  labelsTitle: string;
  studio: string;
  ink: string;
  pen: string;
  styleTitle: string;
  front: string;
  side: string;
  top: string;
  home: string;
  play: string;
  pause: string;
  /** the decimal mark in numbers read out (handles) */
  decimal: string;
}

export interface MountOptions {
  /** an element for the name and note of the part pointed at, and what it says when none is */
  info?: HTMLElement;
  infoIdle?: string;
  /** false: no built-in buttons */
  controls?: boolean;
  style?: Look;
  theme?: string;
  labels?: Labels;
  /** nothing painted behind the model, in any look (the theme's lines, solids and words still apply) */
  transparent?: boolean;
  /** a part chosen by the reader (a tap, a click, a handle reached by Tab), or null when they let it go */
  onPick?: (part: BuiltPart | null) => void;
  /** the part under the pointer, as it moves onto one or off it (null) */
  onHover?: (part: BuiltPart | null) => void;
  /** a handle moved by the reader (not by the page's own set()) */
  onHandle?: (id: string, value: number) => void;
  /** what a screen reader says for a handle's value */
  handleText?: (id: string, value: number) => string | undefined;
  /** 'en' (default), 'vi', or any key of LK3D.locales */
  locale?: string;
  strings?: Partial<Strings>;
  /** the page's own class for the built-in buttons */
  buttonClass?: string;
  /** shape detail (1; 0.6 on small screens) */
  quality?: number;
  /** the most triangles the scene may have here (1 million where memory is small: a screen under 700 px a side, or
   * navigator.deviceMemory under 4 GB; else 10 million, 2 million a part): over it, the scene is built coarser (down to
   * a quarter of `quality`), else refused with an Error */
  maxTriangles?: number;
  /** the full rules to check the scene by before it is built (`validate` from 'lk3d/validate'): its first problem is
   * thrown as an Error naming the place. Without it, the engine's own guard checks what building needs */
  validate?: (scene: unknown) => { path: string; message: string }[];
  maxDpr?: number;
  adaptive?: boolean;
  ao?: boolean;
  /** for testing: the 2D fallback, or WebGL 1 */
  force2d?: boolean;
  webgl1?: boolean;
}

/** a part as the engine built it */
export interface BuiltPart {
  id: string;
  name: string;
  note: string;
  group: string;
  lo: Vec3;
  hi: Vec3;
  center: Vec3;
  tris: number;
  [k: string]: unknown;
}

/** points along a path; setting speed, offset or visible draws again */
export interface Particles {
  /** scene units a second */
  speed: number;
  /** how far along the path they are, as a share of it */
  offset: number;
  visible: boolean;
  remove(): void;
}
/** balls the page places (x, y, z and a colour band in pos4); add one to version after moving them */
export interface Balls {
  pos4: Float32Array;
  count: number;
  radius: number;
  version: number;
  visible: boolean;
  resize(n: number): void;
  remove(): void;
}
/** streaks along paths; setting speed, amount or visible draws again */
export interface Flow {
  /** scene units a second */
  speed: number;
  /** the share of the streaks drawn, 0 to 1 */
  amount: number;
  visible: boolean;
  set(
    o: Partial<Pick<FlowOptions, 'speed' | 'amount' | 'length' | 'width' | 'spread' | 'opacity' | 'ramp'>> & {
      visible?: boolean;
    },
  ): void;
  remove(): void;
}
export interface FlowOptions {
  /** one path, or several (the streaks are shared out among them) */
  path?: Vec3[];
  paths?: Vec3[][];
  closed?: boolean;
  /** streaks (300; at most 8000) */
  count?: number;
  speed?: number;
  amount?: number;
  /** a streak's length, as a share of its path (0.12) */
  length?: number;
  /** its width in CSS pixels (1.6; at least 1.25) */
  width?: number;
  /** how far streaks wander from the path, in scene units (0) */
  spread?: number;
  opacity?: number;
  /** colours along the path: 'cool', 'heat', one colour, or up to four */
  ramp?: 'cool' | 'heat' | Color | Color[];
  /** a part whose movement the streaks follow */
  part?: string;
}

export interface Stream {
  /** how fast it moves, scene units a second */
  speed: number;
  /** how thick it is, 0 to 1 and beyond */
  density: number;
  visible: boolean;
  set(
    o: Partial<Pick<StreamOptions, 'speed' | 'density' | 'turbulence' | 'swirl' | 'ramp'>> & { visible?: boolean },
  ): void;
  remove(): void;
}
export interface StreamOptions {
  /** the path along its middle (2 to 16 points) */
  path: Vec3[];
  /** its radius: one number, or stops along the path [f, rOut] or [f, rIn, rOut] (f from 0 to 1) */
  radius?: number | ([number, number] | [number, number, number])[];
  /** scene units a second, where its relative speed is 1 (by continuity: at its start) */
  speed?: number;
  /** its speed along the path as stops [f, fraction of speed]; without them, from continuity (faster where narrower) */
  speeds?: [number, number][];
  /** where along the path (0 to 1) it starts to fade out (0.7) */
  fade?: number;
  density?: number;
  /** how much the filaments are stirred (0.5), and how much more towards the edge as it goes (0.5) */
  turbulence?: number;
  swirl?: number;
  /** colours along the path: 'cool', 'heat', one colour, or up to four */
  ramp?: 'cool' | 'heat' | Color | Color[];
}

export interface Lines {
  set(k: number, a: Vec3 | null, b?: Vec3): void;
  clear(): void;
  glow(v: number): void;
  remove(): void;
  visible: boolean;
  radius: number;
}

export type ViewName = 'front' | 'side' | 'top' | 'iso' | 'home';
/** which labels show: on hover and when taken apart, all, none, or exactly those of these parts (ids or groups) */
export type Labels = 'auto' | 'all' | 'none' | string[];
/** a camera: degrees, scene units; zoom instead of dist: how close (2: twice as close as the whole model) */
export interface CameraView {
  yaw?: number;
  pitch?: number;
  dist?: number;
  zoom?: number;
  target?: Vec3;
}

export interface Figure {
  /** '' while the figure waits for a WebGL context (far off screen on a page holding many figures) */
  readonly renderer: 'webgl2' | 'webgl1' | '2d' | '';
  readonly hifi: boolean;
  readonly parts: BuiltPart[];
  /** resolves once the figure is complete: its first picture, the crease shading, every texture */
  readonly ready: Promise<Figure>;
  set(o: {
    /** the spin angle, degrees, of parts with `spin` */
    spin?: number;
    explode?: number;
    /** the cut: on, off, or how far its plane has swept in (0: just outside the model, nothing cut; 1: at the section) */
    cut?: boolean | number;
    /** the cut's plane: what lies on the side the normal points to, beyond offset along it, is cut away */
    section?: { normal?: Vec3; offset?: number };
    xray?: boolean;
    labels?: Labels;
    style?: Look;
    theme?: string | null;
    /** nothing painted behind the model */
    transparent?: boolean;
    /** the camera, placed at once (a gliding view stops) */
    camera?: CameraView;
    /** how fast particles and flows move (1; 0.2 for slow motion) */
    timeScale?: number;
    /** the camera: perspective, or ortho (parallel lines stay parallel) */
    projection?: 'perspective' | 'ortho';
    glow?: Record<string, number>;
    hide?: string[];
    move?: Record<string, Vec3>;
    /** motions' values, by id */
    motion?: Record<string, number>;
    /** joints' values, by id, over their drives (a joint held by a rod or an aim keeps to it); each call replaces the last */
    joints?: Record<string, number>;
  }): void;
  /** a motion of the scene, to set or play */
  /** the figure as glTF 2.0 binary (.glb), posed as it is now; animate: each motion as an animation. Needs the
   * exporter: import lk3d/export, or load dist/lk3d-export.min.js after dist/lk3d.min.js (it throws without) */
  exportGLB(o?: { animate?: boolean; samples?: number }): Uint8Array;
  motion(id: string): MotionHandle | undefined;
  /** a liquid by its part: its volume, its surface's height in the scene; set its volume */
  liquid(
    id: string,
  ): { readonly volume: number; readonly level: number | null; set(o: { volume?: number }): void } | undefined;
  /** a vessel: how open its outlet is (0 to 1), what pours out a second; open it (when no motion does) */
  vessel(id: string): { readonly open: number; readonly flow: number; set(o: { open?: number }): void } | undefined;
  /** a gas by its part: its height (where its piston rests), its moles and temperature; heat it, add to it */
  gas(id: string):
    | {
        readonly height: number;
        readonly n: number;
        readonly T: number;
        set(o: { n?: number; T?: number; p?: number; mass?: number }): void;
      }
    | undefined;
  /** a buoyant plume of air or gas rising from `at`: widening and slowing as one does (a stream) */
  plume(o: { at: Vec3; height: number; radius?: number } & Partial<StreamOptions>): Stream;
  /** glide the camera there, over ms milliseconds (600; 0: at once) */
  view(v: ViewName | [number, number] | CameraView, o?: { ms?: number }): void;
  /** zoom by a factor (2: twice as close), towards a point of the stage (CSS pixels) if given */
  zoom(factor: number, x?: number, y?: number): void;
  /** how close the view is: 1 fits the whole model */
  readonly zoomLevel: number;
  explode(v: number): void;
  focus(ids: string[], o?: { yaw?: number; pitch?: number; ms?: number }): void;
  camera(): { yaw: number; pitch: number; dist: number; target: Vec3 };
  readonly selected: string | null;
  /** choose a part (or null) without calling onPick */
  select(id: string | null): void;
  readonly labels: Labels;
  readonly style: Look;
  readonly theme: string | null;
  readonly timeScale: number;
  particles(o: {
    path: Vec3[];
    count?: number;
    color?: Color;
    size?: number;
    part?: string;
    closed?: boolean;
  }): Particles;
  particles(o: { count: number; radius: number; colors?: [Color, Color, Color] }): Balls;
  flow(o: FlowOptions): Flow;
  /** air, gas or liquid as a moving volume along a path: a jet, an intake, a plume (WebGL; streaks in 2D) */
  stream(o: StreamOptions): Stream;
  lines(o?: { count?: number; radius?: number; color?: Color; studioColor?: Color; glow?: Color }): Lines;
  /** a handle's value, read or set by the page (setting it does not call onHandle) */
  handle(id: string): { readonly value: number; set(v: number): void } | undefined;
  /** call fn every frame while it returns true; returns a function that removes it */
  tick(fn: (now: number) => boolean): () => void;
  pick(x: number, y: number): string | null;
  redraw(): void;
  /** draw the state as it is now, before returning; false while the shaders are still compiling */
  drawNow(): boolean;
  /** a point of the scene (or of a part, as placed now) on the stage, in CSS pixels; null behind the eye */
  project(p: Vec3, id?: string): [number, number] | null;
  readonly refreshMs: number;
  stats(): Record<string, unknown>;
  destroy(): void;
}

export interface Defaults {
  locale: string;
  strings: Partial<Strings>;
  buttonClass: string;
}

export function mount(el: HTMLElement, scene: Scene, opts?: MountOptions): Figure;
/** the geometry a scene makes, without a page (for tests and tools); maxTriangles: 10 million by default */
export function build(scene: Scene, quality?: number, maxTriangles?: number): { parts: BuiltPart[] };
export const locales: Record<string, Strings>;
export const themes: Record<string, Theme>;
export const defaults: Defaults;
/** whether the reader asked for less motion (read once, when lk3d loads) */
export const reduce: boolean;
/** the page API's version: it goes up when a page's own code must change */
export const version: number;
/** the version of the scene format this engine reads (a scene says its own in `lk3d`) */
export const format: number;
/** One clock for every figure's animation: slow it, stop it (speed 0), step it or set it, for tests, tools and
 * timelines (stopped, flows, streams and particles along paths are placed for its time) */
export interface Clock {
  speed: number;
  /** its time, in milliseconds */
  now(): number;
  step(ms: number): void;
  /** set its time (backwards too) */
  set(ms: number): void;
}
export const clock: Clock;
/** a part's words as HTML: plain text, keeping only bare b, i, em, strong, sub, sup and br */
export function safeHTML(s: string): string;

declare const LK3D: {
  mount: typeof mount;
  build: typeof build;
  locales: typeof locales;
  themes: typeof themes;
  defaults: Defaults;
  reduce: boolean;
  version: number;
  clock: Clock;
  /** the version of the scene format this engine reads */
  format: number;
  safeHTML: typeof safeHTML;
  /** the glTF writer, set by the exporter (lk3d/export, dist/lk3d-export.min.js): what exportGLB() calls */
  toGLB?: (scene: unknown, o?: object) => Uint8Array;
};
export default LK3D;
