// @ts-check
// The looks (ink, studio, pen), the colour themes and the sun, and a figure's look in use: resolved again when its
// style, theme or transparency changes, with the stage's background and --lk3d-* variables. Owns look_, lookKey_ and
// lookNow_; reads state_, spec_, stage_ and LK3D.themes, and calls kick_ (the reader's dark mode changed).
import { norm, rgb } from '../math.js';
import LK3D from '../namespace.js';

// the sun: one light for every look, for shading and for shadows alike, fixed in the scene (it stays where it is as the
// reader turns the model, as a real one would): high, from the right and in front of the usual first view, so it also
// lights what a cut opens. A look only changes how the light and its shadow are drawn
const SUN = norm([0.45, 0.8, 0.55]);

// The looks: ink (drawn: coloured pencil, hatching, ink outlines), studio (realistic) and pen (near-white solids in a few
// close tones, thin grey lines, colour only for accents). kind is what the renderers branch on.
/** @type {Record<string, any>} */
const LOOKS = {
  ink: {
    kind: 0,
    bg: 'transparent',
    ink: [0.114, 0.102, 0.118],
    cap: [0.95, 0.86, 0.62],
    paper: [0.97, 0.96, 0.93], // (the grain's paper, the hatched shadow's pencil)
    shade: [0.11, 0.1, 0.12],
    label: 'ink',
  },
  studio: {
    kind: 1,
    bg: 'radial-gradient(ellipse at 50% 35%, #2a3240 0%, #12161d 70%, #0b0e13 100%)',
    ink: [0, 0, 0],
    cap: [0.93, 0.55, 0.25],
    shade: [0, 0, 0],
    dark: true,
    label: 'studio',
  },
  pen: {
    kind: 2,
    bg: '#fbfbfa',
    ink: [0.5, 0.52, 0.55],
    cap: [0.95, 0.62, 0.42],
    label: 'pen',
  },
};
// Colour themes (LK3D.themes; a page may add its own). A theme sets the page behind the model, the lines, the words
// on the stage (as the figure's --lk3d-* variables) and the pen look's solids and ground. With none, the drawn and
// studio looks keep their own colours; the pen look takes light.
export const THEMES = {
  light: {
    bg: '#fbfbfa',
    line: '#80858c',
    ink: '#2b2e33',
    paper: '#ffffff',
    muted: '#7d828a',
    warn: '#c0392b',
    highlight: '#ffd9a8',
    solid: '#f3f2ef',
    shadow: '#4a4f57',
    dark: false,
  },
  dark: {
    bg: '#16181c',
    line: '#8d939b',
    ink: '#e8eaed',
    paper: '#22252b',
    muted: '#9aa0a8',
    warn: '#ff9b7a',
    highlight: '#7a4b1c',
    solid: '#cfd2d6',
    shadow: '#000000',
    dark: true,
  },
  blueprint: {
    bg: '#1c3d6b',
    line: '#c9dcf2',
    ink: '#eef5ff',
    paper: '#24497c',
    muted: '#a9c2e2',
    warn: '#ffd08a',
    highlight: '#3d6aa6',
    solid: '#4b74a8',
    shadow: '#0b1f3d',
    dark: true,
  },
  sepia: {
    bg: '#f2e8d5',
    line: '#8a6c4d',
    ink: '#3d2c1c',
    paper: '#f8f0e1',
    muted: '#8a7560',
    warn: '#a8402a',
    highlight: '#e8c991',
    solid: '#efe4cf',
    shadow: '#4d3520',
    dark: false,
  },
};
// the studio look's other environments (env: warm | night), behind the model
/** @type {Record<string, string>} */
const BGS = {
  warm: 'radial-gradient(ellipse at 50% 35%, #3b3128 0%, #1a1511 70%, #0e0b09 100%)',
  night: 'radial-gradient(ellipse at 50% 30%, #18213a 0%, #0a0e1a 70%, #05070d 100%)',
};

// ---- the look and the theme in use: resolved when either changes (the stage's background and variables with them)
/** @param {import('./context').Ctx} c */
export function makeLook(c) {
  // (kept here, and copied to c for the edges and the labels when they change)
  let look = null,
    lookKey = '';
  c.look_ = look;
  c.lookKey_ = lookKey;
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => {
    if (c.state_.theme === 'auto') c.kick_();
  };
  darkQuery.addEventListener('change', onScheme);
  c.cleanups_.push(() => darkQuery.removeEventListener('change', onScheme));
  c.lookNow_ = () => {
    const style = LOOKS[c.state_.style] ? c.state_.style : 'pen',
      base = LOOKS[style],
      themeName =
        c.state_.theme === 'auto'
          ? darkQuery.matches
            ? 'dark'
            : 'light'
          : LK3D.themes[c.state_.theme]
            ? c.state_.theme
            : base.kind === 2
              ? 'light'
              : null,
      key = style + '|' + themeName + '|' + c.state_.transparent;
    if (key !== lookKey) {
      const theme = themeName && LK3D.themes[themeName],
        // a transparent page (the mount's option, or a theme's bg: 'transparent'): nothing painted behind the model, in
        // any look; the theme's lines, solids and words still apply (a video lays the figure over its own picture)
        clear = c.state_.transparent || theme?.bg === 'transparent';
      c.look_ = look = {
        ...base,
        light: SUN,
        ...(theme && {
          ink: rgb(theme.line),
          paper: rgb(theme.bg === 'transparent' ? theme.paper : theme.bg),
          fill: clear ? null : rgb(theme.bg),
          solid: rgb(theme.solid),
          shade: rgb(theme.shadow),
          dark: theme.dark,
        }),
      };
      c.lookKey_ = lookKey = key;
      c.stage_.style.background = clear
        ? 'transparent'
        : theme
          ? theme.bg
          : (style === 'studio' && BGS[c.spec_.env]) || base.bg;
      c.stage_.dataset.look = style;
      if (theme) c.stage_.dataset.theme = themeName;
      else delete c.stage_.dataset.theme;
      for (const k of ['ink', 'line', 'paper', 'muted', 'warn', 'highlight'])
        if (theme) c.stage_.style.setProperty('--lk3d-' + k, theme[k]);
        else c.stage_.style.removeProperty('--lk3d-' + k);
    }
    return look;
  };
}
