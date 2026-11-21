// @ts-check
// A guided step's state of the figure, worked out from the scene and the step alone (no page): which parts it hides,
// its cut and section, how far apart, each motion's value. The figure goes to it (figure/steps.js), and lk3d check
// reads the same to test what a step shows (lint.js: expect's seen).
import { startOf } from './motion.js';

/** a step's list (hide, play, focus), or none */
export const listed = (/** @type {unknown} */ list) => (Array.isArray(list) ? list : []);

/** @param {any} spec the scene @param {any} step one of its steps */
export function stepState(spec, step) {
  const hide = listed(step.hide);
  return {
    /** @param {{ id: string, group?: string, hiddenByScene?: boolean }} part */
    hidden: (part) => !!part.hiddenByScene || hide.includes(part.id) || hide.includes(part.group),
    section: { normal: [0, 0, 1], offset: 0, ...spec.section, ...step.section },
    /** @type {boolean | number} */
    cut: spec.section === false ? false : (step.cut ?? false),
    explode: Math.max(0, Math.min(1, +(step.explode ?? 0) || 0)),
    /** @param {any} motion */
    motion: (motion) => step.motion?.[motion.id] ?? startOf(motion),
  };
}
