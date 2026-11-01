// Types for lk3d/validate: the scene's problems, each with where it is and what it should be.
import type { Scene } from './index.js';
export interface Problem { path: string; message: string }
export function validate(scene: Scene | unknown): Problem[];
export const schema: object;
