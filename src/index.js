// @ts-check
// lk3d as an ES module (import … from 'lk3d'): the engine (core.js) with its glTF reader (models.js). The global script,
// dist/lk3d.min.js, is built from script.js and leaves the reader to dist/lk3d-models.min.js, which only a page that
// shows a model loads.
import './models.js';

export * from './core.js';
export { default } from './core.js';
