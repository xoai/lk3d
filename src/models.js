// @ts-check
// The glTF reader (gltf.js) given to the engine: imported by the ES module (index.js), the check (lint.js), the CLI and
// the exporter's module (export.js), so each reads models; the global script leaves it to the models add-on.
import { useModels } from './geometry.js';
import { load, parseGLB, bytes } from './gltf.js';

useModels({ load, parseGLB, bytes });
