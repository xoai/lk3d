// The scene's types, generated from schema/scene.schema.json by scripts/types.mjs (npm run types): do not edit.
// What TypeScript cannot say (bounds, patterns, lists that may not be empty, refract only on glass) is in the
// comments, and lk3d/validate checks it.

/** one form of T: the keys K required, and the keys N (which pick out the other forms) absent */
type Form<T, K extends keyof T, N extends keyof T = never> = Omit<T, K | N> &
  Required<Pick<T, K>> & { [P in N]?: never };

/**
 * A 3D figure as data: parts made of shapes, each with a name and a note, that the reader turns, takes apart,
 * cuts open and moves. Every field is one of the format's, so a misspelt one is caught; a page's own data goes
 * under extras.
 */
export interface Scene {
  /**
   * The version of this format the scene is written in (1). Optional; a later engine that changes the format
   * reads older versions.
   */
  lk3d?: 1;
  /**
   * The stage's width in proportion to h (16 by default).
   * @exclusiveMinimum 0
   */
  w?: number;
  /**
   * The stage's height in proportion to w (10 by default).
   * @exclusiveMinimum 0
   */
  h?: number;
  /** The stage's proportions on a narrow screen, e.g. "1 / 0.9". */
  narrow?: string;
  /** What the figure shows; also the canvas's label when alt is not given. */
  title?: string;
  /** Who made the figure: credited under it (© author), and written into an exported .glb. */
  author?: string;
  /**
   * The terms the figure is under ("CC BY-NC-ND 4.0", "all rights reserved"): credited under it, after its
   * author, and written into an exported .glb.
   */
  license?: string;
  /**
   * Where the figure comes from: a web address (http or https), which the author's name in the credit links to.
   * @pattern ^https?://
   */
  url?: string;
  /** A description of the model for screen readers. */
  alt?: string;
  /** The first look: pen (near-white, thin lines; the default), studio (realistic) or ink (drawn). */
  style?: Look;
  /**
   * The colours of the page behind the model, its lines and words (auto: light or dark, as the reader's system
   * is set). None: each look's own.
   */
  theme?: SceneTheme;
  /** The studio look's environment. */
  env?: 'studio' | 'warm' | 'night';
  /** The first camera. */
  view?: {
    /** Degrees round the vertical. */
    yaw?: number;
    /** Degrees up. */
    pitch?: number;
    /**
     * Distance from the target (default: to fit).
     * @exclusiveMinimum 0
     */
    dist?: number;
    /** The point looked at (default: the middle). */
    target?: Vec3;
    /**
     * Field of view, degrees (35).
     * @exclusiveMinimum 0
     * @maximum 120
     */
    fov?: number;
    /**
     * How close the reader may zoom, as a share of the distance that fits the whole model (0.02: 50 times closer).
     * @exclusiveMinimum 0
     */
    minZoom?: number;
    /** perspective (the default) or ortho: parallel lines stay parallel, as in a technical illustration. */
    projection?: 'perspective' | 'ortho';
    /** How far the camera steps back when the model is taken apart (0.5). */
    explodeZoom?: number;
    /** Where the view moves when the model is taken apart. */
    explodeShift?: Vec3;
  };
  /**
   * Lines where a part's faces meet at an angle: drawn in the pen look unless false; true draws them in every
   * look.
   */
  edges?: boolean;
  /**
   * What the geometry check (lk3d check, lk3d/lint) is to excuse, by name: what the scene means on purpose.
   */
  check?: {
    /**
     * Pairs of part ids that may run into each other when taken apart or as a motion moves, or hide each other's
     * label (two pictures of one molecule, shown in turn).
     */
    allow?: [string, string][];
    /**
     * Parts (ids or groups) that hang in the air on purpose, or true: all of them (planets, molecules side by
     * side).
     */
    float?: boolean | string[];
  };
  /** A shadow under the model (true by default). */
  ground?: boolean;
  /**
   * The cut: a plane, or false to offer none. What lies on the side its normal points to, beyond offset along
   * it, is cut away; while the model is cut open the reader moves the plane along its normal (dragging the cut
   * face, or the slider) unless it is fixed, and a page may move it (set({ section }))
   */
  section?:
    | false
    | {
        normal?: Vec3;
        offset?: number;
        /**
         * true: the reader cannot move the cut (by dragging its face or its slider); the page still can. By default,
         * while the model is cut open, the reader moves the plane along its normal.
         */
        fixed?: boolean;
      };
  /**
   * Parts that move together as one value goes along a range: a piston's stroke as the crank turns, a sleeve
   * sliding back, a valve opening. Set or played by the page (fig.motion(id)) and, when named, by the reader (a
   * slider and a play button); run through its range by the geometry check.
   */
  motions?: Motion[];
  /**
   * Parts posed by how they are joined, not by keys for each: a crank driven by a motion, a piston held by its
   * rod, a rod aimed at the crank pin, a cam that follows at half speed. A joint's value comes from a motion,
   * another joint, a rod, an aim, or the page (set({ joints })).
   */
  joints?: Joint[];
  /**
   * Honest scale: a bar that keeps its true length as the view zooms, and/or a note saying what is not to scale.
   */
  scale?: SceneScale;
  /** glTF 2.0 models (.glb) by name, for {model: name} shapes. */
  models?: { [key: string]: Model };
  /** What one scene unit is (m): the laws of liquids and gases (g, R) are worked out in it. */
  unit?: 'mm' | 'cm' | 'dm' | 'm' | 'km';
  /**
   * Parts that hold liquids or a gas: the radius of their inside at each height, and an outlet they pour
   * through.
   */
  vessels?: Vessel[];
  /**
   * Liquids in vessels, drawn by lk3d as bodies that fill their vessel to the level their volume gives; liquids
   * in one vessel stack by density; an open outlet pours by Torricelli's law into the liquid below.
   */
  liquids?: Liquid[];
  /**
   * Gases under a piston: the piston rests where pV = nRT puts it (n moles at T kelvin under p pascals and the
   * piston's weight).
   */
  gases?: Gas[];
  /** The page's own data about the figure (as glTF's extras): lk3d keeps it and does not read it. */
  extras?: { [key: string]: unknown };
  /** The parts of the model, each a list of shapes with a name and a note. */
  parts: Part[];
  /**
   * Guided steps: the figure explained in order, each with its words and a state of the figure (where the camera
   * looks, taken apart, cut open, labels, a part chosen, motions). The figure starts at the first; the reader
   * goes through them with Back and Next under it, the page with fig.step().
   */
  steps?: Step[];
}

/** The first look: pen (near-white, thin lines; the default), studio (realistic) or ink (drawn). */
export type Look = 'ink' | 'studio' | 'pen';

/**
 * The colours of the page behind the model, its lines and words (auto: light or dark, as the reader's system
 * is set). None: each look's own.
 */
export type SceneTheme = 'light' | 'dark' | 'blueprint' | 'sepia' | 'auto';

/** three numbers [x, y, z] */
export type Vec3 = [number, number, number];

export interface Motion {
  /** Unique among the scene's motions: what the page names it by. */
  id: string;
  /** What the reader's slider says (no name: no slider, the page drives it). */
  name?: string;
  /** From and to: degrees of a crank, a fraction from 0 to 1, a time: whatever the keys are written in. */
  range: [number, number];
  /** Where it starts (the start of its range). */
  value?: number;
  /** Played on round and round (a crank), else to its end and back. */
  loop?: boolean;
  /**
   * How far along its range it goes in a second when played (the whole range).
   * @exclusiveMinimum 0
   */
  speed?: number;
  /** Parts it moves by keys (none when it only drives joints). */
  tracks?: MotionTrack[];
}

/** a joint turns its parts (turn) or slides them (slide) */
export type Joint =
  Form<JointFields, 'turn', Exclude<JointKind, 'turn'>> | Form<JointFields, 'slide', Exclude<JointKind, 'slide'>>;

/** the kinds of Joint: exactly one of these keys picks its form */
export type JointKind = 'turn' | 'slide';

/** the fields of Joint, each optional (Joint says which are required, together) */
export interface JointFields {
  /** Unique among the scene's joints: what the page and other joints name it by. */
  id: string;
  /** Part ids or groups it moves (a part on one joint only). */
  parts: string[];
  /** A joint whose movement its parts share first (a rod rides on its piston). */
  parent?: string;
  /** It turns its parts: degrees about axis through center. */
  turn?: {
    axis: Vec3;
    center?: Vec3;
  };
  /** It slides its parts: scene units along axis. */
  slide?: {
    axis: Vec3;
  };
  /** Its value when nothing drives it (0: as the parts are drawn). */
  value?: number;
  /** Its value from a motion: the motion's own value (its id), or scaled or read off keys. */
  drive?:
    | string
    | {
        /** Its value is the other's times ratio (1), plus offset. */
        ratio?: number;
        /** Added to the scaled value (0). */
        offset?: number;
        /**
         * Keys [the other's value, this joint's value], in order: a cam's lift, a gear train that isn't a ratio.
         */
        keys?: [number, number][];
        /** The motion's id. */
        motion: string;
      };
  /** Its value from another joint's: a gear (ratio), a cam's follower (keys). */
  follow?: {
    /** Its value is the other's times ratio (1), plus offset. */
    ratio?: number;
    /** Added to the scaled value (0). */
    offset?: number;
    /**
     * Keys [the other's value, this joint's value], in order: a cam's lift, a gear train that isn't a ratio.
     */
    keys?: [number, number][];
    /** The joint it follows. */
    joint: string;
  };
  /**
   * A slide held by a rod of fixed length (a piston): from at, a point carried by joint, to pin, a point of its
   * own parts; the rod is as long as they are apart at rest.
   */
  rod?: {
    joint: string;
    at: Vec3;
    pin: Vec3;
  };
  /**
   * A turn that keeps its parts pointing at at, a point carried by joint (a connecting rod, on its piston, aimed
   * at the crank pin).
   */
  aim?: {
    joint: string;
    at: Vec3;
  };
}

/**
 * Honest scale: a bar that keeps its true length as the view zooms, and/or a note saying what is not to scale.
 */
export type SceneScale = Form<SceneScaleFields, 'bar'> | Form<SceneScaleFields, 'note'>;

/** the fields of SceneScale, each optional (SceneScale says which are required, together) */
export interface SceneScaleFields {
  /** a scale bar needs its length (scene units) and label ("5 cm") */
  bar?: {
    /** @exclusiveMinimum 0 */
    length: number;
    /** @minLength 1 */
    label: string;
  };
  /** @minLength 1 */
  note?: string;
}

/** a model needs its .glb: data (base64) or file (a path) */
export type Model = Form<ModelFields, 'data'> | Form<ModelFields, 'file'>;

/** the fields of Model, each optional (Model says which are required, together) */
export interface ModelFields {
  /** The .glb as base64 (a build tool may fill it in from a file). */
  data?: string;
  /**
   * The path to the .glb, read into data before the scene is drawn (lk3d check and render, a build tool); the
   * engine itself reads only data.
   * @minLength 1
   */
  file?: string;
  /** Its name in the credit line. */
  title?: string;
  /** Who made it (credited under the figure). */
  author?: string;
  /** Its licence (credited under the figure). */
  license?: string;
  /**
   * Where it comes from: a web address (http or https), which the credit links to.
   * @pattern ^https?://
   */
  url?: string;
  /**
   * Where it comes from: a scan of a real specimen, a scientific dataset, an artist's model, or made by AI (then
   * called an illustration under the figure).
   */
  source?: 'scan' | 'dataset' | 'artist' | 'ai';
}

export interface Vessel {
  /** Its name: what liquids, gases and the page (fig.vessel(id)) call it by. */
  id: string;
  /** The part that is the vessel (its glass). */
  part: string;
  /** Where height 0 is, on the vessel's upright axis ([0, 0, 0]). */
  at?: Vec3;
  /** Its inside, bottom to brim: [height, radius] (an outlet's stem included, so it fills as it pours). */
  inside: [number, number][];
  /** Where it pours from: a bore at its bottom, the stream leaving at tip. */
  outlet?: {
    /**
     * The bore's radius.
     * @exclusiveMinimum 0
     */
    radius: number;
    /** Where the stream leaves (in the scene). */
    tip: Vec3;
    /** Which way it leaves ([0, -1, 0]: down; sideways for a hole in a tank's side). */
    dir?: Vec3;
    /**
     * The motion that opens it (its range: shut to open); else the page opens it (fig.vessel(id).set({open})).
     */
    valve?: string;
    /**
     * How much of the bore the stream fills (0.6, a sharp-edged hole).
     * @exclusiveMinimum 0
     * @maximum 1
     */
    cd?: number;
  };
}

export interface Liquid {
  /** The part drawn as this liquid (its name, note, colour; lk3d makes its shape). */
  part: string;
  /** The vessel it is in. */
  in: string;
  /**
   * How much (scene units cubed: cm³ in a scene in cm).
   * @minimum 0
   */
  volume?: number;
  /**
   * Its density (1): liquids in one vessel stack, the densest at the bottom.
   * @exclusiveMinimum 0
   */
  density?: number;
  /** The liquid (in a vessel below) it becomes when its vessel pours. */
  into?: string;
}

export interface Gas {
  /** The part drawn as this gas. */
  part: string;
  /** Its vessel, upright (a cylinder). */
  in: string;
  /** The part that rests on it (set on the gas wherever the scene drew it). */
  piston?: string;
  /**
   * Moles of gas.
   * @exclusiveMinimum 0
   */
  n: number;
  /**
   * Temperature, kelvin.
   * @exclusiveMinimum 0
   */
  T: number;
  /**
   * Pressure outside, pascals (101325).
   * @exclusiveMinimum 0
   */
  p?: number;
  /**
   * The piston's mass, kilograms (0): its weight adds to the pressure.
   * @minimum 0
   */
  mass?: number;
}

export interface Part {
  /**
   * Unique in the scene.
   * @minLength 1
   */
  id: string;
  /** Its label. */
  name?: string;
  /** Shown when the part is pointed at (may hold simple HTML). */
  note?: string;
  /** Parts of one group move, hide and are framed together (set({hide}), focus, a handle's moves). */
  group?: string;
  /**
   * How it reflects light in the studio look (and how much light wraps round into it, for soft materials).
   */
  material?: Material;
  /** Its colour in the drawn look. */
  color?: Color;
  /** Its colour in the studio look (default: color). */
  studioColor?: Color;
  /** The colour it glows when the page lights it (set({glow})). */
  glow?: Color;
  /** false: the part stays whole when the model is cut open (a stand, a frame, a base). */
  cut?: false;
  /**
   * Whether its edges are drawn (by default yes, except on soft shapes: models, blobs, trees, terrain, scatter,
   * molecules, DNA).
   */
  edges?: boolean;
  /**
   * Keeps its full colour in the pen look, where other parts get a soft wash of theirs (40 %; vertex colours
   * keep 70 %).
   */
  accent?: boolean;
  /**
   * Always see-through: 1 is solid (glass about 0.35; a part made only of a model's glass,
   * KHR_materials_transmission, is 0.35 and glass unless it says otherwise).
   * @minimum 0
   * @maximum 1
   */
  opacity?: number;
  /** Becomes see-through with the "See through" control. */
  xray?: boolean;
  /** Not drawn at first (set({hide}) changes it). */
  hidden?: boolean;
  /** Where it moves to when the model is taken apart. */
  explode?: Vec3;
  /** Moves the whole part. */
  at?: Vec3;
  /** Turns the whole part (degrees about x, y, z). */
  rot?: Vec3;
  /** Stretches the whole part. */
  scale?: Vec3;
  /** Where its leader line points, or false for no label. */
  label?: false | Vec3;
  /** Turns with the figure's spin angle, set({spin}): about an axis through center, ratio times as fast. */
  spin?: {
    axis?: 'x' | 'y' | 'z';
    ratio?: number;
    center?: Vec3;
  };
  /** The reader moves this part with the pointer or the keys. */
  handle?: Handle;
  /** Fine surface detail in the studio look (WebGL 2): kind, bumps per unit, strength (0.3 to 1). */
  surface?: {
    kind: 'brushed' | 'knurl' | 'ribs' | 'grain' | 'skin' | 'cast';
    /** @exclusiveMinimum 0 */
    scale?: number;
    /** @exclusiveMinimum 0 */
    strength?: number;
  };
  /**
   * Glass that bends what is behind it (studio look, WebGL 2): 1 for a lens.
   * @exclusiveMinimum 0
   * @maximum 2
   * @remarks refract is for a glass part (material: glass)
   */
  refract?: number;
  /**
   * What the part is made of: one or more shapes. (none for a liquid's or a gas's part: lk3d makes its body)
   */
  shapes?: Shape[];
  /** The page's own data about this part (as glTF's extras): lk3d keeps it and does not read it. */
  extras?: { [key: string]: unknown };
}

/**
 * A step of the figure's explanation: its words, and the figure's state while it is shown. What a step does
 * not say goes back to the figure's start (put together, not cut, see-through off, labels as usual, nothing
 * hidden or chosen, the motions at their start), so a step is the same picture however the reader came to it;
 * only the camera stays where the reader left it unless the step says where (view, focus).
 */
export type Step = Form<StepFields, 'title'> | Form<StepFields, 'text'>;

/** the fields of Step, each optional (Step says which are required, together) */
export interface StepFields {
  /**
   * Unique among the steps: what the page names it by (fig.step(id)).
   * @minLength 1
   */
  id?: string;
  /**
   * The step's heading, a few words.
   * @minLength 1
   */
  title?: string;
  /**
   * What the reader is to look at, and why: a sentence or two, with simple formatting (b i em strong sub sup br)
   * as in a part's note.
   * @minLength 1
   */
  text?: string;
  /**
   * Where the camera goes: a named view (home: the figure's first), or yaw and pitch (degrees), zoom (2: twice
   * as close as the whole model) or dist, and target. Without view or focus the camera stays where it is.
   */
  view?:
    | 'front'
    | 'side'
    | 'top'
    | 'iso'
    | 'home'
    | {
        yaw?: number;
        pitch?: number;
        /** @exclusiveMinimum 0 */
        zoom?: number;
        /** @exclusiveMinimum 0 */
        dist?: number;
        target?: Vec3;
      };
  /**
   * Parts or groups to frame: the camera looks at their middle (as they are once the step has taken them apart)
   * from far enough to see them all, from the view's angles if it gives them.
   */
  focus?: string[];
  /**
   * How far apart (0, the default: put together; 1: all the way).
   * @minimum 0
   * @maximum 1
   */
  explode?: number;
  /** Cut open (true), or how far the plane has swept in (0 to 1); swept in as the step comes. */
  cut?: boolean | number;
  /** The cut's plane for this step (the scene's section by default). */
  section?: {
    normal?: Vec3;
    offset?: number;
  };
  /** Casings see-through. */
  xray?: boolean;
  /**
   * Which labels show: auto (the part pointed at or chosen, and all of them once the model is well apart; the
   * default), all, none, or a list of parts and groups.
   */
  labels?: 'auto' | 'all' | 'none' | string[];
  /** Parts or groups out of sight in this step. */
  hide?: string[];
  /**
   * A part chosen, as if the reader had picked it: lit, with its name and note in the info box.
   * @minLength 1
   */
  select?: string;
  /** Motions' values by id (the others at their start). */
  motion?: { [key: string]: number };
  /** Motions played as the step comes, from the value it gives them. */
  play?: string[];
}

/** Parts that move one way: moved, turned, or both (moved, then turned). */
export type MotionTrack = Form<MotionTrackFields, 'move'> | Form<MotionTrackFields, 'turn'>;

/** the fields of MotionTrack, each optional (MotionTrack says which are required, together) */
export interface MotionTrackFields {
  /** Part ids or groups. */
  parts: string[];
  /** Keys [t, [x, y, z]]: at the motion's value t, moved by [x, y, z]. */
  move?: [number, Vec3][];
  /** Turned about an axis through center: keys [t, degrees]. */
  turn?: {
    axis: Vec3;
    center?: Vec3;
    keys: [number, number][];
  };
  /** A smooth start and stop at each key (else straight from key to key). */
  ease?: boolean;
}

/**
 * How it reflects light in the studio look (and how much light wraps round into it, for soft materials).
 */
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

/**
 * a colour "#rrggbb"
 * @pattern ^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$
 */
export type Color = string;

/** The reader moves the part with the pointer or the keys, held to one rule. */
export type Handle =
  | Form<HandleFields, 'turn', Exclude<HandleKind, 'turn'>>
  | Form<HandleFields, 'slide' | 'min' | 'max', Exclude<HandleKind, 'slide'>>
  | Form<HandleFields, 'along', Exclude<HandleKind, 'along'>>;

/** the kinds of Handle: exactly one of these keys picks its form */
export type HandleKind = 'turn' | 'slide' | 'along';

/** the fields of Handle, each optional (Handle says which are required, together) */
export interface HandleFields {
  /** Degrees about an axis through center; without min and max it goes round and round. */
  turn?: {
    axis: Vec3;
    center?: Vec3;
  };
  /** A distance along an axis from where the part is drawn. */
  slide?: {
    axis: Vec3;
  };
  /** A place on a path, 0 at its start to 1 at its end. */
  along?: {
    /** an along handle needs a path of at least two points */
    path: Vec3[];
    closed?: boolean;
  };
  /** The least value (degrees, distance or place). */
  min?: number;
  /** The greatest value. */
  max?: number;
  /**
   * Values move in these steps.
   * @exclusiveMinimum 0
   */
  snap?: number;
  /** Where the part is drawn (default 0, or min). */
  value?: number;
  /** What a screen reader calls it. */
  label?: string;
  /** A unit read out after the value. */
  unit?: string;
  /** Other parts or groups carried with it. */
  moves?: string[];
}

/**
 * a shape is exactly one of: lathe, cylinder, box, sphere, torus, tube, helix, loop, ellipsoid, capsule, blob,
 * shell, tree, molecule, dna, extrude, terrain, ring, orbit, blade, scatter, model
 */
export type Shape =
  | Form<ShapeFields, 'lathe', Exclude<ShapeKind, 'lathe'>>
  | Form<ShapeFields, 'cylinder', Exclude<ShapeKind, 'cylinder'>>
  | Form<ShapeFields, 'box', Exclude<ShapeKind, 'box'>>
  | Form<ShapeFields, 'sphere', Exclude<ShapeKind, 'sphere'>>
  | Form<ShapeFields, 'torus', Exclude<ShapeKind, 'torus'>>
  | Form<ShapeFields, 'tube', Exclude<ShapeKind, 'tube'>>
  | Form<ShapeFields, 'helix', Exclude<ShapeKind, 'helix'>>
  | Form<ShapeFields, 'loop', Exclude<ShapeKind, 'loop'>>
  | Form<ShapeFields, 'ellipsoid', Exclude<ShapeKind, 'ellipsoid'>>
  | Form<ShapeFields, 'capsule', Exclude<ShapeKind, 'capsule'>>
  | Form<ShapeFields, 'blob', Exclude<ShapeKind, 'blob'>>
  | Form<ShapeFields, 'shell', Exclude<ShapeKind, 'shell'>>
  | Form<ShapeFields, 'tree', Exclude<ShapeKind, 'tree'>>
  | Form<ShapeFields, 'molecule', Exclude<ShapeKind, 'molecule'>>
  | Form<ShapeFields, 'dna', Exclude<ShapeKind, 'dna'>>
  | Form<ShapeFields, 'extrude', Exclude<ShapeKind, 'extrude'>>
  | Form<ShapeFields, 'terrain', Exclude<ShapeKind, 'terrain'>>
  | Form<ShapeFields, 'ring', Exclude<ShapeKind, 'ring'>>
  | Form<ShapeFields, 'orbit', Exclude<ShapeKind, 'orbit'>>
  | Form<ShapeFields, 'blade', Exclude<ShapeKind, 'blade'>>
  | Form<ShapeFields, 'scatter', Exclude<ShapeKind, 'scatter'>>
  | Form<ShapeFields, 'model', Exclude<ShapeKind, 'model'>>;

/** the kinds of Shape: exactly one of these keys picks its form */
export type ShapeKind =
  | 'lathe'
  | 'cylinder'
  | 'box'
  | 'sphere'
  | 'torus'
  | 'tube'
  | 'helix'
  | 'loop'
  | 'ellipsoid'
  | 'capsule'
  | 'blob'
  | 'shell'
  | 'tree'
  | 'molecule'
  | 'dna'
  | 'extrude'
  | 'terrain'
  | 'ring'
  | 'orbit'
  | 'blade'
  | 'scatter'
  | 'model';

/** the fields of Shape, each optional (Shape says which are required, together) */
export interface ShapeFields {
  /** A body of revolution around the x axis: a profile of [position along x, radius] points. */
  lathe?: [number, number][];
  /** A cylinder along x from x0 to x1; ri makes it hollow, r1 a cone. */
  cylinder?: {
    /**
     * Its radius (at x0, for a cone).
     * @exclusiveMinimum 0
     */
    r: number;
    /**
     * The radius of the hole along its axis (0: solid).
     * @minimum 0
     */
    ri?: number;
    /**
     * Its radius at x1 (default: r).
     * @minimum 0
     */
    r1?: number;
    /** Where it starts along x (-0.5). */
    x0?: number;
    /** Where it ends along x (0.5). */
    x1?: number;
  };
  /** A box [sx, sy, sz], centred. */
  box?: Vec3;
  /**
   * A sphere of this radius (seg: 32 by default).
   * @exclusiveMinimum 0
   */
  sphere?: number;
  /** A ring [R, r] around the x axis. */
  torus?: [number, number];
  /** A round wire along a path of [x, y, z] points (r: its radius; closed: a loop). */
  tube?: Vec3[];
  /** A coil along x: {r, x0, x1, turns, wire}. */
  helix?: {
    /**
     * The coil's radius.
     * @exclusiveMinimum 0
     */
    r: number;
    /** Where it starts along x (-0.5). */
    x0?: number;
    /** Where it ends along x (0.5). */
    x1?: number;
    /**
     * How many times it winds round (8).
     * @exclusiveMinimum 0
     * @maximum 1000
     */
    turns?: number;
    /**
     * The wire's radius (0.02).
     * @exclusiveMinimum 0
     */
    wire?: number;
  };
  /** A rounded rectangular winding: {a, b, R, wire, corner, turns, gap}. */
  loop?: {
    /**
     * Its length along x (0.8).
     * @exclusiveMinimum 0
     */
    a?: number;
    /**
     * Its width along z (0.12).
     * @exclusiveMinimum 0
     */
    b?: number;
    /** The height y it lies at, in the x-z plane (0.4). */
    R?: number;
    /**
     * The wire's radius (0.02).
     * @exclusiveMinimum 0
     */
    wire?: number;
    /**
     * The radius of its rounded corners (0.03).
     * @minimum 0
     */
    corner?: number;
    /**
     * How many turns, stacked one above the other (1).
     * @minimum 1
     * @maximum 1000
     * @integer
     */
    turns?: number;
    /**
     * The distance in y from one turn to the next (0).
     * @minimum 0
     */
    gap?: number;
  };
  /** An egg shape with semi-axes [a, b, c]. */
  ellipsoid?: Vec3;
  /** A rod with round ends along x: {r, x0, x1}. */
  capsule?: {
    /**
     * Its radius.
     * @exclusiveMinimum 0
     */
    r: number;
    /** Where its straight part starts along x (-0.5); the round end reaches r beyond. */
    x0?: number;
    /** Where its straight part ends along x (0.5). */
    x1?: number;
  };
  /** An irregular round body: {r, amp, freq, seed, stretch}. */
  blob?: {
    /**
     * Its mean radius (0.5).
     * @exclusiveMinimum 0
     */
    r?: number;
    /**
     * How far the radius varies, as a share of r (0.15).
     * @minimum 0
     * @maximum 1
     */
    amp?: number;
    /**
     * How close together the bumps are (1.6).
     * @exclusiveMinimum 0
     */
    freq?: number;
    /**
     * Picks the bumps (1).
     * @integer
     */
    seed?: number;
    /** Stretched along x, y and z ([1, 1, 1]). */
    stretch?: Vec3;
  };
  /** A sphere, hollow inside ri, with the wedge outside from..to (degrees) cut away: {r, ri, from, to}. */
  shell?: {
    /**
     * Its outer radius.
     * @exclusiveMinimum 0
     */
    r: number;
    /**
     * Its inner radius (0: a solid ball).
     * @minimum 0
     */
    ri?: number;
    /** The angle about x where it starts, degrees (0). */
    from?: number;
    /** The angle about x where it ends, degrees (360). */
    to?: number;
  };
  /**
   * Branching, tapering tubes: {at, dir, length, r, levels, branches, spread, shrink, taper, bend, seed}.
   */
  tree?: {
    /** Where the trunk starts ([0, 0, 0]). */
    at?: Vec3;
    /** The way the trunk grows ([1, 0, 0]). */
    dir?: Vec3;
    /**
     * The trunk's length (1).
     * @exclusiveMinimum 0
     */
    length?: number;
    /**
     * The trunk's radius at its base (0.04).
     * @exclusiveMinimum 0
     */
    r?: number;
    /**
     * Levels of branches, the trunk the first (3).
     * @minimum 1
     * @maximum 8
     * @integer
     */
    levels?: number;
    /**
     * Branches from each branch (2).
     * @minimum 0
     * @maximum 8
     * @integer
     */
    branches?: number;
    /** How far a branch turns from its parent, degrees (35). */
    spread?: number;
    /**
     * A branch's length as a share of its parent's (0.65).
     * @exclusiveMinimum 0
     */
    shrink?: number;
    /**
     * A branch's radius at its end as a share of its start (0.6).
     * @minimum 0
     */
    taper?: number;
    /**
     * How much the branches wander (0.12).
     * @minimum 0
     */
    bend?: number;
    /**
     * Picks the branching (1).
     * @integer
     */
    seed?: number;
  };
  /** Atoms (CPK colours) and bonds: {atoms: [{el, at}], bonds: [[i, j, order]], scale, style}. */
  molecule?: {
    /** The atoms, each an element at a place. */
    atoms: Array<{
      /**
       * Its element's symbol: H, C, O, Na…
       * @pattern ^[A-Z][a-z]?$
       */
      el: string;
      /** Where it is, in ångström. */
      at: Vec3;
      /**
       * Its radius in ångström (default: the element's).
       * @exclusiveMinimum 0
       */
      r?: number;
      /** Its colour (default: the element's). */
      color?: Color;
    }>;
    /** Bonds between two atoms, by their place in atoms (from 0), single unless an order is given. */
    bonds?: [number, number, number?][];
    /**
     * Scene units per ångström (1).
     * @exclusiveMinimum 0
     */
    scale?: number;
    /** ball (ball-and-stick, the default) or space (space-filling, without bonds). */
    style?: 'ball' | 'space';
    /**
     * A bond's radius in ångström (0.09).
     * @exclusiveMinimum 0
     */
    bond?: number;
  };
  /** A double helix with base pairs: {pairs, seq, scale}. */
  dna?: {
    /**
     * How many base pairs (12).
     * @minimum 2
     * @maximum 2000
     * @integer
     */
    pairs?: number;
    /**
     * One strand's bases, A T G C, repeated as needed.
     * @pattern ^[ATGCatgc]+$
     */
    seq?: string;
    /**
     * The helix's radius (1 nm).
     * @exclusiveMinimum 0
     */
    r?: number;
    /**
     * The distance from one base pair to the next along x (0.34 nm).
     * @exclusiveMinimum 0
     */
    rise?: number;
    /** Degrees the helix turns from one base pair to the next (34.3: 10.5 pairs a turn). */
    twist?: number;
    /** Degrees between the two backbones around the axis (150). */
    groove?: number;
    /**
     * A backbone's radius (0.11 nm).
     * @exclusiveMinimum 0
     */
    wire?: number;
    /**
     * Scene units per nanometre (1).
     * @exclusiveMinimum 0
     */
    scale?: number;
  };
  /** A flat outline made solid: {outline, depth}. */
  extrude?: {
    /** The outline's [x, y] points, in order (a simple polygon, concave or not). */
    outline: [number, number][];
    /**
     * Its thickness along z, centred (0.2).
     * @exclusiveMinimum 0
     */
    depth?: number;
  };
  /** A block of ground with rock layers: {size, res, base, height, layers, top, tilt}. */
  terrain?: {
    /** Its size along x and z ([2, 2]). */
    size?: [number, number];
    /**
     * Grid steps along each side of the top (24).
     * @minimum 2
     * @maximum 512
     * @integer
     */
    res?: number;
    /**
     * The height of its top above its bottom (y = 0), before the hills (0.6).
     * @exclusiveMinimum 0
     */
    base?: number;
    /** The landscape on top. */
    height?: {
      /**
       * How far the hills rise and the valleys fall (0.12).
       * @minimum 0
       */
      amp?: number;
      /**
       * How close together the hills are (1.5).
       * @exclusiveMinimum 0
       */
      freq?: number;
      /**
       * Picks the hills (3).
       * @integer
       */
      seed?: number;
    };
    /** Rock layers, the top one first; the last reaches down to the bottom. */
    layers?: Array<{
      /**
       * Its thickness.
       * @exclusiveMinimum 0
       */
      thick: number;
      /** Its colour. */
      color?: Color;
    }>;
    /** The colour of the landscape (#7a9a55). */
    top?: Color;
    /** Dips the layers along x, degrees (0). */
    tilt?: number;
  };
  /** A flat ring: {r, ri, thickness}. */
  ring?: {
    /**
     * Its outer radius.
     * @exclusiveMinimum 0
     */
    r: number;
    /**
     * Its inner radius (0: a disc).
     * @minimum 0
     */
    ri?: number;
    /**
     * Its thickness along x (0.01).
     * @exclusiveMinimum 0
     */
    thickness?: number;
  };
  /** An ellipse with the Sun at a focus: {a, e, wire}. */
  orbit?: {
    /**
     * The semi-major axis.
     * @exclusiveMinimum 0
     */
    a: number;
    /**
     * The eccentricity: 0 for a circle, less than 1 for an ellipse (0).
     * @minimum 0
     * @maximum 0.999
     */
    e?: number;
    /**
     * The line's radius (0.01).
     * @exclusiveMinimum 0
     */
    wire?: number;
  };
  /** A twisted airfoil blade along y: {root, span, chord, tip, twist, thickness, camber, sweep}. */
  blade?: {
    /**
     * How far from the x axis it starts (0.2).
     * @minimum 0
     */
    root?: number;
    /**
     * Its length along y (0.5).
     * @exclusiveMinimum 0
     */
    span?: number;
    /**
     * Its width at the root (0.15).
     * @exclusiveMinimum 0
     */
    chord?: number;
    /**
     * Its width at the tip (default: chord).
     * @exclusiveMinimum 0
     */
    tip?: number;
    /** Degrees its section is turned at the root, less towards the tip, 0 there (35). */
    twist?: number;
    /**
     * The section's greatest thickness, as a share of the chord (0.1).
     * @exclusiveMinimum 0
     * @maximum 0.5
     */
    thickness?: number;
    /**
     * How much the section curves, as a share of the chord (0.04; 0: symmetric).
     * @minimum -0.25
     * @maximum 0.25
     */
    camber?: number;
    /** How far the tip lies along x from the root, as a share of the span (0). */
    sweep?: number;
  };
  /** Copies of a shape at random places: {shape, n, within, avoid, size, seed}. */
  scatter?: {
    /** The shape copied. */
    shape: Shape;
    /**
     * How many copies (50).
     * @minimum 1
     * @maximum 10000
     * @integer
     */
    n?: number;
    /** Where the copies go, around the shape's place: inside a sphere, a shell or a box ({sphere: 1}). */
    within?: ScatterWithin;
    /** Balls where no copy goes, [{sphere: r, at}] (a nucleus inside a cell). */
    avoid?: Array<{
      /** @exclusiveMinimum 0 */
      sphere: number;
      at?: Vec3;
    }>;
    /** The least and the greatest scale of a copy ([1, 1]). */
    size?: [number, number];
    /**
     * Picks the places, turns and sizes (1).
     * @integer
     */
    seed?: number;
    /**
     * Each copy's detail as a share of the shape's own (0.5).
     * @exclusiveMinimum 0
     * @maximum 8
     */
    detail?: number;
  };
  /** A model listed under the scene's models (node: one node of it). */
  model?: string;
  /** Where the shape is, in the part. */
  at?: Vec3;
  /** Turned (degrees about x, y, z). */
  rot?: Vec3;
  /** Stretched: [x, y, z], or one number for all three. */
  scale?: Vec3 | number;
  /**
   * Its own colour (vertex colours), over the part's; on a textured model, in place of its base colour map (its
   * relief kept).
   */
  color?: Color;
  /**
   * More or less detail than the figure's quality: 0.5 for a shape repeated hundreds of times, 2 for a close-up.
   * @exclusiveMinimum 0
   * @maximum 8
   */
  detail?: number;
  /** Copies around an axis (x unless axis says): n of them, step degrees apart (360 / n) from start (0). */
  repeat?:
    | number
    | {
        /**
         * @minimum 1
         * @maximum 1000
         * @integer
         */
        n: number;
        step?: number;
        start?: number;
        axis?: 'x' | 'y' | 'z';
      };
  /** With model: one node of the model (and what is under it). */
  node?: string;
  /** lathe: a closed outline (a ring; a sector's is closed unless false); tube: a loop. */
  closed?: boolean;
  /** lathe: flipped along x. */
  mirror?: boolean;
  /**
   * lathe: normals blended across the profile's corners, for a curved surface (by default its edges stay crisp).
   */
  smooth?: boolean;
  /** lathe: the angle about x where a sector starts, degrees (0). */
  from?: number;
  /** lathe: the angle about x where a sector ends, degrees (360); its two sides are closed flat. */
  to?: number;
  /**
   * lathe, cylinder, sphere: segments around (lathe and cylinder 48, sphere 32; 8 for a tiny bead).
   * @minimum 3
   * @maximum 512
   * @integer
   */
  seg?: number;
  /**
   * tube: its radius (0.02).
   * @exclusiveMinimum 0
   */
  r?: number;
}

/** Where the copies go, around the shape's place: inside a sphere, a shell or a box ({sphere: 1}). */
export type ScatterWithin =
  | Form<ScatterWithinFields, 'sphere', Exclude<ScatterWithinKind, 'sphere'>>
  | Form<ScatterWithinFields, 'shell', Exclude<ScatterWithinKind, 'shell'>>
  | Form<ScatterWithinFields, 'box', Exclude<ScatterWithinKind, 'box'>>;

/** the kinds of ScatterWithin: exactly one of these keys picks its form */
export type ScatterWithinKind = 'sphere' | 'shell' | 'box';

/** the fields of ScatterWithin, each optional (ScatterWithin says which are required, together) */
export interface ScatterWithinFields {
  /** @exclusiveMinimum 0 */
  sphere?: number;
  shell?: [number, number];
  box?: Vec3;
}
