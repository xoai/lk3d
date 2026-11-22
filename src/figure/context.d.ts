// The state a mounted figure's parts share (src/figure/*.js): one object per figure, made by mount() in index.js and
// passed to each part's factory, which reads what it needs and adds what it owns. Every field ends in _ : the bundle
// renames them short (build.mjs, mangleProps), as it does locals; nothing public may end in _.
import type { Scene, Look, SceneTheme, Vec3 } from '../../scene.js';
import type { MountOptions, BuiltPart, Lockable, ChangeCause } from '../../index.js';

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
  /** a changing mesh's buffers written again in place (the live add-on's surfaces) */
  refill?(batch: any): void;
  release?(thing: any): void;
  /** whether it places this flow's streaks itself, on the GPU (WebGL 2), so the frame loop need not */
  placesFlow?(flow: any): boolean;
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
  /** the cut's plane, and a quarter cut's second (section.second) */
  section: {
    normal: Vec3 | number[];
    offset: number;
    second?: { normal?: Vec3 | number[]; offset?: number } | null | false;
  };
  labels: any;
  /** the dimensions shown, by id; null: the scene's own */
  dimensions: string[] | null;
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
    /** whether the crease shading was worked out in the page's worker (ao.js), not here */
    aoWorker: boolean;
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
  // ---- the figure's state (state.js)
  /** where what is gliding is going, stored where the glide is made (pose.js: explode; steps.js: the cut; camera.js:
   * the camera), so state() can say it; null when nothing glides there */
  towards_: {
    explode: number | null;
    cut: number | null;
    camera: { yaw: number; pitch: number; dist: number; target: number[] } | null;
  };
  /** what the reader may not change (opts_.lock, fig.lock) */
  lock_: Set<Lockable>;
  /** whether the page has locked this against the reader (each gesture asks where it starts) */
  locked_(what: Lockable): boolean;
  /** who changes the figure now: onChange is told the strongest since it was last told (the reader, the page, a motion) */
  mark_(cause: ChangeCause): void;
  /** a function, made to act as the reader (the built-in controls, the steps' panel) */
  asReader_<T extends (...args: any[]) => any>(fn: T): T;
  /** whether the reader is dragging the view (or it glides on after a flick): onChange told every 250 ms */
  dragging_: boolean;
  /** the figure's state now, as fig.state() gives it */
  stateOf_(): import('../../index.js').FigureState;
  /** set()'s state keys: the step first, then rest() (set's own keys), then handles, the part chosen, which motions
   * play, liquids, vessels and gases */
  setState_(changes: any, rest: () => void): void;
  /** once a frame (loop.js): onChange, if the state differs from the one last told */
  changeFrame_(): void;
  /** the cut set at once, a step's sweep stopped (steps.js) */
  cutNow_(cut: boolean | number): void;
  /** the steps' Back and Next said to be locked, or not (steps.js) */
  syncSteps_(): void;
  /** speak to screen readers through the figure's live region (picks and descriptions share it): a newer message
   * replaces one not yet spoken, at most one a second, and the region is emptied first so the same words are heard
   * again (dom.js, B3) */
  say_(text: string): void;
  /** the figure in words, [kind, sentence] each (describe.js) */
  sentences_(): [string, string][];
  /** after a change: what is new seen, and said when the reader made it */
  saidChange_(byReader: boolean): void;
  /** the built-in controls' hooks, told when the page changes what they show (empty with controls: false) */
  controls_: { explode?(v: number): void; motion?(id: string): void; style?(): void; lock?(): void };
  motions_: any[];
  particles_: any[];
  flows_: any[];
  streams_: any[];
  /** what a page adds that draws as parts (lines, and the live add-on's surfaces and arrows): each entry's parts drawn
   * after the scene's, placed when dirty, uploaded again on a new or restored context */
  additions_: {
    /** its parts, as the renderer draws them (pseudo-parts: no name, group or label) */
    parts: any[];
    visible: boolean;
    dirty: boolean;
    place(renderer: Renderer): void;
    reupload(renderer: Renderer): void;
    hit?(origin: number[], direction: number[]): { t: number; point: number[]; normal: number[]; id: string } | null;
    [k: string]: any;
  }[];
  /** whether the look was dark when the additions were last placed */
  dark_?: boolean;
  /** the most triangles this figure may have (mount's maxTriangles, as worked out) */
  maxTriangles_: number;
  /** what is under a point of the stage, for the page (fig.hit): a part, a surface, or a point on the page's plane */
  hit_(
    x: number,
    y: number,
    o?: { plane?: { point: number[]; normal: number[] }; surfaces?: boolean; minAlpha?: number },
  ): import('../../index').Hit | null;
  /** where a ray crosses the cut (the first plane's face, or a quarter cut's second), or null */
  cutCrossing_(origin: number[], direction: number[]): { point: number[]; plane: number[]; second: boolean } | null;
  /** a part drawn for what the page adds (lines, surfaces, arrows): no name, note or label */
  pseudoPart_(
    kind: string,
    batches: any[],
    o?: { color?: string; studioColor?: string; glow?: string | null; material?: string; tint?: number },
  ): any;
  /** the placement of a unit shape stretched from start to end, thinned to radius */
  rod_(start: number[], end: number[], radius: number): number[];
  /** what the live add-on is lent (plain names: LK3D.hostVersion's) */
  lent_: Record<string, any>;
  /** a unit shape along x from 0 to 1, of radius 1, built once: what rods and arrows are drawn with */
  unit_(kind: 'cylinder' | 'cone'): any;
  /** what destroy() runs: listeners removed, observers and timers stopped */
  cleanups_: (() => void)[];
  /** the built scene (geometry.js: buildFitting): its parts, their batches, its bounds, its detail */
  built_: {
    parts: Part[];
    radius: number;
    center: number[];
    min: number[];
    max: number[];
    quality: number;
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
  /** a part's matrix from that move alone, with the page's turn (a handle's frame, a spinning part's label) */
  baseMatrix_(p: Part): Mat;
  /** the eight corners of a part's box where its move (taken apart, shifted, turned) puts them */
  cornersOf_(p: Part): number[][];
  /** a part's whole matrix: moved, by its motions, joint, handle and spin */
  modelMatrix_(p: Part): Mat;
  /** taken apart this far at once (a tween running stops) */
  explodeNow_(v: number): void;
  tweenExplode_(to: number): void;
  setMotion_(motion: any, v: number): void;
  playMotion_(motion: any): any;
  stopMotion_(motion: any): void;

  // ---- liquids.js
  /** the scene's vessels, liquids and gases (fluids.js: fluidsOf), null without any */
  fluids_: any;
  /** each gas's height in its vessel (its piston rides on it) */
  gasHeights_: Map<string, number>;
  // (the three below are made only with fluids: called after fluids_ is checked)
  layersIn_(v: any): any[];
  openOf_(v: any): number;
  fluidStep_(dt: number): boolean;

  // ---- camera.js
  /** the camera's view-projection matrix, as last placed */
  viewProj_: Mat;
  eye_: number[];
  /** the camera's distance to what it looks at and the half-height it sees there, for the shaders */
  frustum_: { distance: number; halfHeight: number; ortho: boolean };
  /** the scene's own camera distance: zoom 1 */
  baseDist_: number;
  /** how far the view moves as the model is taken apart (the scene's view.explodeShift, scaled) */
  explodeShift_(): number[];
  /** places the camera for the state now (viewProj_, eye_, frustum_) */
  camera_(): void;
  project_(q: number[]): number[] | null;
  /** the cut's plane [nx, ny, nz, -offset] */
  cutPlane_(): number[];
  /** a quarter cut's second plane, or [0, 0, 0, 1] (everything beyond it: the first plane cuts alone) */
  cutPlane2_(): number[];
  /** how far along the cut's normal the parts it cuts reach now: where the plane can go [from, to] */
  cutRange_(second?: boolean): number[];
  /** the box round the parts drawn now */
  shownBox_(): { center: number[]; radius: number; min: number[]; max: number[] };
  boxOf_(ps: Part[]): { center: number[]; radius: number; min: number[]; max: number[] };
  /** the target and distance (as the state holds them) that frame these parts, taken apart by explode */
  frame_(ps: Part[], explode?: number): { target: number[]; dist: number };
  rayAt_(px: number, py: number): { origin: number[]; direction: number[] };
  zoom_(k: number, x?: number, y?: number): void;
  view_(name: any, o?: { ms?: number; [key: string]: any }): void;
  /** a named view's [yaw, pitch] in degrees, else the camera's now */
  viewAngles_(name: string): number[];
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
  /** measure (and shape) the stage now */
  measure_(): void;
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
  pickHit_(
    px: number,
    py: number,
    see?: number,
  ): {
    id: string | null;
    t: number;
    origin: number[];
    direction: number[];
    onCut: boolean;
    /** the triangle hit: its mesh, its index, and the matrix into its shape's frame */
    seen: { mesh: any; triangle: number; toShape: number[] | Float32Array } | null;
  };
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
  /** whether the reader may move the cut now (it is on, and the scene does not fix it) */
  cutMovable_(): boolean;
  /** the cut moved by the reader (held within the parts it cuts; onSection called) */
  moveCut_(offset: number, second?: boolean): void;

  // ---- additions.js
  addParticles_(o: any): any;
  addFlow_(o: any): any;
  addStream_(o: any): any;
  addLines_(o?: any): any;

  // ---- api.js
  api_: any;

  // ---- dimensions.js
  /** the dimensions placed on the stage, after each picture */
  placeDimensions_(): void;

  // ---- steps.js
  /** the step shown (from 0); -1 for a scene without steps */
  stepAt_: number;
  /** go to a step by its place (from 0) or id; ms: 0 sets it at once */
  goToStep_(which: number | string, o?: { ms?: number }): void;
}

declare global {
  interface Window {
    LK3D: any;
  }
}
