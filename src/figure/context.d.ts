// The state a mounted figure's parts share (src/figure/*.js): one object per figure, made by mount() in index.js and
// passed to each part's factory, which reads what it needs and adds what it owns. Every field ends in _ : the bundle
// renames them short (build.mjs, mangleProps), as it does locals; nothing public may end in _.
import type { Scene, Look, SceneTheme, Vec3 } from '../../scene.js';
import type { MountOptions, BuiltPart } from '../../index.js';

/** mount()'s options (index.d.ts) */
export type Options = MountOptions;

/** what draws: the WebGL renderer (renderer-gl.js), the 2D one (renderer-2d.js), or a stand-in until a context */
export interface Renderer {
  /** 'webgl2', 'webgl1', '2d', or '' (the stand-in) */
  kind: string;
  hifi?: boolean;
  shadows?: boolean;
  parallel?: boolean;
  pending?: number;
  draw(frame: any): boolean | void;
  prewarm?(): void;
  setAO(batch: any): void;
  upload?(batch: any): void;
  instances?(batch: any): void;
  release?(thing: any): void;
  edges?(batch: any): void;
  dispose(): void;
}

/** this figure among those holding a WebGL context (backend.js) */
export interface Slot {
  seen: number;
  near?: boolean;
  give(): void;
}

/** the figure's state as the page sees it (fig._state) */
export interface State {
  style: Look | string;
  theme: SceneTheme | string | null;
  transparent: boolean;
  timeScale: number;
  projection: string;
  explode: number;
  spin: number;
  cut: boolean | number;
  section: { normal: Vec3 | number[]; offset: number };
  labels: any;
  xray: boolean;
  yaw: number;
  pitch: number;
  dist: number;
  target: number[];
  hover: string | null;
  selected: string | null;
  motion: Record<string, number>;
  joints: Record<string, number>;
}

/** a part as built (geometry.js) and as the figure keeps it; open, as the parts add to it */
export type Part = BuiltPart & Record<string, any>;
/** a matrix, column-major (math.js) */
type Mat = number[] | Float32Array;
/** a handle as the figure keeps it (pose.js): what the reader takes hold of */
export interface Grip {
  /** the part with the handle */
  part: Part;
  /** the handle as the scene wrote it (part.handle: turn, slide or along, min, max, snap…) */
  handle: any;
  value: number;
  /** the parts it moves: its own and those it carries (handle.moves) */
  parts: Part[];
  /** an along handle's path, measured (handles.js: measure) */
  path: any;
  /** its range input (input.js), for the keyboard and screen readers */
  input: HTMLInputElement | null;
  /** a turn with no stops: it goes round and round */
  round: boolean;
  /** the digits its value is read out to */
  digits?: number;
}

export interface Ctx {
  // ---- given by mount (index.js)
  /** the page's element the figure is mounted in */
  host_: HTMLElement & { lk3d?: any };
  /** the scene as the page gave it */
  spec_: Scene;
  opts_: Options;
  /** the words on the page, in the figure's locale (locales/en.js) */
  words_: Record<string, string>;
  /** what the page and the reader have set: the look, the camera, taking apart, the cut… (fig._state) */
  state_: State;
  stats_: {
    setupMs: number;
    firstFrameMs: number | null;
    treesMs: number | null;
    aoMs: number | null;
    refreshMs: number | null;
  };
  /** performance.now() when mount began (stats_ count from it) */
  mountedAt_: number;
  ready_: Promise<any>;
  /** resolves ready_ (null once it has) */
  resolveReady_: ((api?: any) => void) | null;
  destroyed_: boolean;
  /** a phone-sized screen (under 700 px a side): coarser shapes, a smaller shadow map */
  smallScreen_: boolean;
  /** the canvas the reader points at (and WebGL draws on) */
  canvas_: HTMLCanvasElement;
  /** running animations: each called with the clock's time every frame, kept while it returns true */
  animations_: Set<(now: number) => boolean | void>;
  /** the built-in controls' hooks, told when the page changes what they show (empty with controls: false) */
  controls_: { explode?(v: number): void; motion?(id: string): void; style?(): void };
  motions_: any[];
  particles_: any[];
  flows_: any[];
  streams_: any[];
  lines_: any[];
  /** what destroy() runs: listeners removed, observers and timers stopped */
  cleanups_: (() => void)[];
  /** the built scene (geometry.js: buildFitting): its parts, their batches, its bounds, its detail q */
  built_: {
    parts: Part[];
    radius: number;
    center: number[];
    lo: number[];
    hi: number[];
    q: number;
    [key: string]: any;
  };
  /** a part by its id */
  part_(id: string | null): Part | undefined;

  // ---- backend.js
  renderer_: Renderer;
  /** the canvas the renderer draws on: canvas_, or the 2D fallback's canvas under it */
  drawCanvas_: HTMLCanvasElement;
  /** the last picture, kept on a 2D canvas while the WebGL context is given up (null otherwise) */
  keptPicture_: HTMLCanvasElement | null;
  contextLost_: boolean;
  glSlot_: Slot;
  fallback2d_(err: Error): void;
  /** near the screen: take a WebGL context, from the figure seen least recently if the page holds the most */
  claimGL_(): void;
  /** the GPU's name, '' without WebGL */
  gpuName_(): string;

  // ---- pose.js
  handles_: Grip[];
  /** counted up whenever a motion's or a joint's value changes (the joints are solved again then) */
  poseVersion_: number;
  /** a motion's id → its step in the frame loop, while it plays */
  playing_: Map<string, (now: number) => boolean>;
  /** where taking apart and the page's offset move a part */
  offsetOf_(p: Part): number[];
  /** a part's matrix from that move alone (a handle's frame, a spinning part's label) */
  baseMatrix_(p: Part): Mat;
  /** a part's whole matrix: moved, by its motions, joint, handle and spin */
  modelMatrix_(p: Part): Mat;
  /** taken apart this far at once (a tween running stops) */
  explodeNow_(v: number): void;
  tweenExplode_(to: number): void;
  setMotion_(mo: any, v: number): void;
  playMotion_(mo: any): any;
  stopMotion_(mo: any): void;

  // ---- liquids.js
  /** the scene's vessels, liquids and gases (fluids.js: fluidsOf), null without any */
  fluids_: any;
  /** each gas's height in its vessel (its piston rides on it) */
  gasHeights_: Map<string, number>;
  layersIn_(v: any): any[];
  openOf_(v: any): number;
  fluidStep_(dt: number): boolean;

  // ---- camera.js
  /** the camera's view-projection matrix, as last placed */
  viewProj_: Mat;
  eye_: number[];
  /** the camera's distance to what it looks at and the half-height it sees there, for the shaders */
  frustum_: { d: number; h: number; ortho: boolean };
  /** the scene's own camera distance: zoom 1 */
  baseDist_: number;
  /** how far the view moves as the model is taken apart (the scene's view.explodeShift, scaled) */
  explodeShift_(): number[];
  /** places the camera for the state now (viewProj_, eye_, frustum_) */
  camera_(): void;
  project_(q: number[]): number[] | null;
  /** the cut's plane [nx, ny, nz, -offset] */
  cutPlane_(): number[];
  /** the box round the parts drawn now */
  shownBox_(): { center: number[]; radius: number; lo: number[]; hi: number[] };
  boxOf_(ps: Part[]): { center: number[]; radius: number; lo: number[]; hi: number[] };
  rayAt_(px: number, py: number): { A: number[]; D: number[] };
  zoom_(k: number, x?: number, y?: number): void;
  view_(name: any, o?: { ms?: number; [key: string]: any }): void;
  cancelView_(): void;

  // ---- dom.js
  stage_: HTMLDivElement;
  /** the overlay that holds the labels' leader lines */
  leaderSvg_: SVGSVGElement;
  /** the overlay that holds the labels */
  tagLayer_: HTMLDivElement;
  hint_: HTMLDivElement;
  scaleEl_: HTMLDivElement | null;
  namedParts_: Part[];
  /** the info box and what is said aloud, for the part chosen or pointed at */
  showInfo_(why?: 'pick' | 'hover'): void;

  // ---- loop.js
  /** the stage's size, CSS pixels */
  width_: number;
  height_: number;
  dpr_: number;
  /** the share of full resolution drawn (lowered while frames come late) */
  resolution_: number;
  /** this screen's frame interval as measured */
  refreshMs_: number;
  /** asks for a frame */
  kick_(): void;
  /** draws the frame in progress again, without asking for another (a tween already in the loop) */
  markDirty_(): void;
  sizeCanvas_(): boolean;
  drawNow_(): boolean;
  travel_(X: any, key: string, speed: number, t: number, dt: number, wrap?: number): boolean;

  // ---- look.js
  look_: any;
  lookKey_: string;
  lookNow_(): any;

  // ---- labels.js
  /** each label's width, by look and part (emptied when the layout or the fonts change) */
  labelWidths_: Record<string, any>;
  placeLabels_(): void;

  // ---- pick.js
  bvhOf_(b: any): any;
  pickHit_(px: number, py: number, see?: number): { id: string | null; t: number; A: number[]; D: number[] };
  pickAt_(px: number, py: number, see?: number): string | null;

  // ---- idle.js
  /** every batch has its crease shading (ambient occlusion) */
  aoComplete_: boolean;
  /** whether the pen look's edges are drawn now */
  showEdges_(): boolean;
  findEdges_(): void;
  /** resolves ready_ once the figure is complete */
  checkReady_(): void;

  // ---- input.js
  setHandle_(grip: Grip, v: number, byReader: boolean): void;
  /** a hidden part's handle out of the Tab order and of what screen readers read */
  syncHandleInputs_(): void;

  // ---- additions.js
  addParticles_(o: any): any;
  addFlow_(o: any): any;
  addStream_(o: any): any;
  addLines_(o?: any): any;

  // ---- api.js
  api_: any;
}

declare global {
  interface Window {
    LK3D: any;
  }
}
