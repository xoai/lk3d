// The WebGL renderer, for WebGL 2 (the hi-fi path: physically based materials lit by a generated studio environment,
// soft shadows, glow) and WebGL 1 (the same scene, simpler light). Every renderer has the same small interface
// ({kind, hifi, draw(frame), setAO(batch), dispose()}), so another backend (WebGPU) can be added beside it.
import * as S from './shaders.js';
import { M, sub, len, mulv, add, norm, dot } from './math.js';
import { flowIndices, STRIDE, MAX } from './flow.js';

// (uViewD: in ortho, the distance every point is drawn as from; 0 in perspective, where nearer points are larger)
const PVS = `attribute vec4 aPos; uniform mat4 uVP; uniform float uSize; uniform vec3 uEye; uniform float uViewD;
void main() { gl_Position = uVP * vec4(aPos.xyz, 1.0); gl_PointSize = uSize / max(0.2, uViewD > 0.0 ? uViewD : length(aPos.xyz - uEye)); }`;
const PFS = `uniform vec3 uColor; uniform float uAlpha;
void main() { vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; gl_FragColor = vec4(uColor, uAlpha * (1.0 - smoothstep(0.15, 0.5, r))); }`;

// balls (the molecules of a gas): a point sprite shaded as a sphere, in one of three colours by aPos.w (below 1/3, up
// to 2/3, above: bands read better than a blend, whose middle is a muddy grey); in the drawn and pen looks, a rim
const DVS = `attribute vec4 aPos; uniform mat4 uVP; uniform float uSize; uniform vec3 uEye; uniform float uViewD; varying float vW;
void main() { gl_Position = uVP * vec4(aPos.xyz, 1.0); gl_PointSize = max(2.0, uSize / max(0.05, uViewD > 0.0 ? uViewD : length(aPos.xyz - uEye))); vW = aPos.w; }`;
const DFS = `uniform vec3 uC0, uC1, uC2, uInk; uniform float uStudio; varying float vW;
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
function glRenderer(gl, scene, opts = {}) {
  const gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const inst = gl2
    ? {
        div: (l, d) => gl.vertexAttribDivisor(l, d),
        draw: (m, n, t, o, c) => gl.drawElementsInstanced(m, n, t, o, c),
        arrays: (m, n, c) => gl.drawArraysInstanced(m, 0, n, c),
      }
    : (() => {
        const e = gl.getExtension('ANGLE_instanced_arrays');
        return (
          e && {
            div: (l, d) => e.vertexAttribDivisorANGLE(l, d),
            draw: (m, n, t, o, c) => e.drawElementsInstancedANGLE(m, n, t, o, c),
            arrays: (m, n, c) => e.drawArraysInstancedANGLE(m, 0, n, c),
          }
        );
      })();
  const uint = gl2 || !!gl.getExtension('OES_element_index_uint');
  const hifi = gl2 && opts.hifi !== false,
    shadowsOn = hifi && opts.shadows !== false;
  // the environment's format: half-float where it can be rendered to, else 8-bit with a shared exponent (RGBM)
  let envHalf = false;
  if (hifi && (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))) {
    const t = gl.createTexture(),
      f = gl.createFramebuffer(); // can it really be drawn into here?
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    envHalf = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(f);
    gl.deleteTexture(t);
  }
  // vertex attributes: exactly the ones the current draw uses are enabled (a stale one can fail a draw on some browsers)
  const MAXA = gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
    on = new Array(MAXA).fill(false);
  // blending over what is drawn: colour by alpha, and the canvas's own alpha by "over" too (blending alpha like colour
  // would leave a² + A(1 − a), and the page would show through opaque parts behind glass)
  const blendOver = () => gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  // every attribute at a fixed place, so one vertex array (VAO) per batch serves every program that draws parts
  const LOC = {
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
  const vx = gl2
    ? { make: () => gl.createVertexArray(), bind: (v) => gl.bindVertexArray(v), del: (v) => gl.deleteVertexArray(v) }
    : (() => {
        const e = gl.getExtension('OES_vertex_array_object');
        return (
          e && {
            make: () => e.createVertexArrayOES(),
            bind: (v) => e.bindVertexArrayOES(v),
            del: (v) => e.deleteVertexArrayOES(v),
          }
        );
      })();
  // (every WebGL 2, and nearly every WebGL 1, has both; a device that lacks either draws the figure in 2D)
  if (!inst || !vx) throw new Error('lk3d: this WebGL has no instancing or no vertex arrays');
  const only = (locs) => {
    for (let l = 0; l < MAXA; l++) {
      const want = locs.includes(l);
      if (want !== on[l]) {
        want ? gl.enableVertexAttribArray(l) : gl.disableVertexAttribArray(l);
        on[l] = want;
      }
    }
  };

  // ---- programs. Compiling shaders is what makes a first visit slow (about a second on a phone, measured): so only the
  // programs a picture needs are compiled, and where the browser can compile in the background
  // (KHR_parallel_shader_compile) nothing waits for them: draw() answers false until they are ready, and the engine
  // simply tries again on the next frame.
  const par = gl.getExtension('KHR_parallel_shader_compile');
  const program = (vs, fs, defs = []) => {
    const mk = (type, src, stage) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, S.header(gl2, stage, defs) + src);
      gl.compileShader(sh);
      return sh;
    };
    const p = gl.createProgram(),
      v = mk(gl.VERTEX_SHADER, vs, 'vs'),
      f = mk(gl.FRAGMENT_SHADER, fs, 'fs');
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    for (const [k, l] of Object.entries(LOC)) gl.bindAttribLocation(p, l, k); // (the same place in every program)
    gl.linkProgram(p);
    return { p, v, f, ok: false };
  };
  // is it compiled? (wait: true blocks until it is, for work that cannot be put off)
  // a program ready to use? (its uniforms and attributes looked up once.) One that does not link throws, unless it is
  // optional (an effect: streaks, streams, edges, particles, glow): that one is left out, and the rest still draws
  const ready = (prog, wait = false) => {
    if (prog.ok) return true;
    if (prog.failed || gl.isContextLost()) return false;
    if (!wait && par && !gl.getProgramParameter(prog.p, par.COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(prog.p, gl.LINK_STATUS)) {
      const log = gl.getShaderInfoLog(prog.f) || gl.getShaderInfoLog(prog.v) || gl.getProgramInfoLog(prog.p);
      if (!prog.optional) throw new Error('lk3d shader: ' + log);
      prog.failed = true;
      if (typeof console !== 'undefined') console.warn('lk3d: an effect is left out on this device: ' + log);
      return false;
    }
    const p = prog.p,
      u = {},
      a = {},
      nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS),
      na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let k = 0; k < nu; k++) {
      const i = gl.getActiveUniform(p, k);
      u[i.name] = gl.getUniformLocation(p, i.name);
    }
    for (let k = 0; k < na; k++) {
      const i = gl.getActiveAttrib(p, k);
      a[i.name] = gl.getAttribLocation(p, i.name);
    }
    Object.assign(prog, { u, a, ok: true });
    return true;
  };
  const studioDefs = [
    ...(hifi ? ['HIFI'] : []),
    ...(shadowsOn ? ['SHADOWS'] : []),
    ...(hifi && !envHalf ? ['RGBM'] : []),
  ];
  const P = {
    ink: program(S.PART_VS, S.PART_FS, ['INK', ...(shadowsOn ? ['SHADOWS'] : [])]),

    ground: program(S.GROUND_VS, S.GROUND_FS, shadowsOn ? ['SHADOWS'] : []),
  };
  if (shadowsOn) P.depth = program(S.PART_VS, S.DEPTH_FS);
  // particles along paths and solid balls: compiled only for a figure that has them
  const lazy = (name) =>
    P[name] ||
    (P[name] = Object.assign(
      name === 'pts'
        ? program(PVS, PFS)
        : name === 'flow'
          ? program(S.FLOW_VS, S.FLOW_FS)
          : name === 'edge'
            ? program(S.EDGE_VS, S.EDGE_FS)
            : name === 'stream'
              ? program(S.STREAM_VS, S.STREAM_FS)
              : name === 'copy'
                ? program(S.QUAD_VS, S.COPY_FS)
                : program(DVS, DFS),
      { optional: true },
    ));
  // the pen look: compiled when first needed (no shadows: its light turns with the camera, and its ground is a halo)
  const penProg = () => P.pen || (P.pen = program(S.PART_VS, S.PART_FS, ['PEN']));
  // the studio look, its environment and the glow: compiled when first needed, or ahead of time in the background once
  // the first picture is up (only where that does not block)
  const studioProgs = () => {
    if (!P.studio) P.studio = program(S.PART_VS, S.PART_FS, studioDefs);
    if (hifi && !P.envGen) {
      P.envGen = program(S.QUAD_VS, S.ENV_FS, envHalf ? [] : ['RGBM']);
      P.envPre = program(S.QUAD_VS, S.PREFILTER_FS, envHalf ? [] : ['RGBM']);
    }
  };
  const glowProgs = () => {
    if (!P.glow) {
      P.glow = Object.assign(program(S.PART_VS, S.GLOW_FS), { optional: true });
      P.blur = Object.assign(program(S.QUAD_VS, S.BLUR_FS), { optional: true });
      P.add = Object.assign(program(S.QUAD_VS, S.ADD_FS), { optional: true });
    }
  };

  // ---- geometry: compressed vertices, one buffer set per batch, a matrix per instance
  const buf = (data, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) => {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, usage);
    return b;
  };
  const byGeo = new WeakMap(); // a geometry's buffers, shared by every batch that draws it (parts alike)
  function upload(b) {
    const g = b.geo,
      im0 = new Float32Array(b.mats.length * 16);
    b.mats.forEach((m, i) => im0.set(m, 16 * i));
    const base = byGeo.get(g);
    if (base) {
      b.gl = {
        ...base,
        vao: null, // (its own vertex arrays: they hold its own placements)
        evao: null,
        inst: buf(im0, gl.ARRAY_BUFFER, b.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW),
        count: b.mats.length,
      };
      return;
    }
    const n = g.count,
      lo = [1e9, 1e9, 1e9],
      hi = [-1e9, -1e9, -1e9];
    for (let k = 0; k < n; k++)
      for (let a = 0; a < 3; a++) {
        const v = g.p[3 * k + a];
        if (v < lo[a]) lo[a] = v;
        if (v > hi[a]) hi[a] = v;
      }
    const qs = [0, 1, 2].map((a) => Math.max(1e-9, (hi[a] - lo[a]) / 2)),
      qo = [0, 1, 2].map((a) => (hi[a] + lo[a]) / 2);
    const pos = new Int16Array(n * 4),
      nrm = new Int8Array(n * 4),
      out = new Int8Array(n * 4);
    for (let k = 0; k < n; k++)
      for (let a = 0; a < 3; a++) {
        pos[4 * k + a] = Math.round(((g.p[3 * k + a] - qo[a]) / qs[a]) * 32767);
        nrm[4 * k + a] = Math.round(g.n[3 * k + a] * 127);
        out[4 * k + a] = Math.round(b.out[3 * k + a] * 127);
      }
    if (n > 65535 && !uint)
      throw new Error('lk3d: a shape with more than 65535 vertices needs 32-bit indices, which this device lacks');
    const big = n > 65535;
    const col = g.c ? Uint8Array.from(g.c) : new Uint8Array(n * 4); // a vertex's own colour; alpha 0: the part's
    b.gl = {
      pos: buf(pos),
      nrm: buf(nrm),
      out: buf(out),
      col: buf(col),
      ao: buf(new Uint8Array(n).fill(255)),
      idx: buf(big ? new Uint32Array(g.i) : new Uint16Array(g.i), gl.ELEMENT_ARRAY_BUFFER),
      inst: buf(im0, gl.ARRAY_BUFFER, b.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW),
      n: g.i.length,
      type: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      qs,
      qo,
      count: b.mats.length,
      uv: g.tex && hifi ? buf(new Float32Array(g.uv)) : null,
      tex: {},
    };
    if (g.tex && hifi) maps(b.gl.tex, g.tex);
    if (!b.dynamic) byGeo.set(g, b.gl);
  }
  // a model's texture maps (studio look, WebGL 2): decoded off the main thread, at half size on a phone, and drawn once
  // ready (until then the part's own colour shows)
  let pending = 0; // texture maps still decoding
  function maps(T, tex) {
    for (const k of ['base', 'normal', 'mr'])
      if (tex[k] && typeof createImageBitmap === 'function') {
        pending++;
        // (the file's own pixels: a normal or metal-roughness map must not be colour-managed, alpha not premultiplied)
        createImageBitmap(new Blob([tex[k].bytes], { type: tex[k].mime }), {
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
        })
          .then((bm) =>
            opts.small
              ? createImageBitmap(bm, {
                  resizeWidth: Math.max(1, bm.width >> 1),
                  resizeHeight: Math.max(1, bm.height >> 1),
                  resizeQuality: 'high',
                  premultiplyAlpha: 'none',
                  colorSpaceConversion: 'none',
                })
              : bm,
          )
          .then((bm) => {
            if (gl.isContextLost()) return;
            const t = gl.createTexture();
            gl.activeTexture(gl.TEXTURE4);
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bm);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.activeTexture(gl.TEXTURE0);
            T[k] = t;
            if (opts.onTexture) opts.onTexture();
          })
          .catch(() => {}) // an image the browser cannot decode: the part keeps its colour
          .finally(() => pending--);
      }
  }
  for (const part of scene.parts) for (const b of part.batches) upload(b);
  // a batch's edges (geometry.js edgesOf, found after the first picture): two triangles a segment, each corner its end
  // and side (aPos: x, y, z, ±1), the segment's direction (aDir) and the normal of its faces (aFace)
  function edges(b) {
    const base = byGeo.get(b.geo);
    if (base && base.edge && base !== b.gl) {
      b.gl.edge = base.edge;
      b.gl.en = base.en;
      return;
    }
    const L = b.lines,
      n = L.length / 9,
      v = new Float32Array(n * 6 * 10);
    for (let s = 0; s < n; s++)
      [0, 0, 1, 0, 1, 1].forEach((end, k) => {
        const o = (6 * s + k) * 10,
          a = 9 * s + 3 * end;
        v.set([L[a], L[a + 1], L[a + 2], k === 1 || k === 3 || k === 4 ? 1 : -1], o);
        for (let j = 0; j < 3; j++) {
          v[o + 4 + j] = L[9 * s + 3 + j] - L[9 * s + j];
          v[o + 7 + j] = L[9 * s + 6 + j];
        }
      });
    if (b.gl.edge) gl.deleteBuffer(b.gl.edge);
    b.gl.edge = n ? buf(v) : null;
    b.gl.en = n * 6;
    if (base) Object.assign(base, { edge: b.gl.edge, en: b.gl.en });
  }
  // a batch whose placements change (lines: rays, field lines): its matrices again, in place
  function instances(b) {
    const im = new Float32Array(b.mats.length * 16);
    b.mats.forEach((m, i) => im.set(m, 16 * i));
    gl.bindBuffer(gl.ARRAY_BUFFER, b.gl.inst);
    gl.bufferData(gl.ARRAY_BUFFER, im, gl.DYNAMIC_DRAW);
    b.gl.count = b.mats.length;
    b.ver = (b.ver || 0) + 1; // (what casts a shadow has moved)
  }
  const quad = buf(new Float32Array([-1, -1, 0, 1, 1, -1, 0, 1, 1, 1, 0, 1, -1, -1, 0, 1, 1, 1, 0, 1, -1, 1, 0, 1]));
  const pbuf = gl.createBuffer(),
    uploads = new WeakMap(); // a ball set's buffer, and the version of its positions in it
  let fidx = null; // the flows' triangles, made once for as many streaks as a flow may have
  let sT = null; // the streams' half-size picture and the solid parts' depth
  const sbufs = new WeakMap(); // each stream's hull
  // a texture as the target of a framebuffer
  const target = (t, at) => {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, at, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return [t, fb];
  };
  const fbufs = new WeakMap(); // each flow's vertex buffer, made once at its full size and refilled in place

  // a vertex array, described once: a shape's buffers (or its edges' segments) and its copies' placements in buf, 16
  // numbers a copy (a batch's own), or 24 with the part's state (a group of parts alike: see groupsOf); bound with
  // one call per draw (a scene of thousands of parts otherwise spends most of its frame describing buffers again)
  function vao(G, buf, stride, edges) {
    const v = vx.make();
    vx.bind(v);
    const at = (l, b, size, type, norm, st = 0, off = 0, div = 0) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, size, type, norm, st, off);
      inst.div(l, div);
    };
    if (edges)
      for (const [l, n, o] of [
        [0, 4, 0],
        [10, 3, 16],
        [11, 3, 28],
      ])
        at(l, G.edge, n, gl.FLOAT, false, 40, o);
    else {
      at(0, G.pos, 4, gl.SHORT, true);
      at(1, G.nrm, 4, gl.BYTE, true);
      at(2, G.out, 4, gl.BYTE, true);
      at(3, G.ao, 1, gl.UNSIGNED_BYTE, true);
      at(4, G.col, 4, gl.UNSIGNED_BYTE, true);
      if (G.uv) at(9, G.uv, 2, gl.FLOAT, false);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, G.idx);
    }
    for (let c = 0; c < stride / 16; c++)
      at([5, 6, 7, 8, LOC.aIC, LOC.aIE][c], buf, 4, gl.FLOAT, false, stride, 16 * c, 1);
    vx.bind(null); // (bound where it is drawn: nothing else changes it by accident)
    return v;
  }
  let bound = false; // (a vertex array is bound: the default one must be put back before anything else draws)
  function bindBatch(prog, b) {
    const G = b.gl,
      u = prog.u;
    vx.bind(G.vao || (G.vao = vao(G, G.inst, 64)));
    bound = true;
    if (u.uTex) {
      // which maps this batch has, on units 4, 5, 6
      const t = [G.tex.base, G.tex.normal, G.tex.mr];
      gl.uniform3f(u.uTex, t[0] ? 1 : 0, t[1] ? 1 : 0, t[2] ? 1 : 0);
      t.forEach((x, i) => {
        if (x) {
          gl.activeTexture(gl.TEXTURE4 + i);
          gl.bindTexture(gl.TEXTURE_2D, x);
        }
      });
      gl.activeTexture(gl.TEXTURE0);
    }
    if (u.uQs) {
      // (batches of one shape share these: sent again only when the shape changes)
      set3(u.uQs, G.qs);
      set3(u.uQo, G.qo);
    }
  }
  const drawBatch = (b) => inst.draw(gl.TRIANGLES, b.gl.n, b.gl.type, 0, b.gl.count);

  // ---- parts alike in one call: groups of batches that share a shape's buffers, on solid parts of one material.
  // A group's buffer holds each copy's matrix (its part's matrix times its own placement) and its part's state (colour
  // and tint, glow and flags: the attributes aIC and aIE), 24 numbers a copy; its vertex arrays read the shape's
  // buffers and this one, so a group is drawn as one batch
  const STRIDE_G = 96,
    ID = M.id(),
    ids = new WeakMap(), // (a number for each shape's buffers, for the groups' keys)
    gcache = new Map(); // a group's buffer and vertex arrays, kept from frame to frame
  let shapes = 0;
  const shapeId = (G) => ids.get(G.pos) ?? (ids.set(G.pos, ++shapes), shapes);
  // this frame's groups: batch → its group. A part joins only when every batch of it is in a group of two or more
  // (a part drawn half alone and half with others would be drawn twice)
  function groupsOf(solid, kind, flags, colour) {
    const key = (p, b) => {
      const G = b.gl;
      if (!G || b.dynamic || G.uv || G.tex.base || G.tex.normal || G.tex.mr) return null; // (lines; textured models)
      return (b.gkey ??= shapeId(G) + '|' + p.mat + '|' + p.surf);
    };
    let parts = solid.filter((p) => p.batches.every((b) => key(p, b)));
    for (;;) {
      const n = new Map();
      for (const p of parts) for (const b of p.batches) n.set(b.gkey, (n.get(b.gkey) || 0) + 1);
      const keep = parts.filter((p) => p.batches.every((b) => n.get(b.gkey) > 1));
      if (keep.length === parts.length) break;
      parts = keep;
    }
    const out = new Map(),
      found = new Map();
    for (const p of parts)
      for (const b of p.batches) {
        let g = found.get(b.gkey);
        if (!g) {
          found.set(b.gkey, (g = { members: [], count: 0 }));
          let c = gcache.get(b.gkey);
          if (!c) {
            const buf = gl.createBuffer();
            gcache.set(b.gkey, (c = { buf, G: b.gl, data: new Float32Array(0), vao: null, evao: null }));
            c.vao = vao(b.gl, buf, STRIDE_G);
          }
          g.c = c;
        }
        g.members.push([p, b]);
        g.count += b.mats.length;
        out.set(b, g);
      }
    for (const g of found.values()) {
      const c = g.c;
      if (c.data.length < g.count * 24) c.data = new Float32Array(g.count * 24 * 1.5);
      let o = 0;
      for (const [p, b] of g.members) {
        const col = colour(p),
          fl = flags(p);
        for (const m of b.mats) {
          c.data.set(M.mul(p.m, m), o);
          c.data.set(col, o + 16);
          c.data[o + 19] = p.tint ?? 1;
          c.data.set(p.emit, o + 20);
          c.data[o + 23] = fl;
          o += 24;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, c.buf);
      gl.bufferData(gl.ARRAY_BUFFER, c.data.subarray(0, o), gl.DYNAMIC_DRAW);
      // drawn as a batch of its own: the shape's buffers, the group's copies
      g.batch = { gl: { ...c.G, vao: c.vao, count: g.count } };
      if (c.G.edge && !c.evao) c.evao = vao(c.G, c.buf, STRIDE_G, true);
      g.edges = c.evao && c.G.edge ? { vao: c.evao, en: c.G.en, count: g.count } : null;
    }
    return out;
  }
  function unbind() {
    if (bound) vx.bind(null);
    bound = false;
  }

  // ---- render targets
  const tex2d = (w, h, internal, format, type, filter = gl.LINEAR) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  let shadow = null;
  const SHADOW = opts.shadowSize || 1024;
  if (shadowsOn) {
    const t = tex2d(SHADOW, SHADOW, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    shadow = { t, f };
  }
  // the studio environment: drawn once into a cube map, each mip level prefiltered for a rougher surface
  let env = null;
  const ENV = 64,
    ENV_LEVELS = 6,
    E = ENVS[opts.env] || ENVS.studio;
  function makeEnv() {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
    const internal = envHalf ? gl.RGBA16F : gl.RGBA8,
      type = envHalf ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    for (let l = 0; l < ENV_LEVELS; l++)
      for (let f = 0; f < 6; f++)
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, l, internal, ENV >> l, ENV >> l, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, ENV_LEVELS - 1);
    studioProgs();
    if (!ready(P.envGen, true) || !ready(P.envPre, true)) return gl.deleteTexture(t); // (the context is gone)
    const gen = P.envGen,
      pre = P.envPre;
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    for (let l = 0; l < ENV_LEVELS; l++)
      for (let face = 0; face < 6; face++) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, t, l);
        gl.viewport(0, 0, ENV >> l, ENV >> l);
        const prog = l === 0 ? gen : pre;
        gl.useProgram(prog.p);
        gl.uniform1i(prog.u.uFace, face);
        if (prog.u.uRough) gl.uniform1f(prog.u.uRough, l / (ENV_LEVELS - 1));
        gl.uniform3fv(prog.u.uSky, E.sky);
        gl.uniform3fv(prog.u.uKey, E.key);
        gl.uniform3fv(prog.u.uFill, E.fill);
        only([0]);
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(f);
    gl.enable(gl.DEPTH_TEST);
    env = { t };
  }
  let shadowKeep = null,
    back = null;
  // what the shadow map depends on: each part (which one, where, whether cut, its placements' version), the section's
  // plane, the bounds and the light. Written into the one of two arrays not holding the kept key (no garbage a frame)
  // (slot 0: the shadow map's, kept in shadowKeep; slot 1: the streams' depth, kept in sT)
  const keys = [
    [new Float32Array(0), new Float32Array(0)],
    [new Float32Array(0), new Float32Array(0)],
  ];
  function partsKey(slot, parts, f, extra) {
    const n = parts.length * 19 + 8 + extra.length,
      kept = slot ? sT?.key : shadowKeep?.key,
      two = keys[slot],
      i0 = two[0] === kept ? 1 : 0;
    if (two[i0].length !== n) two[i0] = new Float32Array(n);
    const k = two[i0];
    parts.forEach((p, i) => {
      k[19 * i] = p.index ?? -1; // (which part: its index in the scene, not a search, so thousands of parts cost little)
      k.set(p.m, 19 * i + 1);
      k[19 * i + 17] = f.cut && p.cut ? 1 : 0;
      k[19 * i + 18] = p.batches.reduce((a, b) => a + (b.ver || 0), 0);
    });
    k.set(f.plane || [0, 0, 0, 0], parts.length * 19);
    k.set([f.bounds.radius, f.cut ? 1 : 0, 0, 0], parts.length * 19 + 4);
    k.set(extra, parts.length * 19 + 8);
    return k;
  }
  const sameKey = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  // the glow: emission drawn at half resolution, blurred at a quarter, added onto the picture
  let glow = null;
  function glowTargets(w, h) {
    const hw = Math.max(1, w >> 1),
      hh = Math.max(1, h >> 1),
      qw = Math.max(1, w >> 2),
      qh = Math.max(1, h >> 2);
    if (glow && glow.w === w && glow.h === h) return glow;
    if (glow) {
      for (const t of [glow.a, glow.b, glow.c]) gl.deleteTexture(t);
      for (const f of [glow.fa, glow.fb, glow.fc]) gl.deleteFramebuffer(f);
      gl.deleteRenderbuffer(glow.d);
    }
    const mk = (tw, th) => {
      const t = tex2d(tw, th, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return [t, f];
    };
    const [a, fa] = mk(hw, hh),
      d = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, d);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, hw, hh);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
    const [b, fb] = mk(qw, qh),
      [c, fc] = mk(qw, qh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    glow = { w, h, hw, hh, qw, qh, a, fa, d, b, fb, c, fc };
    return glow;
  }
  function fullscreen(prog) {
    only([0]);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    inst.div(0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // a part's uniforms, sent only when they differ from the last part's (parts alike share their colour and material,
  // and every call costs: a scene of thousands of parts would spend its frame on them)
  const last = new Map(),
    set1 = (l, x) => {
      if (last.get(l) !== x) {
        last.set(l, x);
        gl.uniform1f(l, x);
      }
    },
    set3 = (l, v) => {
      const o = last.get(l);
      if (!o || o[0] !== v[0] || o[1] !== v[1] || o[2] !== v[2]) {
        last.set(l, v);
        gl.uniform3fv(l, v);
      }
    };
  const NOSHADOW = M.mul(M.trans([10, 10, 10]), M.scale([0, 0, 0])),
    PEN_SUN = [0.12, 1, 0.18];
  gl.enable(gl.DEPTH_TEST);
  function common(prog, f, VP) {
    gl.useProgram(prog.p);
    const u = prog.u;
    if (u.uVP) gl.uniformMatrix4fv(u.uVP, false, VP || f.VP);
    if (u.uEye) gl.uniform3fv(u.uEye, f.eye);
    if (u.uPlane) gl.uniform4fv(u.uPlane, f.plane);
    if (u.uCut) gl.uniform1f(u.uCut, f.cut ? 1 : 0);
    if (u.uOutline) gl.uniform1f(u.uOutline, 0);
    if (u.uViewD) gl.uniform1f(u.uViewD, f.viewD || 0);
  }

  return {
    kind: gl2 ? 'webgl2' : 'webgl1',
    hifi,
    shadows: shadowsOn,
    parallel: !!par,
    // after the first picture: start compiling the studio look in the background, where that does not block
    prewarm() {
      if (par) {
        studioProgs();
        penProg();
        if (hifi) glowProgs();
      }
    },
    upload,
    instances,
    edges,
    get pending() {
      return pending;
    },
    setAO(b) {
      if (b.gl && b.ao) {
        gl.bindBuffer(gl.ARRAY_BUFFER, b.gl.ao);
        gl.bufferData(gl.ARRAY_BUFFER, b.ao, gl.STATIC_DRAW);
      }
    },
    draw(f) {
      const kind = f.look.kind, // 0 ink, 1 studio, 2 pen
        ink = kind === 0,
        pen = kind === 2,
        W = gl.canvas.width,
        H = gl.canvas.height;
      // the programs this picture needs; if one is still compiling, draw nothing yet (the last picture stays up)
      if (kind === 1) studioProgs();
      const prog = ink ? P.ink : pen ? penProg() : P.studio,
        flows = f.flows || [];
      const solid = f.particles.filter((h) => h.solid && h.visible && h.count),
        flow = f.particles.filter((h) => !h.solid && h.visible);
      const needs = [
        prog,
        P.ground,
        ...(shadowsOn ? [P.depth] : []),
        ...(flow.length ? [lazy('pts')] : []),
        ...(solid.length ? [lazy('dots')] : []),
        ...(flows.length ? [lazy('flow')] : []),
        ...(f.edges ? [lazy('edge')] : []),
        ...(f.streams && f.streams.length ? [lazy('stream'), lazy('copy')] : []),
      ];
      if (kind === 1 && hifi && !env) needs.push(P.envGen, P.envPre);
      let waiting = false;
      for (const q of needs) if (!ready(q) && !q.failed) waiting = true;
      const can = (name) => P[name] && P[name].ok; // (an optional effect that compiled)
      if (waiting) return false;
      const opaque = f.parts.filter((p) => p.drawAlpha >= 0.99),
        clear = f.parts.filter((p) => p.drawAlpha > 0.01 && p.drawAlpha < 0.99);
      // a part's own state, as constant attributes for a part drawn alone (one call each, as a uniform would be): its
      // colour in this look and how much of it the pen look shows; its glow, and flags (1 lit, 2 cut: a part may stay
      // whole, cut: false)
      const flags = (p) => (p.id === f.hover || p.id === f.selected ? 1 : 0) + (f.cut && p.cut ? 2 : 0),
        colour = (p) => (kind === 1 ? p.studioColor : p.color);
      const state = (p) => {
        const c = colour(p),
          e = p.emit;
        gl.vertexAttrib4f(LOC.aIC, c[0], c[1], c[2], p.tint ?? 1);
        gl.vertexAttrib4f(LOC.aIE, e[0], e[1], e[2], flags(p));
      };
      // parts alike drawn together: the batches of one shape (buffers shared) on solid parts of one material, every
      // copy's matrix and the part's state in one buffer, so a pass draws them in one call (bolts, a scene of
      // thousands of parts alike). Made again each frame drawn; only the passes over every solid part use them
      const groupOf = groupsOf(opaque, kind, flags, colour);
      const each = (prog, list, set) => {
        last.clear();
        const u = prog.u,
          together = list === opaque && groupOf.size,
          done = new Set();
        for (const p of list) {
          if (together && p.batches.every((b) => groupOf.has(b))) {
            // (all of it drawn with others: nothing of its own to set)
            for (const b of p.batches) {
              const g = groupOf.get(b);
              if (done.has(g)) continue;
              done.add(g);
              gl.uniformMatrix4fv(u.uModel, false, ID);
              if (set) set(p); // (what a group shares: its material)
              bindBatch(prog, g.batch);
              drawBatch(g.batch);
            }
            continue;
          }
          gl.uniformMatrix4fv(u.uModel, false, p.m);
          state(p);
          if (set) set(p);
          for (const b of p.batches) {
            bindBatch(prog, b);
            drawBatch(b);
          }
        }
        unbind();
      };
      // the edges of these parts, over their faces (blended, not written to depth)
      const edgeLines = (list) => {
        if (!can('edge')) return;
        const Q = lazy('edge');
        common(Q, f);
        gl.uniform2f(Q.u.uView, W / 2, H / 2);
        gl.uniform1f(Q.u.uWidth, 0.4 * f.dpr + 0.5);
        gl.uniform3fv(Q.u.uLight, f.look.light);
        // the edges a little lighter than the outline, so the outline reads first; a lit part's light
        const line = f.look.solid ? f.look.ink.map((v, i) => v + (f.look.solid[i] - v) * 0.2) : f.look.ink,
          lit = f.look.ink.map((v) => v + (1 - v) * 0.75);
        gl.uniform3fv(Q.u.uColor, line);
        gl.uniform3fv(Q.u.uLit, f.look.kind === 2 ? lit : line); // (a lit part's edges, by its tint: pen only)
        gl.enable(gl.BLEND);
        blendOver();
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        const together = list === opaque && groupOf.size,
          done = new Set();
        for (const p of list) {
          if (together && p.batches.every((b) => groupOf.has(b))) {
            for (const b of p.batches) {
              const g = groupOf.get(b).edges;
              if (!g || done.has(g.vao)) continue;
              done.add(g.vao);
              gl.uniformMatrix4fv(Q.u.uModel, false, ID);
              gl.uniform1f(Q.u.uAlpha, 1);
              vx.bind(g.vao);
              inst.arrays(gl.TRIANGLES, g.en, g.count);
            }
            continue;
          }
          gl.uniformMatrix4fv(Q.u.uModel, false, p.m);
          state(p);
          gl.uniform1f(Q.u.uAlpha, p.drawAlpha);
          for (const b of p.batches) {
            const G = b.gl;
            if (!G || !G.edge) continue;
            vx.bind(G.evao || (G.evao = vao(G, G.inst, 64, true)));
            inst.arrays(gl.TRIANGLES, G.en, G.count);
          }
        }
        vx.bind(null);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      };
      // 1. the shadow map, from the key light, around what is on screen now. Kept while nothing that casts a shadow
      // moves (turning the camera does not change it): compared on the parts' matrices and the light's frame
      let lightVP = null;
      // (pen: the shadow of a light from above, falling only on the ground: a soft shadow shaped like the object)
      const sun = pen ? PEN_SUN : f.look.light,
        key = shadowsOn && f.shadows ? partsKey(0, opaque, f, [...f.bounds.center, ...sun]) : null;
      if (key && shadowKeep && sameKey(key, shadowKeep.key)) lightVP = shadowKeep.vp;
      else if (key) {
        const c = f.bounds.center,
          r = f.bounds.radius * 1.05,
          L = norm(sun),
          eye = add(c, mulv(L, r * 2));
        lightVP = M.mul(
          M.ortho(-r, r, -r, r, 0.01, r * 4),
          M.look(eye, c, Math.abs(L[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]),
        );
        gl.bindFramebuffer(gl.FRAMEBUFFER, shadow.f);
        gl.viewport(0, 0, SHADOW, SHADOW);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.colorMask(false, false, false, false);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        common(P.depth, f, lightVP);
        each(P.depth, opaque);
        gl.colorMask(true, true, true, true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        shadowKeep = { key, vp: lightVP };
      }
      gl.viewport(0, 0, W, H);
      // a theme's page is a plain colour: drawn here, opaque, so whatever is blended later blends over it exactly
      const fill = f.look.fill;
      if (fill) gl.clearColor(fill[0], fill[1], fill[2], 1);
      else gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const u = prog.u;
      common(prog, f);
      gl.uniform3fv(u.uLight, f.look.light);
      gl.uniform3fv(u.uCap, f.look.cap);
      gl.uniform1f(u.uDpr, f.dpr);
      gl.uniform1f(u.uAOk, f.ao ? 1 : 0);
      if (u.uPaper) gl.uniform3fv(u.uPaper, f.look.paper);
      if (u.uSolid) gl.uniform3fv(u.uSolid, f.look.solid);
      if (hifi && kind === 1) {
        if (!env) {
          makeEnv();
          if (!env) return false;
          gl.viewport(0, 0, W, H);
          gl.useProgram(prog.p);
        }
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, env.t);
        gl.uniform1i(u.uEnv, 1);
        gl.uniform1f(u.uEnvMax, ENV_LEVELS - 1);
        gl.uniform1f(u.uExposure, 1.0);
        // each sampler on its own unit, even unused (one left on unit 0 would meet the shadow map's depth texture)
        gl.uniform1i(u.uBack, 3);
        gl.uniform1i(u.uBase, 4);
        gl.uniform1i(u.uNorm, 5);
        gl.uniform1i(u.uMR, 6);
      }
      if (u.uShadow) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, shadow.t);
        gl.uniform1i(u.uShadow, 2);
        gl.uniform1f(u.uShadowTexel, 1 / SHADOW);
        gl.uniformMatrix4fv(u.uLightVP, false, lightVP || NOSHADOW);
      }
      // 2. the outline (ink, and thinner in pen): back faces pushed out along the averaged normals, drawn flat
      if (ink || pen) {
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.FRONT);
        gl.uniform1f(u.uFlat, 1);
        gl.uniform3fv(u.uColor, f.look.ink);
        gl.uniform1f(u.uAlpha, 1);
        // (in pen about one pixel on screen whatever the canvas's size; ink's, as it always was)
        gl.uniform1f(u.uOutline, pen ? (2.2 * f.dpr * f.tanHalf) / H : 0.0028);
        each(prog, opaque);
      }
      // 3. the solid parts (with the section on, both faces: the inside of a cut part shows as a cap)
      gl.uniform1f(u.uFlat, 0);
      gl.uniform1f(u.uOutline, 0);
      if (f.cut) gl.disable(gl.CULL_FACE);
      else {
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
      }
      // (a part's material; its colour, glow and flags come with its state)
      const look = (p) => {
        set3(u.uMat, p.mat);
        set1(u.uAlpha, p.drawAlpha);
        if (u.uSurf) {
          set3(u.uSurf, p.surf);
          set1(u.uRefr, back && p.drawAlpha < 0.99 ? p.refract : 0);
        }
      };
      each(prog, opaque, look);
      if (f.edges) {
        edgeLines(opaque);
        gl.useProgram(prog.p);
      }
      // 4. the ground: the model's shadow and a soft contact shadow, blended onto the background
      if (f.ground) {
        const G = P.ground;
        gl.useProgram(G.p);
        gl.enable(gl.BLEND);
        blendOver();
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        gl.uniformMatrix4fv(G.u.uVP, false, f.VP);
        gl.uniform3fv(G.u.uCenter, f.ground.center);
        gl.uniform1f(G.u.uRadius, f.ground.radius);
        gl.uniform1f(G.u.uY, f.ground.y);
        gl.uniform1f(G.u.uStyle, kind);
        gl.uniform3fv(G.u.uShade, f.look.shade);
        gl.uniform1f(G.u.uDpr, f.dpr);
        gl.uniform1f(G.u.uContact, f.ground.contact);
        // pen: a wider, softer shadow, darker on a dark page
        gl.uniform1f(G.u.uBlur, pen ? 7 : 2);
        gl.uniform1f(G.u.uShadowK, pen ? (f.look.dark ? 0.6 : 0.34) : 0.3);
        if (G.u.uShadow) {
          gl.activeTexture(gl.TEXTURE2); // (bound here too: the pen look's own program does not sample it)
          gl.bindTexture(gl.TEXTURE_2D, shadow.t);
          gl.activeTexture(gl.TEXTURE0);
          gl.uniform1i(G.u.uShadow, 2);
          gl.uniform1f(G.u.uShadowTexel, 1 / SHADOW);
          gl.uniformMatrix4fv(G.u.uLightVP, false, lightVP || NOSHADOW);
        }
        fullscreen(G);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
      // 4b. balls: solid, so they hide each other by depth (no sorting), and behind glass, which tints them
      if (solid.length && can('dots')) {
        const Q = lazy('dots');
        common(Q, f);
        gl.uniform3fv(Q.u.uInk, f.look.ink);
        gl.uniform1f(Q.u.uStudio, kind);
        for (const h of solid) {
          h.update();
          let up = uploads.get(h);
          if (!up) uploads.set(h, (up = { buf: gl.createBuffer(), version: NaN }));
          only([0]);
          gl.bindBuffer(gl.ARRAY_BUFFER, up.buf);
          if (h.version === undefined || h.version !== up.version) {
            gl.bufferData(gl.ARRAY_BUFFER, h.pos4.subarray(0, h.count * 4), gl.DYNAMIC_DRAW);
            up.version = h.version;
          }
          gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
          inst.div(0, 0);
          gl.uniform3fv(Q.u.uC0, h.ramp[0]);
          gl.uniform3fv(Q.u.uC1, h.ramp[1]);
          gl.uniform3fv(Q.u.uC2, h.ramp[2]);
          gl.uniform1f(Q.u.uSize, 2 * h.radius * f.pxPerUnit);
          gl.drawArrays(gl.POINTS, 0, h.count);
        }
      }
      // 5. see-through parts, far to near, without writing depth
      const refracting = clear.length && u.uBack && clear.some((p) => p.refract > 0);
      if (back && !refracting) {
        gl.deleteTexture(back.t); // (no glass that bends light on screen: its copy of the picture goes)
        back = null;
      }
      if (clear.length) {
        // glass that bends the light (refract, WebGL 2): it samples a copy of the picture behind it, made once
        if (refracting) {
          gl.activeTexture(gl.TEXTURE3); // (made and bound on its own unit: the shadow map stays on unit 2)
          if (!back || back.w !== W || back.h !== H) {
            if (back) gl.deleteTexture(back.t);
            back = { t: tex2d(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE), w: W, h: H };
          }
          gl.bindTexture(gl.TEXTURE_2D, back.t);
          gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H);
          gl.useProgram(prog.p);
          gl.uniform2f(u.uView, W, H);
          gl.activeTexture(gl.TEXTURE0);
        }
        gl.useProgram(prog.p);
        gl.enable(gl.BLEND);
        blendOver();
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        const sorted = clear
          .map((p) => [p, len(sub(M.pt(p.m, p.center), f.eye))])
          .sort((a, b) => b[1] - a[1])
          .map(([p]) => p);
        each(prog, sorted, look);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        if (f.edges) edgeLines(sorted);
      }
      // 6. particles
      if (flow.length && can('pts')) {
        const Q = lazy('pts');
        common(Q, f);
        gl.enable(gl.BLEND);
        blendOver();
        gl.depthMask(false);
        for (const h of flow) {
          h.update();
          only([0]);
          gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
          gl.bufferData(gl.ARRAY_BUFFER, h.pos4, gl.DYNAMIC_DRAW);
          gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
          inst.div(0, 0);
          gl.uniform3fv(Q.u.uColor, h.color);
          gl.uniform1f(Q.u.uAlpha, 0.95);
          gl.uniform1f(Q.u.uSize, h.size * f.dpr * 4);
          gl.drawArrays(gl.POINTS, 0, h.count);
        }
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
      // 6b. flow streaks: hidden by solid parts, not hiding anything themselves; ink over a light page (never added,
      // which would wash out into the paper), light added on a dark one
      if (flows.length && can('flow')) {
        const Q = lazy('flow'),
          A = Q.a;
        common(Q, f);
        gl.uniform2f(Q.u.uView, W / 2, H / 2);
        gl.enable(gl.BLEND);
        if (f.look.dark) gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        else gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        if (!fidx) fidx = buf(flowIndices(MAX), gl.ELEMENT_ARRAY_BUFFER);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fidx);
        only([A.aPos, A.aDir, A.aA]);
        for (const F of flows) {
          let fb = fbufs.get(F);
          if (!fb) fbufs.set(F, (fb = buf(F.verts, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW)));
          gl.bindBuffer(gl.ARRAY_BUFFER, fb);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, F.verts.subarray(0, F.n * 8 * STRIDE));
          gl.vertexAttribPointer(A.aPos, 4, gl.FLOAT, false, STRIDE * 4, 0);
          gl.vertexAttribPointer(A.aDir, 4, gl.FLOAT, false, STRIDE * 4, 16);
          gl.vertexAttribPointer(A.aA, 1, gl.FLOAT, false, STRIDE * 4, 32);
          for (const l of [A.aPos, A.aDir, A.aA]) inst.div(l, 0);
          F.colors.forEach((c, i) => gl.uniform3fv(Q.u['uC' + i], c));
          gl.uniform1f(Q.u.uAlpha, F.opacity);
          gl.uniform1f(Q.u.uWidth, (Math.max(1.25, F.width) / 2 + 0.5) * f.dpr);
          gl.drawElements(gl.TRIANGLES, F.n * 18, gl.UNSIGNED_SHORT, 0);
        }
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
      // 6c. streams: the solid parts' depth (WebGL 2: the march stops behind them), the streams marched into a picture of
      // half the size, then that picture put over this one (ink over a light page, light added on a dark one)
      const streams = (f.streams || []).filter((T) => T.visible && T.density > 0);
      if (streams.length && can('stream') && can('copy')) {
        const hw = Math.max(1, W >> 1),
          hh = Math.max(1, H >> 1);
        if (!sT || sT.w !== W || sT.h !== H) {
          if (sT) {
            gl.deleteTexture(sT.c);
            gl.deleteFramebuffer(sT.fc);
            gl.deleteRenderbuffer(sT.z);
            if (sT.d) {
              gl.deleteTexture(sT.d);
              gl.deleteFramebuffer(sT.fd);
            }
          }
          sT = { w: W, h: H };
          [sT.c, sT.fc] = target(
            tex2d(hw, hh, gl2 ? gl.RGBA8 : gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE),
            gl.COLOR_ATTACHMENT0,
          );
          // (its own depth: each hull's farthest face, so a pixel is marched once however the hull folds)
          sT.z = gl.createRenderbuffer();
          gl.bindRenderbuffer(gl.RENDERBUFFER, sT.z);
          gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, hw, hh);
          gl.bindFramebuffer(gl.FRAMEBUFFER, sT.fc);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, sT.z);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          if (P.depth)
            [sT.d, sT.fd] = target(
              tex2d(W, H, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST),
              gl.DEPTH_ATTACHMENT,
            );
        }
        // the solid parts' depth, drawn again only when they or the camera moved (a stream alone moving keeps it)
        const dk = sT.d && partsKey(1, opaque, f, f.VP);
        if (dk && !sameKey(dk, sT.key || [])) {
          sT.key = dk;
          gl.bindFramebuffer(gl.FRAMEBUFFER, sT.fd);
          gl.viewport(0, 0, W, H);
          gl.clear(gl.DEPTH_BUFFER_BIT);
          gl.colorMask(false, false, false, false);
          if (f.cut)
            gl.disable(gl.CULL_FACE); // (a cut part's inside shows: it hides what is behind it)
          else {
            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.BACK);
          }
          common(P.depth, f);
          each(P.depth, opaque);
          gl.colorMask(true, true, true, true);
        }
        const Q = lazy('stream'),
          u = Q.u;
        gl.bindFramebuffer(gl.FRAMEBUFFER, sT.fc);
        gl.viewport(0, 0, hw, hh);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.FRONT); // (the far side of each hull: the march goes from there towards the eye)
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        common(Q, f);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, sT.d || null);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(u.uDepth, 3);
        gl.uniform1f(u.uHasDepth, sT.d ? 1 : 0);
        gl.uniform2f(u.uView, hw, hh);
        gl.uniform1f(u.uOrtho, f.viewD ? 1 : 0);
        gl.uniform3fv(u.uFwd, f.fwd);
        only([Q.a.aPos]);
        inst.div(Q.a.aPos, 0);
        // far to near, each over the ones behind it; each hull's farthest face first (depth only), then marched from there
        const far = (T) => dot(sub(T.center, f.eye), f.fwd);
        gl.enable(gl.DEPTH_TEST);
        gl.clearDepth(0);
        for (const T of streams.sort((a, b) => far(b) - far(a))) {
          let b = sbufs.get(T);
          if (!b) sbufs.set(T, (b = { p: buf(T.hull.p), i: buf(T.hull.i, gl.ELEMENT_ARRAY_BUFFER) }));
          gl.bindBuffer(gl.ARRAY_BUFFER, b.p);
          gl.vertexAttribPointer(Q.a.aPos, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.i);
          gl.uniform4fv(u['uPts[0]'], T.pts);
          gl.uniform3fv(u['uTab[0]'], T.tab);
          gl.uniform1i(u.uN, T.n);
          T.colors.forEach((c, i) => gl.uniform3fv(u['uC' + i], c));
          gl.uniform4f(u.uF, T.phase, T.scale, T.reach, T.turbulence);
          gl.uniform3f(u.uG, T.swirl, T.total, T.fade ?? 0.7);
          gl.uniform1f(u.uDen, T.density);
          gl.clear(gl.DEPTH_BUFFER_BIT);
          gl.depthFunc(gl.GREATER);
          gl.depthMask(true);
          gl.colorMask(false, false, false, false);
          gl.drawElements(gl.TRIANGLES, T.hull.i.length, gl.UNSIGNED_SHORT, 0);
          gl.depthFunc(gl.EQUAL);
          gl.depthMask(false);
          gl.colorMask(true, true, true, true);
          gl.drawElements(gl.TRIANGLES, T.hull.i.length, gl.UNSIGNED_SHORT, 0);
        }
        gl.clearDepth(1);
        gl.depthFunc(gl.LESS);
        gl.depthMask(true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, W, H);
        const C = lazy('copy');
        gl.useProgram(C.p);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, sT.c);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(C.u.uTex, 3);
        if (f.look.dark) gl.blendFunc(gl.ONE, gl.ONE);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.DEPTH_TEST);
        fullscreen(C);
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
      }
      // 7. glow around glowing parts (WebGL 2)
      const glowing = hifi && f.parts.some((p) => p.drawAlpha > 0.01 && p.emit[0] + p.emit[1] + p.emit[2] > 0.01);
      if (glowing && (glowProgs(), [P.glow, P.blur, P.add].every((q) => ready(q, true)))) {
        const T = glowTargets(W, H),
          Gp = P.glow;
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.fa);
        gl.viewport(0, 0, T.hw, T.hh);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        common(Gp, f);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        if (f.cut) gl.disable(gl.CULL_FACE);
        // what glows, and what hides it: opaque parts only (glass and an x-rayed casing let the glow through)
        each(
          Gp,
          f.parts.filter(
            (p) => p.drawAlpha >= 0.99 || (p.drawAlpha > 0.01 && p.emit[0] + p.emit[1] + p.emit[2] > 0.01),
          ),
        );
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        const B = P.blur;
        gl.useProgram(B.p);
        gl.uniform1i(B.u.uTex, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
        gl.viewport(0, 0, T.qw, T.qh);
        gl.bindTexture(gl.TEXTURE_2D, T.a);
        gl.uniform2f(B.u.uDir, 1 / T.hw, 0);
        fullscreen(B);
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.fc);
        gl.bindTexture(gl.TEXTURE_2D, T.b);
        gl.uniform2f(B.u.uDir, 0, 1 / T.qh);
        fullscreen(B);
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
        gl.bindTexture(gl.TEXTURE_2D, T.c);
        gl.uniform2f(B.u.uDir, 2 / T.qw, 0);
        fullscreen(B);
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.fc);
        gl.bindTexture(gl.TEXTURE_2D, T.b);
        gl.uniform2f(B.u.uDir, 0, 2 / T.qh);
        fullscreen(B);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, W, H);
        const A2 = P.add;
        gl.useProgram(A2.p);
        gl.uniform1i(A2.u.uTex, 0);
        gl.bindTexture(gl.TEXTURE_2D, T.c);
        gl.uniform1f(A2.u.uGain, ink ? 0.9 : pen && !f.look.dark ? 0.5 : 1.4);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
        fullscreen(A2);
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
      }
      return true;
    },
    // what a removed thing held on the GPU: a ball set's buffer, a stream's hull, a flow's streaks, or a batch of its
    // own (lines: never shared with another)
    release(x) {
      for (const m of [uploads, sbufs, fbufs]) {
        const b = m.get(x);
        if (b) for (const v of b.buf ? [b.buf] : b.p ? [b.p, b.i] : [b]) gl.deleteBuffer(v);
        m.delete(x);
      }
      const G = x.gl;
      if (G && x.dynamic) {
        for (const k of ['pos', 'nrm', 'out', 'col', 'ao', 'idx', 'inst', 'uv', 'edge'])
          if (G[k]) gl.deleteBuffer(G[k]);
        if (G.vao) vx.del(G.vao);
        if (G.evao) vx.del(G.evao);
        x.gl = null;
      }
    },
    dispose() {
      const e = gl.getExtension('WEBGL_lose_context');
      if (e) e.loseContext();
    },
  };
}

export { glRenderer, ENVS };
