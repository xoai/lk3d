// Types for lk3d: the scene (as data; schema/scene.schema.json describes the same format, with the rules), the options
// of mount() and the figure it returns.

export type Vec3 = [number, number, number];
/** "#rrggbb" or "#rgb" */
export type Color = string;

export interface Scene {
  /** the version of the scene format it is written in (1) */
  lk3d?: 1;
  parts: Part[];
  /** the stage's proportions (16 : 10 by default); on a narrow screen `narrow`, e.g. "1 / 0.9" */
  w?: number;
  h?: number;
  narrow?: string;
  title?: string;
  /** a description of the model for screen readers */
  alt?: string;
  /** the first look: drawn (default), realistic, or near-white with thin lines */
  style?: Look;
  /** the colours of the page behind the model, its lines and words (auto: as the reader's system is set) */
  theme?: ThemeName | 'auto';
  /** the studio look's environment */
  env?: 'studio' | 'warm' | 'night';
  view?: {
    yaw?: number;
    pitch?: number;
    dist?: number;
    target?: Vec3;
    fov?: number;
    /** perspective (the default), or ortho: parallel lines stay parallel, as in a technical illustration */
    projection?: 'perspective' | 'ortho';
    explodeZoom?: number;
    explodeShift?: Vec3;
  };
  /** lines where faces meet at an angle: drawn in the pen look unless false; true: in every look */
  edges?: boolean;
  /** what the geometry check excuses: pairs of parts that may run into each other or hide each other's label; parts
   * that hang in the air on purpose (or true: all) */
  check?: { allow?: [string, string][]; float?: boolean | string[] };
  /** a shadow under the model (true by default) */
  ground?: boolean;
  /** the cut: a plane, or false to offer none */
  section?: false | { normal?: Vec3; offset?: number };
  /** honest scale: a bar of a true length and/or a note saying what is not to scale */
  scale?: { bar?: { length: number; label: string }; note?: string };
  /** glTF 2.0 models (.glb, base64) by name, for { model: name } shapes */
  models?: Record<string, Model>;
  /** a page's own data may ride along */
  [extra: string]: unknown;
}

export type Look = 'ink' | 'studio' | 'pen';
export type ThemeName = 'light' | 'dark' | 'blueprint' | 'sepia';
/** a theme's colours ("#rrggbb"): add one to LK3D.themes to use it by name */
export interface Theme {
  /** the page behind the model; the words (and text lines); the lines (outlines, leader lines, label borders) */
  bg: Color;
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

export interface Model {
  data?: string;
  title?: string;
  author?: string;
  license?: string;
  url?: string;
  /** a scan of a real specimen, a scientific dataset, an artist's model, or made by AI (then called an illustration) */
  source?: 'scan' | 'dataset' | 'artist' | 'ai';
}

export type Material =
  | 'metal'
  | 'steel'
  | 'copper'
  | 'gold'
  | 'plastic'
  | 'rubber'
  | 'paint'
  | 'glass'
  | 'magnet'
  | 'matte'
  | 'wood'
  | 'tissue'
  | 'membrane'
  | 'skin'
  | 'bone'
  | 'rock'
  | 'soil'
  | 'ice'
  | 'water'
  | 'gas';

export interface Part {
  /** unique in the scene */
  id: string;
  shapes: Shape[];
  /** its label, and what the figure says when it is pointed at (may hold simple HTML) */
  name?: string;
  note?: string;
  group?: string;
  material?: Material;
  color?: Color;
  studioColor?: Color;
  glow?: Color;
  /** keeps its full colour in the pen look */
  accent?: boolean;
  /** whether its edges are drawn (by default yes, except on soft shapes: models, blobs, trees, molecules…) */
  edges?: boolean;
  /** false: it stays whole when the model is cut open (a stand, a frame) */
  cut?: false;
  opacity?: number;
  xray?: boolean;
  hidden?: boolean;
  /** where it moves to when the model is taken apart */
  explode?: Vec3;
  at?: Vec3;
  rot?: Vec3;
  scale?: Vec3;
  /** where its leader line points, or false for no label */
  label?: false | Vec3;
  /** turns with the figure's spin angle (set({ spin })) */
  spin?: { axis?: 'x' | 'y' | 'z'; ratio?: number; center?: Vec3 };
  handle?: Handle;
  /** fine surface detail in the studio look (WebGL 2) */
  surface?: { kind: 'brushed' | 'knurl' | 'ribs' | 'grain' | 'skin' | 'cast'; scale?: number; strength?: number };
  /** glass that bends what is behind it (material: glass; 1 for a lens) */
  refract?: number;
  [extra: string]: unknown;
}

interface HandleCommon {
  min?: number;
  max?: number;
  snap?: number;
  value?: number;
  label?: string;
  unit?: string;
  moves?: string[];
}
/** the reader moves the part with the pointer or the keys, held to one rule */
export type Handle =
  | (HandleCommon & { turn: { axis: Vec3; center?: Vec3 } })
  | (HandleCommon & { slide: { axis: Vec3 }; min: number; max: number })
  | (HandleCommon & { along: { path: Vec3[]; closed?: boolean } });

interface Placement {
  at?: Vec3;
  rot?: Vec3;
  scale?: Vec3 | number;
  color?: Color;
  /** 0.5 for a shape repeated hundreds of times, 2 for a close-up */
  detail?: number;
  /** copies around an axis */
  repeat?: number | { n: number; step?: number; start?: number; axis?: 'x' | 'y' | 'z' };
  [option: string]: unknown;
}
type One<K extends string, V> = Placement & { [P in K]: V };
/** exactly one kind per shape (see the shape catalogue for each kind's parameters) */
export type Shape =
  | One<'lathe', Array<[number, number]>>
  | One<'cylinder', { r: number; x0?: number; x1?: number; ri?: number; r1?: number }>
  | One<'box', Vec3>
  | One<'sphere', number>
  | One<'torus', [number, number]>
  | One<'tube', Vec3[]>
  | One<'helix', object>
  | One<'loop', object>
  | One<'ellipsoid', Vec3>
  | One<'capsule', object>
  | One<'blob', object>
  | One<'shell', object>
  | One<'tree', object>
  | One<'molecule', { atoms: Array<{ el: string; at: Vec3 }>; [k: string]: unknown }>
  | One<'dna', object>
  | One<'extrude', object>
  | One<'terrain', object>
  | One<'ring', object>
  | One<'orbit', { a: number; [k: string]: unknown }>
  | One<'blade', object>
  | One<'scatter', { shape: Shape; n?: number; [k: string]: unknown }>
  | (Placement & { model: string; node?: string });

export interface Strings {
  model: string;
  hintTouch: string;
  hintMouse: string;
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
  labels?: 'auto' | 'all' | 'none';
  onPick?: (part: BuiltPart | null) => void;
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

export interface Particles {
  speed: number;
  visible: boolean;
  remove(): void;
}
export interface Balls {
  pos4: Float32Array;
  count: number;
  radius: number;
  version?: number;
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
  set(o: Partial<FlowOptions> & { speed?: number; amount?: number; visible?: boolean }): void;
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

export interface Lines {
  set(k: number, a: Vec3 | null, b?: Vec3): void;
  clear(): void;
  glow(v: number): void;
  remove(): void;
  visible: boolean;
  radius: number;
}

export type ViewName = 'front' | 'side' | 'top' | 'iso' | 'home';

export interface Figure {
  readonly renderer: 'webgl2' | 'webgl1' | '2d';
  readonly hifi: boolean;
  readonly parts: BuiltPart[];
  /** resolves once the figure is complete: its first picture, the crease shading, every texture */
  readonly ready: Promise<Figure>;
  set(o: {
    /** the spin angle, degrees, of parts with `spin` */
    spin?: number;
    explode?: number;
    cut?: boolean;
    xray?: boolean;
    labels?: 'auto' | 'all' | 'none';
    style?: Look;
    theme?: string | null;
    /** how fast particles and flows move (1; 0.2 for slow motion) */
    timeScale?: number;
    /** the camera: perspective, or ortho (parallel lines stay parallel) */
    projection?: 'perspective' | 'ortho';
    glow?: Record<string, number>;
    hide?: string[];
    move?: Record<string, Vec3>;
  }): void;
  view(v: ViewName | [number, number] | { yaw?: number; pitch?: number; dist?: number; target?: Vec3 }): void;
  explode(v: number): void;
  focus(ids: string[], o?: { yaw?: number; pitch?: number }): void;
  camera(): { yaw: number; pitch: number; dist: number; target: Vec3 };
  readonly selected: string | null;
  /** choose a part (or null) without calling onPick */
  select(id: string | null): void;
  readonly labels: 'auto' | 'all' | 'none';
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
  lines(o?: { count?: number; radius?: number; color?: Color; studioColor?: Color; glow?: Color }): Lines;
  /** a handle's value, read or set by the page (setting it does not call onHandle) */
  handle(id: string): { readonly value: number; set(v: number): void } | undefined;
  /** call fn every frame while it returns true; returns a function that removes it */
  tick(fn: (now: number) => boolean): () => void;
  pick(x: number, y: number): string | null;
  redraw(): void;
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
/** the geometry a scene makes, without a page (for tests and tools) */
export function build(scene: Scene, quality?: number): { parts: BuiltPart[] };
export const locales: Record<string, Strings>;
export const themes: Record<string, Theme>;
export const defaults: Defaults;
export const reduce: boolean;
export const version: number;
/** One clock for every figure's animation: slow it, stop it (speed 0) and step it, for tests and tools */
export interface Clock {
  speed: number;
  now(): number;
  step(ms: number): void;
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
};
export default LK3D;
