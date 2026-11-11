// The WebGL renderer, for WebGL 2 (the hi-fi path: physically based materials lit by a generated studio environment,
// soft shadows, glow) and WebGL 1 (the same scene, simpler light). Every renderer has the same small interface
// ({kind, hifi, draw(frame), setAO(batch), dispose()}), so another backend (WebGPU) can be added beside it.
import * as shaders from './shaders.js';
import { M, sub, len, mulv, add, norm, dot } from './math.js';
import { flowIndices, gpuData, STRIDE, MAX_STREAKS } from './flow.js';
import * as changed from './changed.js';

// (uViewD: in ortho, the distance every point is drawn as from; 0 in perspective, where nearer points are larger)
const POINT_VS = `attribute vec4 aPos; uniform mat4 uVP; uniform float uSize; uniform vec3 uEye; uniform float uViewD;
void main() { gl_Position = uVP * vec4(aPos.xyz, 1.0); gl_PointSize = uSize / max(0.2, uViewD > 0.0 ? uViewD : length(aPos.xyz - uEye)); }`;
const POINT_FS = `uniform vec3 uColor; uniform float uAlpha;
void main() { vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; gl_FragColor = vec4(uColor, uAlpha * (1.0 - smoothstep(0.15, 0.5, r))); }`;

// balls (the molecules of a gas): a point sprite shaded as a sphere, in one of three colours by aPos.w (below 1/3, up
// to 2/3, above: bands read better than a blend, whose middle is a muddy grey); in the drawn and pen looks, a rim
const BALL_VS = `attribute vec4 aPos; uniform mat4 uVP; uniform float uSize; uniform vec3 uEye; uniform float uViewD; varying float vW;
void main() { gl_Position = uVP * vec4(aPos.xyz, 1.0); gl_PointSize = max(2.0, uSize / max(0.05, uViewD > 0.0 ? uViewD : length(aPos.xyz - uEye))); vW = aPos.w; }`;
const BALL_FS = `uniform vec3 uC0, uC1, uC2, uInk; uniform float uStudio; varying float vW;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0; float r2 = dot(d, d); if (r2 > 1.0) discard;
  vec3 c = vW < 0.35 ? uC0 : vW < 0.65 ? uC1 : uC2;
  vec3 n = vec3(d.x, -d.y, sqrt(1.0 - r2));
  float l = max(dot(n, normalize(vec3(-0.45, 0.6, 0.66))), 0.0);
  vec3 col = uStudio > 1.5 ? (r2 > 0.84 ? uInk : c * (l > 0.35 ? 1.0 : 0.93)) : uStudio > 0.5 ? c * (0.28 + 0.8 * l) + vec3(0.5) * pow(l, 24.0) : (r2 > 0.72 ? uInk : c * (l > 0.35 ? 1.0 : 0.85));
  gl_FragColor = vec4(col, 1.0);
}`;

// the studio environments: the sky's colour (the floor is darker, the horizon a bright line), the key and fill softboxes
const ENVS = {
  studio: { sky: [0.16, 0.18, 0.22], key: [6, 5.88, 5.7], fill: [2.25, 2.55, 3] },
  warm: { sky: [0.2, 0.15, 0.1], key: [6.6, 5.3, 3.7], fill: [1.4, 1.6, 2.2] },
  night: { sky: [0.035, 0.045, 0.08], key: [2.4, 2.8, 3.8], fill: [3.6, 2.3, 1.3] },
};
function glRenderer(gl, scene, options = {}) {
  const gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const instancing = gl2
    ? {
        setDivisor: (location, divisor) => gl.vertexAttribDivisor(location, divisor),
        drawElements: (mode, count, type, offset, instanceCount) =>
          gl.drawElementsInstanced(mode, count, type, offset, instanceCount),
        drawArrays: (mode, count, instanceCount) => gl.drawArraysInstanced(mode, 0, count, instanceCount),
      }
    : (() => {
        const extension = gl.getExtension('ANGLE_instanced_arrays');
        return (
          extension && {
            setDivisor: (location, divisor) => extension.vertexAttribDivisorANGLE(location, divisor),
            drawElements: (mode, count, type, offset, instanceCount) =>
              extension.drawElementsInstancedANGLE(mode, count, type, offset, instanceCount),
            drawArrays: (mode, count, instanceCount) =>
              extension.drawArraysInstancedANGLE(mode, 0, count, instanceCount),
          }
        );
      })();
  const uint32Indices = gl2 || !!gl.getExtension('OES_element_index_uint');
  const hifi = gl2 && options.hifi !== false,
    shadowsOn = hifi && options.shadows !== false;
  // the environment's format: half-float where it can be rendered to, else 8-bit with a shared exponent (RGBM)
  let envHalfFloat = false;
  if (hifi && (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))) {
    const texture = gl.createTexture(),
      framebuffer = gl.createFramebuffer(); // can it really be drawn into here?
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    envHalfFloat = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
  }
  // vertex attributes: exactly the ones the current draw uses are enabled (a stale one can fail a draw on some browsers)
  const maxAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
    enabled = new Array(maxAttributes).fill(false);
  // blending over what is drawn: colour by alpha, and the canvas's own alpha by "over" too (blending alpha like colour
  // would leave a² + A(1 − a), and the page would show through opaque parts behind glass)
  const blendOver = () => gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  // every attribute at a fixed place, so one vertex array (VAO) per batch serves every program that draws parts
  const LOCATIONS = {
    aPos: 0,
    aNrm: 1,
    aOut: 2,
    aAO: 3,
    aCol: 4,
    aI0: 5,
    aI1: 6,
    aI2: 7,
    aI3: 8,
    aUV: 9,
    aDir: 10,
    aFace: 11,
    aA: 12,
    aIC: 13,
    aIE: 14,
  };
  const vertexArrays = gl2
    ? {
        create: () => gl.createVertexArray(),
        bind: (vertexArray) => gl.bindVertexArray(vertexArray),
        delete: (vertexArray) => gl.deleteVertexArray(vertexArray),
      }
    : (() => {
        const extension = gl.getExtension('OES_vertex_array_object');
        return (
          extension && {
            create: () => extension.createVertexArrayOES(),
            bind: (vertexArray) => extension.bindVertexArrayOES(vertexArray),
            delete: (vertexArray) => extension.deleteVertexArrayOES(vertexArray),
          }
        );
      })();
  // (every WebGL 2, and nearly every WebGL 1, has both; a device that lacks either draws the figure in 2D)
  if (!instancing || !vertexArrays) throw new Error('lk3d: this WebGL has no instancing or no vertex arrays');
  const enableOnly = (locations) => {
    for (let location = 0; location < maxAttributes; location++) {
      const want = locations.includes(location);
      if (want !== enabled[location]) {
        want ? gl.enableVertexAttribArray(location) : gl.disableVertexAttribArray(location);
        enabled[location] = want;
      }
    }
  };

  // ---- programs. Compiling shaders is what makes a first visit slow (about a second on a phone, measured): so only the
  // programs a picture needs are compiled, and where the browser can compile in the background
  // (KHR_parallel_shader_compile) nothing waits for them: draw() answers false until they are ready, and the engine
  // simply tries again on the next frame.
  const parallelCompile = gl.getExtension('KHR_parallel_shader_compile');
  const makeProgram = (vertexSource, fragmentSource, defines = []) => {
    const compile = (type, source, stage) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, shaders.header(gl2, stage, defines) + source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram(),
      vertexShader = compile(gl.VERTEX_SHADER, vertexSource, 'vs'),
      fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource, 'fs');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    for (const [name, location] of Object.entries(LOCATIONS)) gl.bindAttribLocation(program, location, name); // (the same place in every program)
    gl.linkProgram(program);
    return { program, vertexShader, fragmentShader, linked: false };
  };
  // is it compiled? (wait: true blocks until it is, for work that cannot be put off)
  // a program ready to use? (its uniforms and attributes looked up once.) One that does not link throws, unless it is
  // optional (an effect: streaks, streams, edges, particles, glow): that one is left out, and the rest still draws
  const ready = (prog, wait = false) => {
    if (prog.linked) return true;
    if (prog.failed || gl.isContextLost()) return false;
    if (!wait && parallelCompile && !gl.getProgramParameter(prog.program, parallelCompile.COMPLETION_STATUS_KHR))
      return false;
    if (!gl.getProgramParameter(prog.program, gl.LINK_STATUS)) {
      const log =
        gl.getShaderInfoLog(prog.fragmentShader) ||
        gl.getShaderInfoLog(prog.vertexShader) ||
        gl.getProgramInfoLog(prog.program);
      if (!prog.optional) throw new Error('lk3d shader: ' + log);
      prog.failed = true;
      console.warn('lk3d: an effect is left out on this device: ' + log);
      return false;
    }
    const program = prog.program,
      uniforms = {},
      attributes = {},
      uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS),
      attributeCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for (let index = 0; index < uniformCount; index++) {
      const info = gl.getActiveUniform(program, index);
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    for (let index = 0; index < attributeCount; index++) {
      const info = gl.getActiveAttrib(program, index);
      attributes[info.name] = gl.getAttribLocation(program, info.name);
    }
    Object.assign(prog, { uniforms, attributes, linked: true });
    return true;
  };
  const cutDefines = hifi ? ['CUTS'] : []; // (where models' maps are loaded: the drawn looks and the shadow cut cut-outs too)
  const studioDefines = [
    ...(hifi ? ['HIFI'] : []),
    ...(shadowsOn ? ['SHADOWS'] : []),
    ...(hifi && !envHalfFloat ? ['RGBM'] : []),
  ];
  const programs = {
    ink: makeProgram(shaders.PART_VS, shaders.PART_FS, ['INK', ...cutDefines, ...(shadowsOn ? ['SHADOWS'] : [])]),

    ground: makeProgram(shaders.GROUND_VS, shaders.GROUND_FS, shadowsOn ? ['SHADOWS'] : []),
  };
  if (shadowsOn) programs.depth = makeProgram(shaders.PART_VS, shaders.DEPTH_FS, cutDefines);
  // particles along paths and solid balls: compiled only for a figure that has them
  const optionalProgram = (name) =>
    programs[name] ||
    (programs[name] = Object.assign(
      name === 'points'
        ? makeProgram(POINT_VS, POINT_FS)
        : name === 'flow' || name === 'flowGPU'
          ? makeProgram(shaders.FLOW_VS, shaders.FLOW_FS, name === 'flowGPU' ? ['GPU'] : [])
          : name === 'edge'
            ? makeProgram(shaders.EDGE_VS, shaders.EDGE_FS)
            : name === 'stream'
              ? makeProgram(shaders.STREAM_VS, shaders.STREAM_FS)
              : name === 'copy'
                ? makeProgram(shaders.QUAD_VS, shaders.COPY_FS)
                : makeProgram(BALL_VS, BALL_FS),
      { optional: true },
    ));
  // the caps on the cut's plane (WebGL 2, with a stencil buffer): a program for each look
  const capsOn = gl2 && (gl.getContextAttributes() || {}).stencil,
    capProgram = (kind) =>
      programs['cap' + kind] ||
      (programs['cap' + kind] = makeProgram(shaders.PART_VS, shaders.PART_FS, [
        'CAPS',
        ...cutDefines,
        ...[['INK'], [], ['PEN']][kind],
      ]));
  // the pen look: compiled when first needed (its parts take no shadow: only the ground does)
  const penProgram = () =>
    programs.pen || (programs.pen = makeProgram(shaders.PART_VS, shaders.PART_FS, ['PEN', ...cutDefines]));
  // the studio look, its environment and the glow: compiled when first needed, or ahead of time in the background once
  // the first picture is up (only where that does not block)
  const studioPrograms = () => {
    if (!programs.studio) programs.studio = makeProgram(shaders.PART_VS, shaders.PART_FS, studioDefines);
    if (hifi && !programs.environment) {
      programs.environment = makeProgram(shaders.QUAD_VS, shaders.ENV_FS, envHalfFloat ? [] : ['RGBM']);
      programs.prefilter = makeProgram(shaders.QUAD_VS, shaders.PREFILTER_FS, envHalfFloat ? [] : ['RGBM']);
    }
  };
  const glowPrograms = () => {
    if (!programs.glow) {
      programs.glow = Object.assign(makeProgram(shaders.PART_VS, shaders.GLOW_FS), { optional: true });
      programs.blur = Object.assign(makeProgram(shaders.QUAD_VS, shaders.BLUR_FS), { optional: true });
      programs.add = Object.assign(makeProgram(shaders.QUAD_VS, shaders.ADD_FS), { optional: true });
    }
  };

  // ---- geometry: compressed vertices, one buffer set per batch, a matrix per instance
  const makeBuffer = (data, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) => {
    const buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, usage);
    return buffer;
  };
  const buffersByMesh = new WeakMap(); // a mesh's buffers, shared by every batch that draws it (parts alike)
  // a batch's placements, 16 numbers each, in one array
  const packed = (batch) => {
    const matrices = new Float32Array(batch.placements.length * 16);
    batch.placements.forEach((matrix, i) => matrices.set(matrix, 16 * i));
    return matrices;
  };
  function upload(batch) {
    const mesh = batch.mesh,
      placements = packed(batch);
    const shared = buffersByMesh.get(mesh);
    if (shared) {
      batch.gpu = {
        ...shared,
        vertexArray: null, // (its own vertex arrays: they hold its own placements)
        edgeVertexArray: null,
        placements: makeBuffer(placements, gl.ARRAY_BUFFER, batch.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW),
        instanceCount: batch.placements.length,
      };
      return;
    }
    const vertexCount = mesh.count,
      low = [1e9, 1e9, 1e9],
      high = [-1e9, -1e9, -1e9];
    for (let k = 0; k < vertexCount; k++)
      for (let axis = 0; axis < 3; axis++) {
        const value = mesh.positions[3 * k + axis];
        if (value < low[axis]) low[axis] = value;
        if (value > high[axis]) high[axis] = value;
      }
    const scale = [0, 1, 2].map((axis) => Math.max(1e-9, (high[axis] - low[axis]) / 2)),
      offset = [0, 1, 2].map((axis) => (high[axis] + low[axis]) / 2);
    const positions = new Int16Array(vertexCount * 4),
      normals = new Int8Array(vertexCount * 4),
      outlineNormals = new Int8Array(vertexCount * 4);
    for (let k = 0; k < vertexCount; k++)
      for (let axis = 0; axis < 3; axis++) {
        positions[4 * k + axis] = Math.round(((mesh.positions[3 * k + axis] - offset[axis]) / scale[axis]) * 32767);
        normals[4 * k + axis] = Math.round(mesh.normals[3 * k + axis] * 127);
        outlineNormals[4 * k + axis] = Math.round(batch.outlineNormals[3 * k + axis] * 127);
      }
    if (vertexCount > 65535 && !uint32Indices)
      throw new Error('lk3d: a shape with more than 65535 vertices needs 32-bit indices, which this device lacks');
    const wideIndices = vertexCount > 65535;
    const colors = mesh.colors ? Uint8Array.from(mesh.colors) : new Uint8Array(vertexCount * 4); // a vertex's own colour; alpha 0: the part's
    batch.gpu = {
      positions: makeBuffer(positions),
      normals: makeBuffer(normals),
      outlineNormals: makeBuffer(outlineNormals),
      colors: makeBuffer(colors),
      ao: makeBuffer(new Uint8Array(vertexCount).fill(255)),
      indices: makeBuffer(
        wideIndices ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices),
        gl.ELEMENT_ARRAY_BUFFER,
      ),
      placements: makeBuffer(placements, gl.ARRAY_BUFFER, batch.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW),
      indexCount: mesh.indices.length,
      indexType: wideIndices ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      positionScale: scale,
      positionOffset: offset,
      instanceCount: batch.placements.length,
      uv: mesh.textures && hifi ? makeBuffer(new Float32Array(mesh.uv)) : null,
      maps: {},
      alphaCutoff: (mesh.textures && mesh.textures.alphaCutoff) || 0,
    };
    if (mesh.textures && hifi) loadMaps(batch.gpu.maps, mesh.textures);
    if (!batch.dynamic) buffersByMesh.set(mesh, batch.gpu);
  }
  // a model's texture maps (studio look, WebGL 2): decoded off the main thread, at half size on a phone, and drawn once
  // ready (until then the part's own colour shows)
  let pending = 0, // texture maps still decoding
    loaded = 0; // and those drawn so far
  function loadMaps(textures, maps) {
    for (const mapName of ['base', 'normal', 'metalRoughness'])
      if (maps[mapName] && typeof createImageBitmap === 'function') {
        pending++;
        // (the file's own pixels: a normal or metal-roughness map must not be colour-managed, alpha not premultiplied)
        createImageBitmap(new Blob([maps[mapName].bytes], { type: maps[mapName].mime }), {
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
        })
          .then((bitmap) =>
            options.small
              ? createImageBitmap(bitmap, {
                  resizeWidth: Math.max(1, bitmap.width >> 1),
                  resizeHeight: Math.max(1, bitmap.height >> 1),
                  resizeQuality: 'high',
                  premultiplyAlpha: 'none',
                  colorSpaceConversion: 'none',
                })
              : bitmap,
          )
          .then((bitmap) => {
            if (gl.isContextLost()) return;
            const texture = gl.createTexture();
            gl.activeTexture(gl.TEXTURE4);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.activeTexture(gl.TEXTURE0);
            textures[mapName] = texture;
            loaded++; // (the shadow and depth drawn again: a cut-out's map changes what casts a shadow)
            if (options.onTexture) options.onTexture();
          })
          .catch(() => {}) // an image the browser cannot decode: the part keeps its colour
          .finally(() => pending--);
      }
  }
  // a batch's edges (geometry.js edgesOf, found after the first picture): two triangles a segment, each corner its end
  // and side (aPos: x, y, z, ±1), the segment's direction (aDir) and the normal of its faces (aFace)
  function edges(batch) {
    const shared = buffersByMesh.get(batch.mesh);
    if (shared && shared.edgeBuffer && shared !== batch.gpu) {
      batch.gpu.edgeBuffer = shared.edgeBuffer;
      batch.gpu.edgeVertexCount = shared.edgeVertexCount;
      return;
    }
    const lines = batch.lines,
      segmentCount = lines.length / 9,
      vertices = new Float32Array(segmentCount * 6 * 10);
    for (let segment = 0; segment < segmentCount; segment++)
      [0, 0, 1, 0, 1, 1].forEach((end, corner) => {
        const offset = (6 * segment + corner) * 10,
          start = 9 * segment + 3 * end;
        vertices.set(
          [lines[start], lines[start + 1], lines[start + 2], corner === 1 || corner === 3 || corner === 4 ? 1 : -1],
          offset,
        );
        for (let j = 0; j < 3; j++) {
          vertices[offset + 4 + j] = lines[9 * segment + 3 + j] - lines[9 * segment + j];
          vertices[offset + 7 + j] = lines[9 * segment + 6 + j];
        }
      });
    if (batch.gpu.edgeBuffer) gl.deleteBuffer(batch.gpu.edgeBuffer);
    batch.gpu.edgeBuffer = segmentCount ? makeBuffer(vertices) : null;
    batch.gpu.edgeVertexCount = segmentCount * 6;
    if (shared) Object.assign(shared, { edgeBuffer: batch.gpu.edgeBuffer, edgeVertexCount: batch.gpu.edgeVertexCount });
  }
  // a batch whose placements change (lines: rays, field lines): its matrices again, in place
  function instances(batch) {
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.gpu.placements);
    gl.bufferData(gl.ARRAY_BUFFER, packed(batch), gl.DYNAMIC_DRAW);
    batch.gpu.instanceCount = batch.placements.length;
    batch.version = (batch.version || 0) + 1; // (what casts a shadow has moved)
  }
  // the scene's batches (again, with their crease shading and edges, when a lost context comes back)
  function setAO(batch) {
    if (batch.gpu && batch.ao) {
      gl.bindBuffer(gl.ARRAY_BUFFER, batch.gpu.ao);
      gl.bufferData(gl.ARRAY_BUFFER, batch.ao, gl.STATIC_DRAW);
    }
  }
  for (const part of scene.parts)
    for (const batch of part.batches) {
      upload(batch);
      setAO(batch);
      if (batch.lines) edges(batch);
    }
  const quad = makeBuffer(
    new Float32Array([-1, -1, 0, 1, 1, -1, 0, 1, 1, 1, 0, 1, -1, -1, 0, 1, 1, 1, 0, 1, -1, 1, 0, 1]),
  );
  const pointBuffer = gl.createBuffer(),
    ballBuffers = new WeakMap(); // a ball set's buffer, and the version of its positions in it
  let flowIndexBuffer = null; // the flows' triangles, made once for as many streaks as a flow may have
  /**
   * the streams' half-size picture (with the hulls' own depth) and the solid parts' depth (WebGL 2 only)
   * @type {{ width: number, height: number, key: any[], color?: WebGLTexture, colorFramebuffer?: WebGLFramebuffer,
   *   hullDepth?: WebGLRenderbuffer, depth?: WebGLTexture, depthFramebuffer?: WebGLFramebuffer } | null}
   */
  let streamTargets = null;
  const hullBuffers = new WeakMap(); // each stream's hull
  // a texture as the target of a framebuffer
  const framebufferFor = (texture, attachment) => {
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return [texture, framebuffer];
  };
  const flowBuffers = new WeakMap(); // each flow's vertex buffer, made once at its full size and refilled in place
  // flows placed on the GPU (WebGL 2): each flow's paths as a float texture and its streaks' fixed numbers as instance
  // attributes, made once (flow.js gpuData), so a frame sends only the time travelled. A flow whose paths have more
  // points than a texture is wide, or every flow once the program does not link, is placed on the CPU (flow.js update)
  const flowsOnGPU = new WeakMap(),
    maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  /** @type {{ corners: WebGLBuffer, indices: WebGLBuffer } | null} (a streak's 8 corners and 18 triangle corners) */
  let streakTemplate = null;
  const placesFlow = (flow) =>
    gl2 &&
    !(programs.flowGPU && programs.flowGPU.failed) &&
    !!flow.seeds &&
    (flow.tableWidth ??= 1 + Math.max(...flow.paths.map((path) => path.table.length))) <= maxTextureSize;
  function gpuFlowOf(flow) {
    let held = flowsOnGPU.get(flow);
    if (!held) {
      const data = gpuData(flow),
        texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE8);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      for (const [name, value] of [
        [gl.TEXTURE_MIN_FILTER, gl.NEAREST],
        [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
        [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      ])
        gl.texParameteri(gl.TEXTURE_2D, name, value);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, data.width, data.height, 0, gl.RGBA, gl.FLOAT, data.table);
      gl.activeTexture(gl.TEXTURE0);
      flowsOnGPU.set(flow, (held = { texture, seeds: makeBuffer(data.seeds) }));
    }
    return held;
  }

  // a vertex array, described once: a shape's buffers (or its edges' segments) and its copies' placements, 16
  // numbers a copy (a batch's own), or 24 with the part's state (a group of parts alike: see groupsOf); bound with
  // one call per draw (a scene of thousands of parts otherwise spends most of its frame describing buffers again)
  function makeVertexArray(gpu, placements, stride, forEdges) {
    const vertexArray = vertexArrays.create();
    vertexArrays.bind(vertexArray);
    const attribute = (location, buffer, size, type, normalized, byteStride = 0, byteOffset = 0, divisor = 0) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, type, normalized, byteStride, byteOffset);
      instancing.setDivisor(location, divisor);
    };
    if (forEdges)
      for (const [location, size, byteOffset] of [
        [0, 4, 0],
        [10, 3, 16],
        [11, 3, 28],
      ])
        attribute(location, gpu.edgeBuffer, size, gl.FLOAT, false, 40, byteOffset);
    else {
      attribute(0, gpu.positions, 4, gl.SHORT, true);
      attribute(1, gpu.normals, 4, gl.BYTE, true);
      attribute(2, gpu.outlineNormals, 4, gl.BYTE, true);
      attribute(3, gpu.ao, 1, gl.UNSIGNED_BYTE, true);
      attribute(4, gpu.colors, 4, gl.UNSIGNED_BYTE, true);
      if (gpu.uv) attribute(9, gpu.uv, 2, gl.FLOAT, false);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.indices);
    }
    for (let slot = 0; slot < stride / 16; slot++)
      attribute([5, 6, 7, 8, LOCATIONS.aIC, LOCATIONS.aIE][slot], placements, 4, gl.FLOAT, false, stride, 16 * slot, 1);
    vertexArrays.bind(null); // (bound where it is drawn: nothing else changes it by accident)
    return vertexArray;
  }
  let bound = false; // (a vertex array is bound: the default one must be put back before anything else draws)
  function bindBatch(prog, batch) {
    const gpu = batch.gpu,
      uniforms = prog.uniforms;
    vertexArrays.bind(gpu.vertexArray || (gpu.vertexArray = makeVertexArray(gpu, gpu.placements, 64)));
    bound = true;
    if (uniforms.uTex) {
      // which maps this batch has, on units 4, 5, 6, and a cut-out's alpha cutoff
      const maps = [gpu.maps.base, gpu.maps.normal, gpu.maps.metalRoughness];
      gl.uniform4f(uniforms.uTex, maps[0] ? 1 : 0, maps[1] ? 1 : 0, maps[2] ? 1 : 0, gpu.alphaCutoff);
      maps.forEach((texture, i) => {
        if (texture) {
          gl.activeTexture(gl.TEXTURE4 + i);
          gl.bindTexture(gl.TEXTURE_2D, texture);
        }
      });
      gl.activeTexture(gl.TEXTURE0);
    }
    if (uniforms.uQs) {
      // (batches of one shape share these: sent again only when the shape changes)
      setVec3(uniforms.uQs, gpu.positionScale);
      setVec3(uniforms.uQo, gpu.positionOffset);
    }
  }
  const drawBatch = (batch) =>
    instancing.drawElements(gl.TRIANGLES, batch.gpu.indexCount, batch.gpu.indexType, 0, batch.gpu.instanceCount);

  // ---- parts alike in one call: groups of batches that share a shape's buffers, on solid parts of one material.
  // A group's buffer holds each copy's matrix (its part's matrix times its own placement) and its part's state (colour
  // and tint, glow and flags: the attributes aIC and aIE), 24 numbers a copy; its vertex arrays read the shape's
  // buffers and this one, so a group is drawn as one batch
  const GROUP_STRIDE = 96,
    IDENTITY = M.id(),
    scratch = M.id(),
    shapeIds = new WeakMap(), // (a number for each shape's buffers, for the groups' keys)
    groupCache = new Map(); // a group's buffer and vertex arrays, kept from frame to frame
  let shapeCount = 0,
    groupedParts = [], // (the parts, and their batches, the groups were made of)
    /** @type {Map<any, any> | null} */
    groupByBatch = null,
    allGroups = [];
  const shapeId = (gpu) => shapeIds.get(gpu.positions) ?? (shapeIds.set(gpu.positions, ++shapeCount), shapeCount);
  // this frame's groups: batch → its group. A part joins only when every batch of it is in a group of two or more
  // (a part drawn half alone and half with others would be drawn twice). Kept while the same parts are drawn; a copy
  // is written again only when its part's matrix or state changed (parts' matrices are new objects only when they
  // move), and a group is sent to the GPU only when one of its copies was: turning the camera sends nothing
  function groupsOf(solid, flags, colour) {
    changed.start(groupedParts);
    for (const part of solid) {
      changed.put(part);
      changed.put(part.batches);
    }
    if (changed.end() || !groupByBatch) groupByBatch = makeGroups(solid);
    for (const group of allGroups) {
      const cache = group.cache;
      let offset = 0,
        sent = group.sent;
      for (const member of group.members) {
        const [part, batch] = member,
          color = colour(part),
          flagBits = flags(part);
        changed.start(member, 2); // (what its copies were written for: kept after the part and the batch)
        changed.put(part.matrix);
        changed.put(color);
        changed.put(part.tint);
        changed.put(part.emission);
        changed.put(flagBits);
        if (changed.any) {
          sent = false;
          for (let copy = 0; copy < batch.placements.length; copy++) {
            cache.data.set(M.mul(part.matrix, batch.placements[copy], scratch), offset + 24 * copy);
            cache.data.set(color, offset + 24 * copy + 16);
            cache.data[offset + 24 * copy + 19] = part.tint ?? 1;
            cache.data.set(part.emission, offset + 24 * copy + 20);
            cache.data[offset + 24 * copy + 23] = flagBits;
          }
        }
        offset += 24 * batch.placements.length;
      }
      if (!sent) {
        gl.bindBuffer(gl.ARRAY_BUFFER, cache.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, cache.data.subarray(0, offset), gl.DYNAMIC_DRAW);
        group.sent = true;
      }
    }
    return groupByBatch;
  }
  function makeGroups(solid) {
    const groupKey = (part, batch) => {
      const gpu = batch.gpu;
      if (
        !gpu ||
        batch.dynamic ||
        batch.mesh.twoSided ||
        gpu.uv ||
        gpu.maps.base ||
        gpu.maps.normal ||
        gpu.maps.metalRoughness
      )
        return null; // (lines; models)
      return (batch.groupKey ??= shapeId(gpu) + '|' + part.metalRoughness + '|' + part.surfaceDetail);
    };
    let parts = solid.filter((part) => part.batches.every((batch) => groupKey(part, batch)));
    for (;;) {
      const counts = new Map();
      for (const part of parts)
        for (const batch of part.batches) counts.set(batch.groupKey, (counts.get(batch.groupKey) || 0) + 1);
      const keep = parts.filter((part) => part.batches.every((batch) => counts.get(batch.groupKey) > 1));
      if (keep.length === parts.length) break;
      parts = keep;
    }
    const result = new Map(),
      groupByKey = new Map();
    for (const part of parts)
      for (const batch of part.batches) {
        let group = groupByKey.get(batch.groupKey);
        if (!group) {
          groupByKey.set(batch.groupKey, (group = { members: [], copyCount: 0 }));
          let cache = groupCache.get(batch.groupKey);
          if (!cache) {
            const buffer = gl.createBuffer();
            groupCache.set(
              batch.groupKey,
              (cache = { buffer, gpu: batch.gpu, data: new Float32Array(0), vertexArray: null, edgeVertexArray: null }),
            );
            cache.vertexArray = makeVertexArray(batch.gpu, buffer, GROUP_STRIDE);
          }
          group.cache = cache;
        }
        group.members.push([part, batch]);
        group.copyCount += batch.placements.length;
        result.set(batch, group);
      }
    for (const group of groupByKey.values()) {
      const cache = group.cache;
      if (cache.data.length < group.copyCount * 24) cache.data = new Float32Array(group.copyCount * 24 * 1.5);
      // drawn as a batch of its own: the shape's buffers, the group's copies
      group.batch = { gpu: { ...cache.gpu, vertexArray: cache.vertexArray, instanceCount: group.copyCount } };
    }
    allGroups = [...groupByKey.values()];
    return result;
  }
  function unbind() {
    if (bound) vertexArrays.bind(null);
    bound = false;
  }

  // ---- render targets
  const makeTexture = (width, height, internal, format, type, filter = gl.LINEAR) => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  };
  /** @type {{ texture: WebGLTexture, framebuffer: WebGLFramebuffer } | null} */
  let shadow = null; // (made when shadowsOn: tested in its place)
  const SHADOW_SIZE = options.shadowSize || 1024;
  if (shadowsOn) {
    const texture = makeTexture(
      SHADOW_SIZE,
      SHADOW_SIZE,
      gl.DEPTH_COMPONENT24,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      gl.LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    shadow = { texture, framebuffer };
  }
  // the studio environment: drawn once into a cube map, each mip level prefiltered for a rougher surface
  /** @type {{ texture: WebGLTexture } | null} */
  let env = null;
  const ENV_SIZE = 64,
    ENV_LEVELS = 6,
    environment = ENVS[options.env] || ENVS.studio;
  function makeEnv() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
    const internal = envHalfFloat ? gl.RGBA16F : gl.RGBA8,
      type = envHalfFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    for (let level = 0; level < ENV_LEVELS; level++)
      for (let face = 0; face < 6; face++)
        gl.texImage2D(
          gl.TEXTURE_CUBE_MAP_POSITIVE_X + face,
          level,
          internal,
          ENV_SIZE >> level,
          ENV_SIZE >> level,
          0,
          gl.RGBA,
          type,
          null,
        );
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, ENV_LEVELS - 1);
    studioPrograms();
    if (!ready(programs.environment, true) || !ready(programs.prefilter, true)) return gl.deleteTexture(texture); // (the context is gone)
    const drawProgram = programs.environment,
      prefilterProgram = programs.prefilter;
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    for (let level = 0; level < ENV_LEVELS; level++)
      for (let face = 0; face < 6; face++) {
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_CUBE_MAP_POSITIVE_X + face,
          texture,
          level,
        );
        gl.viewport(0, 0, ENV_SIZE >> level, ENV_SIZE >> level);
        const prog = level === 0 ? drawProgram : prefilterProgram;
        gl.useProgram(prog.program);
        gl.uniform1i(prog.uniforms.uFace, face);
        if (prog.uniforms.uRough) gl.uniform1f(prog.uniforms.uRough, level / (ENV_LEVELS - 1));
        gl.uniform3fv(prog.uniforms.uSky, environment.sky);
        gl.uniform3fv(prog.uniforms.uKey, environment.key);
        gl.uniform3fv(prog.uniforms.uFill, environment.fill);
        enableOnly([0]);
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    gl.enable(gl.DEPTH_TEST);
    env = { texture };
  }
  /** @type {Float32Array | null} */
  let shadowVP = null,
    /** @type {{ texture: WebGLTexture, width: number, height: number } | null} */
    backdrop = null;
  const shadowKey = [];
  // whether what the shadow map (or the streams' depth) was drawn for has changed since: each part (which one, its
  // matrix, a new object only when the part moves; whether cut, its placements' version), the section's plane, the
  // bounds and the light (or the camera). Compared value by value with the key kept, and kept instead: no garbage
  function moved(key, parts, frame, extra) {
    changed.start(key);
    for (const part of parts) {
      changed.put(part);
      changed.put(part.matrix);
      changed.put(frame.cut && part.cut);
      changed.put(part.batches.reduce((sum, batch) => sum + (batch.version || 0), 0));
    }
    for (const value of [...frame.plane, frame.bounds.radius, frame.cut, loaded, ...extra]) changed.put(value);
    return changed.end();
  }
  // the glow: emission drawn at half resolution, blurred at a quarter, added onto the picture
  /**
   * @typedef {object} GlowTargets
   * @property {number} width @property {number} height the picture's size
   * @property {number} halfWidth @property {number} halfHeight @property {number} quarterWidth
   * @property {number} quarterHeight
   * @property {WebGLTexture} emission @property {WebGLFramebuffer} emissionFramebuffer
   * @property {WebGLRenderbuffer} emissionDepth the emission, at half size, with depth
   * @property {WebGLTexture} blurA @property {WebGLFramebuffer} blurAFramebuffer @property {WebGLTexture} blurB
   * @property {WebGLFramebuffer} blurBFramebuffer the blur's two quarter-size targets, drawn into in turn
   */
  /** @type {GlowTargets | null} */
  let glow = null;
  function glowTargets(width, height) {
    const halfWidth = Math.max(1, width >> 1),
      halfHeight = Math.max(1, height >> 1),
      quarterWidth = Math.max(1, width >> 2),
      quarterHeight = Math.max(1, height >> 2);
    if (glow && glow.width === width && glow.height === height) return glow;
    if (glow) {
      for (const texture of [glow.emission, glow.blurA, glow.blurB]) gl.deleteTexture(texture);
      for (const framebuffer of [glow.emissionFramebuffer, glow.blurAFramebuffer, glow.blurBFramebuffer])
        gl.deleteFramebuffer(framebuffer);
      gl.deleteRenderbuffer(glow.emissionDepth);
    }
    const makeTarget = (targetWidth, targetHeight) => {
      const texture = makeTexture(targetWidth, targetHeight, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      return [texture, framebuffer];
    };
    const [emission, emissionFramebuffer] = makeTarget(halfWidth, halfHeight),
      emissionDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, emissionDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, halfWidth, halfHeight);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, emissionDepth);
    const [blurA, blurAFramebuffer] = makeTarget(quarterWidth, quarterHeight),
      [blurB, blurBFramebuffer] = makeTarget(quarterWidth, quarterHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    glow = {
      width,
      height,
      halfWidth,
      halfHeight,
      quarterWidth,
      quarterHeight,
      emission,
      emissionFramebuffer,
      emissionDepth,
      blurA,
      blurAFramebuffer,
      blurB,
      blurBFramebuffer,
    };
    return glow;
  }
  function fullscreen(prog) {
    enableOnly([0]);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    instancing.setDivisor(0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // a part's uniforms, sent only when they differ from the last part's (parts alike share their colour and material,
  // and every call costs: a scene of thousands of parts would spend its frame on them)
  const lastSent = new Map(),
    setFloat = (location, value) => {
      if (lastSent.get(location) !== value) {
        lastSent.set(location, value);
        gl.uniform1f(location, value);
      }
    },
    setVec3 = (location, vector) => {
      const previous = lastSent.get(location);
      if (!previous || previous[0] !== vector[0] || previous[1] !== vector[1] || previous[2] !== vector[2]) {
        lastSent.set(location, vector);
        gl.uniform3fv(location, vector);
      }
    };
  const NO_SHADOW = M.mul(M.trans([10, 10, 10]), M.scale([0, 0, 0]));
  gl.enable(gl.DEPTH_TEST);
  function common(prog, frame, viewProjection) {
    gl.useProgram(prog.program);
    const uniforms = prog.uniforms;
    if (uniforms.uVP) gl.uniformMatrix4fv(uniforms.uVP, false, viewProjection || frame.viewProjection);
    if (uniforms.uEye) gl.uniform3fv(uniforms.uEye, frame.eye);
    if (uniforms.uPlane) gl.uniform4fv(uniforms.uPlane, frame.plane);
    if (uniforms.uCut) gl.uniform1f(uniforms.uCut, frame.cut ? 1 : 0);
    if (uniforms.uOutline) gl.uniform1f(uniforms.uOutline, 0);
    if (uniforms.uViewD) gl.uniform1f(uniforms.uViewD, frame.viewDistance || 0);
    if (uniforms.uBase) gl.uniform1i(uniforms.uBase, 4); // (a model's base colour map, on its own unit)
  }

  return {
    kind: gl2 ? 'webgl2' : 'webgl1',
    hifi,
    shadows: shadowsOn,
    parallel: !!parallelCompile,
    // after the first picture: start compiling the studio look in the background, where that does not block
    prewarm() {
      if (parallelCompile) {
        studioPrograms();
        penProgram();
        if (hifi) glowPrograms();
      }
    },
    upload,
    instances,
    edges,
    placesFlow,
    get pending() {
      return pending;
    },
    setAO,
    draw(frame) {
      const kind = frame.look.kind, // 0 ink, 1 studio, 2 pen
        ink = kind === 0,
        pen = kind === 2,
        width = gl.canvas.width,
        height = gl.canvas.height;
      // the programs this picture needs; if one is still compiling, draw nothing yet (the last picture stays up)
      if (kind === 1) studioPrograms();
      const lookProgram = ink ? programs.ink : pen ? penProgram() : programs.studio,
        flows = frame.flows || [];
      const ballSets = frame.particles.filter(
          (particleSet) => particleSet.solid && particleSet.visible && particleSet.count,
        ),
        pointSets = frame.particles.filter((particleSet) => !particleSet.solid && particleSet.visible);
      const needs = [
        lookProgram,
        programs.ground,
        ...(shadowsOn ? [programs.depth] : []),
        ...(pointSets.length ? [optionalProgram('points')] : []),
        ...(ballSets.length ? [optionalProgram('balls')] : []),
        ...flows.map((flow) => optionalProgram(placesFlow(flow) ? 'flowGPU' : 'flow')),
        ...(frame.edges ? [optionalProgram('edge')] : []),
        ...(frame.streams && frame.streams.length ? [optionalProgram('stream'), optionalProgram('copy')] : []),
      ];
      if (kind === 1 && hifi && !env) needs.push(programs.environment, programs.prefilter);
      const capped = capsOn && frame.cut && frame.parts.some((part) => part.cut);
      if (capped) needs.push(capProgram(kind));
      let waiting = false;
      for (const prog of needs) if (!ready(prog) && !prog.failed) waiting = true;
      const can = (name) => programs[name] && programs[name].linked; // (an optional effect that compiled)
      if (waiting) return false;
      const opaque = frame.parts.filter((part) => part.drawAlpha >= 0.99),
        seeThrough = frame.parts.filter((part) => part.drawAlpha > 0.01 && part.drawAlpha < 0.99);
      // a part's own state, as constant attributes for a part drawn alone (one call each, as a uniform would be): its
      // colour in this look and how much of it the pen look shows; its glow, and flags (1 lit, 2 cut: a part may stay
      // whole, cut: false)
      const flags = (part) =>
          (part.id === frame.hover || part.id === frame.selected ? 1 : 0) + (frame.cut && part.cut ? 2 : 0),
        colour = (part) => (kind === 1 ? part.studioColor : part.color);
      const state = (part) => {
        const color = colour(part),
          emission = part.emission;
        gl.vertexAttrib4f(LOCATIONS.aIC, color[0], color[1], color[2], part.tint ?? 1);
        gl.vertexAttrib4f(LOCATIONS.aIE, emission[0], emission[1], emission[2], flags(part));
      };
      // parts alike drawn together: the batches of one shape (buffers shared) on solid parts of one material, every
      // copy's matrix and the part's state in one buffer, so a pass draws them in one call (bolts, a scene of
      // thousands of parts alike). Only the passes over every solid part use them
      const groupOf = groupsOf(opaque, flags, colour);
      // cull: back faces are being culled in this pass, so a two-sided batch is drawn with culling off
      const each = (prog, list, perPart, cull = false) => {
        lastSent.clear();
        const uniforms = prog.uniforms,
          together = list === opaque && groupOf.size,
          done = new Set();
        for (const part of list) {
          if (together && part.batches.every((batch) => groupOf.has(batch))) {
            // (all of it drawn with others: nothing of its own to set)
            for (const batch of part.batches) {
              const group = groupOf.get(batch);
              if (done.has(group)) continue;
              done.add(group);
              gl.uniformMatrix4fv(uniforms.uModel, false, IDENTITY);
              if (perPart) perPart(part); // (what a group shares: its material)
              bindBatch(prog, group.batch);
              drawBatch(group.batch);
            }
            continue;
          }
          gl.uniformMatrix4fv(uniforms.uModel, false, part.matrix);
          state(part);
          if (perPart) perPart(part);
          for (const batch of part.batches) {
            bindBatch(prog, batch);
            if (cull && batch.mesh.twoSided) {
              gl.disable(gl.CULL_FACE);
              drawBatch(batch);
              gl.enable(gl.CULL_FACE);
            } else drawBatch(batch);
          }
        }
        unbind();
      };
      // the edges of these parts, over their faces (blended, not written to depth)
      const edgeLines = (list) => {
        if (!can('edge')) return;
        const edgeProgram = optionalProgram('edge');
        common(edgeProgram, frame);
        gl.uniform2f(edgeProgram.uniforms.uView, width / 2, height / 2);
        gl.uniform1f(edgeProgram.uniforms.uWidth, 0.4 * frame.dpr + 0.5);
        gl.uniform3fv(edgeProgram.uniforms.uLight, frame.look.light);
        // the edges a little lighter than the outline, so the outline reads first; a lit part's light
        const lineColor = frame.look.solid
            ? frame.look.ink.map((channel, i) => channel + (frame.look.solid[i] - channel) * 0.2)
            : frame.look.ink,
          litColor = frame.look.ink.map((channel) => channel + (1 - channel) * 0.75);
        gl.uniform3fv(edgeProgram.uniforms.uColor, lineColor);
        gl.uniform3fv(edgeProgram.uniforms.uLit, frame.look.kind === 2 ? litColor : lineColor); // (a lit part's edges, by its tint: pen only)
        gl.enable(gl.BLEND);
        blendOver();
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        const together = list === opaque && groupOf.size,
          done = new Set();
        for (const part of list) {
          if (together && part.batches.every((batch) => groupOf.has(batch))) {
            for (const batch of part.batches) {
              const group = groupOf.get(batch),
                cache = group.cache;
              if (!cache.gpu.edgeBuffer || done.has(cache)) continue; // (a shape's edges come after the first picture)
              done.add(cache);
              gl.uniformMatrix4fv(edgeProgram.uniforms.uModel, false, IDENTITY);
              gl.uniform1f(edgeProgram.uniforms.uAlpha, 1);
              vertexArrays.bind(
                cache.edgeVertexArray ||
                  (cache.edgeVertexArray = makeVertexArray(cache.gpu, cache.buffer, GROUP_STRIDE, true)),
              );
              instancing.drawArrays(gl.TRIANGLES, cache.gpu.edgeVertexCount, group.copyCount);
            }
            continue;
          }
          gl.uniformMatrix4fv(edgeProgram.uniforms.uModel, false, part.matrix);
          state(part);
          gl.uniform1f(edgeProgram.uniforms.uAlpha, part.drawAlpha);
          for (const batch of part.batches) {
            const gpu = batch.gpu;
            if (!gpu || !gpu.edgeBuffer) continue;
            vertexArrays.bind(
              gpu.edgeVertexArray || (gpu.edgeVertexArray = makeVertexArray(gpu, gpu.placements, 64, true)),
            );
            instancing.drawArrays(gl.TRIANGLES, gpu.edgeVertexCount, gpu.instanceCount);
          }
        }
        vertexArrays.bind(null);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      };
      // 1. the shadow map, from the key light, around what is on screen now. Kept while nothing that casts a shadow
      // moves (turning the camera does not change it): compared on the parts' matrices and the light's frame
      /** @type {Float32Array | null} */
      let lightVP = null;
      // (the sun every look shades by: one shadow, drawn in each look's own way on the ground)
      const sun = frame.look.light;
      if (shadow && frame.shadows && !moved(shadowKey, opaque, frame, [...frame.bounds.center, ...sun]))
        lightVP = shadowVP;
      else if (shadow && frame.shadows) {
        const center = frame.bounds.center,
          radius = frame.bounds.radius * 1.05,
          toLight = norm(sun),
          eye = add(center, mulv(toLight, radius * 2));
        lightVP = M.mul(
          M.ortho(-radius, radius, -radius, radius, 0.01, radius * 4),
          M.look(eye, center, Math.abs(toLight[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]),
        );
        gl.bindFramebuffer(gl.FRAMEBUFFER, shadow.framebuffer);
        gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.colorMask(false, false, false, false);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        common(programs.depth, frame, lightVP);
        each(programs.depth, opaque, null, true);
        gl.colorMask(true, true, true, true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        shadowVP = lightVP;
      }
      gl.viewport(0, 0, width, height);
      // a theme's page is a plain colour: drawn here, opaque, so whatever is blended later blends over it exactly
      const fill = frame.look.fill;
      if (fill) gl.clearColor(fill[0], fill[1], fill[2], 1);
      else gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const lookUniforms = lookProgram.uniforms;
      // (the look's uniforms: for the parts, and for their caps on the cut's plane)
      const setLook = (prog) => {
        const uniforms = prog.uniforms;
        common(prog, frame);
        gl.uniform3fv(uniforms.uLight, frame.look.light);
        gl.uniform3fv(uniforms.uCap, frame.look.cap);
        if (uniforms.uHatch) {
          gl.uniform3fv(uniforms.uFwd, frame.forward);
          gl.uniform1f(uniforms.uOrtho, frame.viewDistance ? 1 : 0);
          gl.uniform1f(uniforms.uHatch, frame.hatch || 0.02);
        }
        gl.uniform1f(uniforms.uDpr, frame.dpr);
        gl.uniform1f(uniforms.uAOk, frame.ao ? 1 : 0);
        gl.uniform1f(uniforms.uAlpha, 1);
        if (uniforms.uPaper) gl.uniform3fv(uniforms.uPaper, frame.look.paper);
        if (uniforms.uSolid) gl.uniform3fv(uniforms.uSolid, frame.look.solid);
      };
      setLook(lookProgram);
      if (hifi && kind === 1) {
        if (!env) {
          makeEnv();
          if (!env) return false;
          gl.viewport(0, 0, width, height);
          gl.useProgram(lookProgram.program);
        }
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, env.texture);
        gl.uniform1i(lookUniforms.uEnv, 1);
        gl.uniform1f(lookUniforms.uEnvMax, ENV_LEVELS - 1);
        gl.uniform1f(lookUniforms.uExposure, 1.0);
        // each sampler on its own unit, even unused (one left on unit 0 would meet the shadow map's depth texture)
        gl.uniform1i(lookUniforms.uBack, 3);
        gl.uniform1i(lookUniforms.uBase, 4);
        gl.uniform1i(lookUniforms.uNorm, 5);
        gl.uniform1i(lookUniforms.uMR, 6);
      }
      if (shadow && lookUniforms.uShadow) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, shadow.texture);
        gl.uniform1i(lookUniforms.uShadow, 2);
        gl.uniform1f(lookUniforms.uShadowTexel, 1 / SHADOW_SIZE);
        gl.uniformMatrix4fv(lookUniforms.uLightVP, false, lightVP || NO_SHADOW);
      }
      // 2. the outline (ink, and thinner in pen): back faces pushed out along the averaged normals, drawn flat
      if (ink || pen) {
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.FRONT);
        gl.uniform1f(lookUniforms.uFlat, 1);
        gl.uniform3fv(lookUniforms.uColor, frame.look.ink);
        gl.uniform1f(lookUniforms.uAlpha, 1);
        // (the same width on screen whatever the canvas's size: about a pixel in pen, a pixel and a half in ink)
        gl.uniform1f(lookUniforms.uOutline, ((pen ? 2.2 : 3) * frame.dpr * frame.tanHalf) / height);
        each(lookProgram, opaque);
      }
      // 3. the solid parts (with the section on, both faces: the inside of a cut part shows as a cap)
      gl.uniform1f(lookUniforms.uFlat, 0);
      gl.uniform1f(lookUniforms.uOutline, 0);
      if (frame.cut) gl.disable(gl.CULL_FACE);
      else {
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
      }
      // (a part's material; its colour, glow and flags come with its state)
      const setMaterial = (part) => {
        setVec3(lookUniforms.uMat, part.metalRoughness);
        setFloat(lookUniforms.uAlpha, part.drawAlpha);
        if (lookUniforms.uSurf) {
          setVec3(lookUniforms.uSurf, part.surfaceDetail);
          setFloat(lookUniforms.uRefr, backdrop && part.drawAlpha < 0.99 ? part.refract : 0);
        }
      };
      each(lookProgram, opaque, setMaterial, !frame.cut);
      if (capped) {
        // the caps again, on the cut's plane, where it lies inside their part: there the part's faces beyond it, back
        // faces counted up and front ones down (whatever hides them), leave a count other than zero in the stencil. Part
        // by part, so a part buried in another (its back faces nearer than the other's) shows no cap where the plane
        // passes outside it
        const capsProgram = capProgram(kind);
        setLook(capsProgram);
        gl.enable(gl.STENCIL_TEST);
        gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
        gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.INCR_WRAP); // (in the caps too: nonzero stays nonzero)
        for (const part of opaque)
          if (part.cut) {
            gl.clear(gl.STENCIL_BUFFER_BIT);
            gl.stencilFunc(gl.ALWAYS, 0, 255);
            gl.colorMask(false, false, false, false);
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.CULL_FACE);
            each(capsProgram, [part]);
            // then its caps (back faces), where the count is not zero
            gl.stencilFunc(gl.NOTEQUAL, 0, 255);
            gl.colorMask(true, true, true, true);
            gl.enable(gl.DEPTH_TEST);
            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.FRONT);
            each(capsProgram, [part]);
          }
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.STENCIL_TEST);
        gl.useProgram(lookProgram.program);
      }
      if (frame.edges) {
        edgeLines(opaque);
        gl.useProgram(lookProgram.program);
      }
      // 4. the ground: the model's shadow and a soft contact shadow, blended onto the background
      if (frame.ground) {
        const groundProgram = programs.ground;
        gl.useProgram(groundProgram.program);
        gl.enable(gl.BLEND);
        blendOver();
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        gl.uniformMatrix4fv(groundProgram.uniforms.uVP, false, frame.viewProjection);
        gl.uniform3fv(groundProgram.uniforms.uCenter, frame.ground.center);
        gl.uniform1f(groundProgram.uniforms.uRadius, frame.ground.radius);
        gl.uniform1f(groundProgram.uniforms.uY, frame.ground.y);
        gl.uniform1f(groundProgram.uniforms.uStyle, kind);
        gl.uniform3fv(groundProgram.uniforms.uShade, frame.look.shade);
        gl.uniform1f(groundProgram.uniforms.uDpr, frame.dpr);
        gl.uniform1f(groundProgram.uniforms.uContact, frame.ground.contact);
        // pen: a wider, softer shadow, darker on a dark page
        gl.uniform1f(groundProgram.uniforms.uBlur, pen ? 7 : 2);
        gl.uniform1f(groundProgram.uniforms.uShadowK, pen ? (frame.look.dark ? 0.6 : 0.34) : 0.3);
        if (shadow && groundProgram.uniforms.uShadow) {
          gl.activeTexture(gl.TEXTURE2); // (bound here too: the pen look's own program does not sample it)
          gl.bindTexture(gl.TEXTURE_2D, shadow.texture);
          gl.activeTexture(gl.TEXTURE0);
          gl.uniform1i(groundProgram.uniforms.uShadow, 2);
          gl.uniform1f(groundProgram.uniforms.uShadowTexel, 1 / SHADOW_SIZE);
          gl.uniformMatrix4fv(groundProgram.uniforms.uLightVP, false, lightVP || NO_SHADOW);
        }
        fullscreen(groundProgram);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
      // 4b. balls: solid, so they hide each other by depth (no sorting), and behind glass, which tints them
      if (ballSets.length && can('balls')) {
        const ballProgram = optionalProgram('balls');
        common(ballProgram, frame);
        gl.uniform3fv(ballProgram.uniforms.uInk, frame.look.ink);
        gl.uniform1f(ballProgram.uniforms.uStudio, kind);
        for (const particleSet of ballSets) {
          particleSet.update();
          let uploaded = ballBuffers.get(particleSet);
          if (!uploaded) ballBuffers.set(particleSet, (uploaded = { buffer: gl.createBuffer(), version: NaN }));
          enableOnly([0]);
          gl.bindBuffer(gl.ARRAY_BUFFER, uploaded.buffer);
          if (particleSet.version === undefined || particleSet.version !== uploaded.version) {
            gl.bufferData(
              gl.ARRAY_BUFFER,
              particleSet.positionsAndColors.subarray(0, particleSet.count * 4),
              gl.DYNAMIC_DRAW,
            );
            uploaded.version = particleSet.version;
          }
          gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
          instancing.setDivisor(0, 0);
          gl.uniform3fv(ballProgram.uniforms.uC0, particleSet.ramp[0]);
          gl.uniform3fv(ballProgram.uniforms.uC1, particleSet.ramp[1]);
          gl.uniform3fv(ballProgram.uniforms.uC2, particleSet.ramp[2]);
          gl.uniform1f(ballProgram.uniforms.uSize, 2 * particleSet.radius * frame.pxPerUnit);
          gl.drawArrays(gl.POINTS, 0, particleSet.count);
        }
      }
      // 5. see-through parts, far to near, without writing depth
      const refracting = seeThrough.length && lookUniforms.uBack && seeThrough.some((part) => part.refract > 0);
      if (backdrop && !refracting) {
        gl.deleteTexture(backdrop.texture); // (no glass that bends light on screen: its copy of the picture goes)
        backdrop = null;
      }
      if (seeThrough.length) {
        // glass that bends the light (refract, WebGL 2): it samples a copy of the picture behind it, made once
        if (refracting) {
          gl.activeTexture(gl.TEXTURE3); // (made and bound on its own unit: the shadow map stays on unit 2)
          if (!backdrop || backdrop.width !== width || backdrop.height !== height) {
            if (backdrop) gl.deleteTexture(backdrop.texture);
            backdrop = { texture: makeTexture(width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE), width, height };
          }
          gl.bindTexture(gl.TEXTURE_2D, backdrop.texture);
          gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
          gl.useProgram(lookProgram.program);
          gl.uniform2f(lookUniforms.uView, width, height);
          gl.activeTexture(gl.TEXTURE0);
        }
        gl.useProgram(lookProgram.program);
        gl.enable(gl.BLEND);
        blendOver();
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        const sorted = seeThrough
          .map((part) => [part, len(sub(M.pt(part.matrix, part.center), frame.eye))])
          .sort((a, b) => b[1] - a[1])
          .map(([part]) => part);
        each(lookProgram, sorted, setMaterial);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        if (frame.edges) edgeLines(sorted);
      }
      // 6. particles
      if (pointSets.length && can('points')) {
        const pointProgram = optionalProgram('points');
        common(pointProgram, frame);
        gl.enable(gl.BLEND);
        blendOver();
        gl.depthMask(false);
        for (const particleSet of pointSets) {
          particleSet.update();
          enableOnly([0]);
          gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, particleSet.positionsAndColors, gl.DYNAMIC_DRAW);
          gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
          instancing.setDivisor(0, 0);
          gl.uniform3fv(pointProgram.uniforms.uColor, particleSet.color);
          gl.uniform1f(pointProgram.uniforms.uAlpha, 0.95);
          gl.uniform1f(pointProgram.uniforms.uSize, particleSet.size * frame.dpr * 4);
          gl.drawArrays(gl.POINTS, 0, particleSet.count);
        }
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
      // 6b. flow streaks: hidden by solid parts, not hiding anything themselves; ink over a light page (never added,
      // which would wash out into the paper), light added on a dark one
      if (flows.length) {
        gl.enable(gl.BLEND);
        if (frame.look.dark) gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        else gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        for (const flow of flows) {
          const onGPU = placesFlow(flow),
            name = onGPU ? 'flowGPU' : 'flow';
          if (!can(name)) continue;
          const flowProgram = programs[name],
            { attributes, uniforms } = flowProgram;
          common(flowProgram, frame);
          gl.uniform2f(uniforms.uView, width / 2, height / 2);
          flow.colors.forEach((color, i) => gl.uniform3fv(uniforms['uC' + i], color));
          gl.uniform1f(uniforms.uAlpha, flow.opacity);
          gl.uniform1f(uniforms.uWidth, (Math.max(1.25, flow.width) / 2 + 0.5) * frame.dpr);
          if (onGPU) {
            // one streak drawn as many times as there are: its corners, each copy with its streak's fixed numbers
            const held = gpuFlowOf(flow),
              seeds = [attributes.aSeedA, attributes.aSeedB, attributes.aSeedC];
            streakTemplate ??= {
              corners: makeBuffer(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1, 2, -1, 2, 1, 3, -1, 3, 1])),
              indices: makeBuffer(flowIndices(1), gl.ELEMENT_ARRAY_BUFFER),
            };
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, streakTemplate.indices);
            enableOnly([attributes.aCorner, ...seeds]);
            gl.bindBuffer(gl.ARRAY_BUFFER, streakTemplate.corners);
            gl.vertexAttribPointer(attributes.aCorner, 2, gl.FLOAT, false, 0, 0);
            instancing.setDivisor(attributes.aCorner, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, held.seeds);
            seeds.forEach((location, k) => {
              gl.vertexAttribPointer(location, k < 2 ? 4 : 3, gl.FLOAT, false, 48, 16 * k);
              instancing.setDivisor(location, 1);
            });
            gl.activeTexture(gl.TEXTURE8);
            gl.bindTexture(gl.TEXTURE_2D, held.texture);
            gl.activeTexture(gl.TEXTURE0);
            gl.uniform1i(uniforms.uPaths, 8);
            gl.uniformMatrix4fv(uniforms.uM, false, flow.owner ? flow.owner.matrix : IDENTITY);
            gl.uniform4f(uniforms.uFlow, flow.travelled, flow.length, flow.spread, flow.closed ? 1 : 0);
            instancing.drawElements(gl.TRIANGLES, 18, gl.UNSIGNED_SHORT, 0, flow.drawnCount);
            for (const location of seeds) instancing.setDivisor(location, 0);
            continue;
          }
          if (!flowIndexBuffer) flowIndexBuffer = makeBuffer(flowIndices(MAX_STREAKS), gl.ELEMENT_ARRAY_BUFFER);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, flowIndexBuffer);
          enableOnly([attributes.aPos, attributes.aDir, attributes.aA]);
          let flowBuffer = flowBuffers.get(flow);
          if (!flowBuffer)
            flowBuffers.set(flow, (flowBuffer = makeBuffer(flow.vertices, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW)));
          gl.bindBuffer(gl.ARRAY_BUFFER, flowBuffer);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, flow.vertices.subarray(0, flow.drawnCount * 8 * STRIDE));
          gl.vertexAttribPointer(attributes.aPos, 4, gl.FLOAT, false, STRIDE * 4, 0);
          gl.vertexAttribPointer(attributes.aDir, 4, gl.FLOAT, false, STRIDE * 4, 16);
          gl.vertexAttribPointer(attributes.aA, 1, gl.FLOAT, false, STRIDE * 4, 32);
          for (const location of [attributes.aPos, attributes.aDir, attributes.aA]) instancing.setDivisor(location, 0);
          gl.drawElements(gl.TRIANGLES, flow.drawnCount * 18, gl.UNSIGNED_SHORT, 0);
        }
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
      // 6c. streams: the solid parts' depth (WebGL 2: the march stops behind them), the streams marched into a picture of
      // half the size, then that picture put over this one (ink over a light page, light added on a dark one)
      const streams = (frame.streams || []).filter((stream) => stream.visible && stream.density > 0);
      if (streams.length && can('stream') && can('copy')) {
        const halfWidth = Math.max(1, width >> 1),
          halfHeight = Math.max(1, height >> 1);
        if (!streamTargets || streamTargets.width !== width || streamTargets.height !== height) {
          if (streamTargets) {
            gl.deleteTexture(streamTargets.color);
            gl.deleteFramebuffer(streamTargets.colorFramebuffer);
            gl.deleteRenderbuffer(streamTargets.hullDepth);
            if (streamTargets.depth) {
              gl.deleteTexture(streamTargets.depth);
              gl.deleteFramebuffer(streamTargets.depthFramebuffer);
            }
          }
          streamTargets = { width, height, key: [] };
          [streamTargets.color, streamTargets.colorFramebuffer] = framebufferFor(
            makeTexture(halfWidth, halfHeight, gl2 ? gl.RGBA8 : gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE),
            gl.COLOR_ATTACHMENT0,
          );
          // (its own depth: each hull's farthest face, so a pixel is marched once however the hull folds)
          streamTargets.hullDepth = gl.createRenderbuffer();
          gl.bindRenderbuffer(gl.RENDERBUFFER, streamTargets.hullDepth);
          gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, halfWidth, halfHeight);
          gl.bindFramebuffer(gl.FRAMEBUFFER, streamTargets.colorFramebuffer);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, streamTargets.hullDepth);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          if (programs.depth)
            [streamTargets.depth, streamTargets.depthFramebuffer] = framebufferFor(
              makeTexture(width, height, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST),
              gl.DEPTH_ATTACHMENT,
            );
        }
        // the solid parts' depth, drawn again only when they or the camera moved (a stream alone moving keeps it)
        if (streamTargets.depth && moved(streamTargets.key, opaque, frame, frame.viewProjection)) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, streamTargets.depthFramebuffer);
          gl.viewport(0, 0, width, height);
          gl.clear(gl.DEPTH_BUFFER_BIT);
          gl.colorMask(false, false, false, false);
          if (frame.cut)
            gl.disable(gl.CULL_FACE); // (a cut part's inside shows: it hides what is behind it)
          else {
            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.BACK);
          }
          common(programs.depth, frame);
          each(programs.depth, opaque, null, !frame.cut);
          gl.colorMask(true, true, true, true);
        }
        const streamProgram = optionalProgram('stream'),
          streamUniforms = streamProgram.uniforms;
        gl.bindFramebuffer(gl.FRAMEBUFFER, streamTargets.colorFramebuffer);
        gl.viewport(0, 0, halfWidth, halfHeight);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.FRONT); // (the far side of each hull: the march goes from there towards the eye)
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        common(streamProgram, frame);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, streamTargets.depth || null);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(streamUniforms.uDepth, 3);
        gl.uniform1f(streamUniforms.uHasDepth, streamTargets.depth ? 1 : 0);
        gl.uniform2f(streamUniforms.uView, halfWidth, halfHeight);
        gl.uniform1f(streamUniforms.uOrtho, frame.viewDistance ? 1 : 0);
        gl.uniform3fv(streamUniforms.uFwd, frame.forward);
        enableOnly([streamProgram.attributes.aPos]);
        instancing.setDivisor(streamProgram.attributes.aPos, 0);
        // far to near, each over the ones behind it; each hull's farthest face first (depth only), then marched from there
        const far = (stream) => dot(sub(stream.center, frame.eye), frame.forward);
        gl.enable(gl.DEPTH_TEST);
        gl.clearDepth(0);
        for (const stream of streams.sort((a, b) => far(b) - far(a))) {
          let hullBuffer = hullBuffers.get(stream);
          if (!hullBuffer)
            hullBuffers.set(
              stream,
              (hullBuffer = {
                positions: makeBuffer(stream.hull.positions),
                indices: makeBuffer(stream.hull.indices, gl.ELEMENT_ARRAY_BUFFER),
              }),
            );
          gl.bindBuffer(gl.ARRAY_BUFFER, hullBuffer.positions);
          gl.vertexAttribPointer(streamProgram.attributes.aPos, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, hullBuffer.indices);
          gl.uniform4fv(streamUniforms['uPts[0]'], stream.pointTable);
          gl.uniform3fv(streamUniforms['uTab[0]'], stream.table);
          gl.uniform1i(streamUniforms.uN, stream.pointCount);
          stream.colors.forEach((color, i) => gl.uniform3fv(streamUniforms['uC' + i], color));
          gl.uniform4f(streamUniforms.uF, stream.phase, stream.scale, stream.reach, stream.turbulence);
          gl.uniform3f(streamUniforms.uLo, stream.box[0][0], stream.box[1][0], stream.box[2][0]);
          gl.uniform3f(streamUniforms.uHi, stream.box[0][1], stream.box[1][1], stream.box[2][1]);
          gl.uniform3f(streamUniforms.uG, stream.swirl, stream.total, stream.fade ?? 0.7);
          gl.uniform1f(streamUniforms.uDen, stream.density);
          gl.depthMask(true); // (before the clear: a depth buffer is cleared only where it may be written)
          gl.clear(gl.DEPTH_BUFFER_BIT);
          gl.depthFunc(gl.GREATER);
          gl.colorMask(false, false, false, false);
          gl.drawElements(gl.TRIANGLES, stream.hull.indices.length, gl.UNSIGNED_SHORT, 0);
          gl.depthFunc(gl.EQUAL);
          gl.depthMask(false);
          gl.colorMask(true, true, true, true);
          gl.drawElements(gl.TRIANGLES, stream.hull.indices.length, gl.UNSIGNED_SHORT, 0);
        }
        gl.clearDepth(1);
        gl.depthFunc(gl.LESS);
        gl.depthMask(true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        const copyProgram = optionalProgram('copy');
        gl.useProgram(copyProgram.program);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, streamTargets.color);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(copyProgram.uniforms.uTex, 3);
        if (frame.look.dark) gl.blendFunc(gl.ONE, gl.ONE);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.DEPTH_TEST);
        fullscreen(copyProgram);
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
      }
      // 7. glow around glowing parts (WebGL 2)
      const glowing =
        hifi &&
        frame.parts.some(
          (part) => part.drawAlpha > 0.01 && part.emission[0] + part.emission[1] + part.emission[2] > 0.01,
        );
      if (
        glowing &&
        (glowPrograms(), [programs.glow, programs.blur, programs.add].every((prog) => ready(prog, true)))
      ) {
        const targets = glowTargets(width, height),
          glowProgram = programs.glow;
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets.emissionFramebuffer);
        gl.viewport(0, 0, targets.halfWidth, targets.halfHeight);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        common(glowProgram, frame);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        if (frame.cut) gl.disable(gl.CULL_FACE);
        // what glows, and what hides it: opaque parts only (glass and an x-rayed casing let the glow through)
        each(
          glowProgram,
          frame.parts.filter(
            (part) =>
              part.drawAlpha >= 0.99 ||
              (part.drawAlpha > 0.01 && part.emission[0] + part.emission[1] + part.emission[2] > 0.01),
          ),
        );
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        const blurProgram = programs.blur;
        gl.useProgram(blurProgram.program);
        gl.uniform1i(blurProgram.uniforms.uTex, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets.blurAFramebuffer);
        gl.viewport(0, 0, targets.quarterWidth, targets.quarterHeight);
        gl.bindTexture(gl.TEXTURE_2D, targets.emission);
        gl.uniform2f(blurProgram.uniforms.uDir, 1 / targets.halfWidth, 0);
        fullscreen(blurProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets.blurBFramebuffer);
        gl.bindTexture(gl.TEXTURE_2D, targets.blurA);
        gl.uniform2f(blurProgram.uniforms.uDir, 0, 1 / targets.quarterHeight);
        fullscreen(blurProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets.blurAFramebuffer);
        gl.bindTexture(gl.TEXTURE_2D, targets.blurB);
        gl.uniform2f(blurProgram.uniforms.uDir, 2 / targets.quarterWidth, 0);
        fullscreen(blurProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets.blurBFramebuffer);
        gl.bindTexture(gl.TEXTURE_2D, targets.blurA);
        gl.uniform2f(blurProgram.uniforms.uDir, 0, 2 / targets.quarterHeight);
        fullscreen(blurProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        const addProgram = programs.add;
        gl.useProgram(addProgram.program);
        gl.uniform1i(addProgram.uniforms.uTex, 0);
        gl.bindTexture(gl.TEXTURE_2D, targets.blurB);
        gl.uniform1f(addProgram.uniforms.uGain, ink ? 0.9 : pen && !frame.look.dark ? 0.5 : 1.4);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
        fullscreen(addProgram);
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
      }
      return true;
    },
    // what a removed thing held on the GPU: a ball set's buffer, a stream's hull, a flow's streaks, or a batch of its
    // own (lines: never shared with another)
    release(thing) {
      const placed = flowsOnGPU.get(thing); // (a flow placed on the GPU: its paths' texture and its streaks' numbers)
      if (placed) {
        gl.deleteTexture(placed.texture);
        gl.deleteBuffer(placed.seeds);
        flowsOnGPU.delete(thing);
      }
      for (const cache of [ballBuffers, hullBuffers, flowBuffers]) {
        const held = cache.get(thing);
        if (held)
          for (const buffer of held.buffer ? [held.buffer] : held.positions ? [held.positions, held.indices] : [held])
            gl.deleteBuffer(buffer);
        cache.delete(thing);
      }
      const gpu = thing.gpu;
      if (gpu && thing.dynamic) {
        for (const key of [
          'positions',
          'normals',
          'outlineNormals',
          'colors',
          'ao',
          'indices',
          'placements',
          'uv',
          'edgeBuffer',
        ])
          if (gpu[key]) gl.deleteBuffer(gpu[key]);
        if (gpu.vertexArray) vertexArrays.delete(gpu.vertexArray);
        if (gpu.edgeVertexArray) vertexArrays.delete(gpu.edgeVertexArray);
        thing.gpu = null;
      }
    },
    dispose() {
      const extension = gl.getExtension('WEBGL_lose_context');
      if (extension) extension.loseContext();
    },
  };
}

export { glRenderer, ENVS };
