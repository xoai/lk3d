// The WebGL renderer, for WebGL 2 (the hi-fi path: physically based materials lit by a generated studio environment,
// soft shadows, glow) and WebGL 1 (the same scene, simpler light). Every renderer has the same small interface
// ({kind, hifi, draw(frame), setAO(batch), dispose()}), so another backend (WebGPU) can be added beside it.
import * as S from './shaders.js';
import { M, sub, len, mulv, add, norm } from './math.js';

const PVS = `attribute vec4 aPos; uniform mat4 uVP; uniform float uSize; uniform vec3 uEye;
void main() { gl_Position = uVP * vec4(aPos.xyz, 1.0); gl_PointSize = uSize / max(0.2, length(aPos.xyz - uEye)); }`;
const PFS = `uniform vec3 uColor; uniform float uAlpha;
void main() { vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; gl_FragColor = vec4(uColor, uAlpha * (1.0 - smoothstep(0.15, 0.5, r))); }`;

// balls (the molecules of a gas): a point sprite shaded as a sphere, in one of three colours by aPos.w (below 1/3, up
// to 2/3, above: bands read better than a blend, whose middle is a muddy grey); in the hand-drawn look, an ink rim
const DVS = `attribute vec4 aPos; uniform mat4 uVP; uniform float uSize; uniform vec3 uEye; varying float vW;
void main() { gl_Position = uVP * vec4(aPos.xyz, 1.0); gl_PointSize = max(2.0, uSize / max(0.05, length(aPos.xyz - uEye))); vW = aPos.w; }`;
const DFS = `uniform vec3 uC0, uC1, uC2, uInk; uniform float uStudio; varying float vW;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0; float r2 = dot(d, d); if (r2 > 1.0) discard;
  vec3 c = vW < 0.35 ? uC0 : vW < 0.65 ? uC1 : uC2;
  vec3 n = vec3(d.x, -d.y, sqrt(1.0 - r2));
  float l = max(dot(n, normalize(vec3(-0.45, 0.6, 0.66))), 0.0);
  vec3 col = uStudio > 0.5 ? c * (0.28 + 0.8 * l) + vec3(0.5) * pow(l, 24.0) : (r2 > 0.72 ? uInk : c * (l > 0.35 ? 1.0 : 0.85));
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
  const inst = gl2 ? { div: (l, d) => gl.vertexAttribDivisor(l, d), draw: (m, n, t, o, c) => gl.drawElementsInstanced(m, n, t, o, c) }
    : (() => { const e = gl.getExtension('ANGLE_instanced_arrays'); return e && { div: (l, d) => e.vertexAttribDivisorANGLE(l, d), draw: (m, n, t, o, c) => e.drawElementsInstancedANGLE(m, n, t, o, c) }; })();
  const uint = gl2 || !!gl.getExtension('OES_element_index_uint');
  const hifi = gl2 && opts.hifi !== false, shadowsOn = hifi && opts.shadows !== false;
  // the environment's format: half-float where it can be rendered to, else 8-bit with a shared exponent (RGBM)
  let envHalf = false;
  if (hifi && (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))) {
    const t = gl.createTexture(), f = gl.createFramebuffer();  // can it really be drawn into here?
    gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    envHalf = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(f); gl.deleteTexture(t);
  }
  // vertex attributes: exactly the ones the current draw uses are enabled (a stale one can fail a draw on some browsers)
  const MAXA = gl.getParameter(gl.MAX_VERTEX_ATTRIBS), on = new Array(MAXA).fill(false);
  // blending over what is drawn: colour by alpha, and the canvas's own alpha by "over" too (blending alpha like colour
  // would leave a² + A(1 − a), and the page would show through opaque parts behind glass)
  const blendOver = () => gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const only = (locs) => { for (let l = 0; l < MAXA; l++) { const want = locs.includes(l); if (want !== on[l]) { want ? gl.enableVertexAttribArray(l) : gl.disableVertexAttribArray(l); on[l] = want; } } };

  // ---- programs. Compiling shaders is what makes a first visit slow (about a second on a phone, measured): so only the
  // programs a picture needs are compiled, and where the browser can compile in the background
  // (KHR_parallel_shader_compile) nothing waits for them: draw() answers false until they are ready, and the engine
  // simply tries again on the next frame.
  const par = gl.getExtension('KHR_parallel_shader_compile');
  const program = (vs, fs, defs = []) => {
    const mk = (type, src, stage) => { const sh = gl.createShader(type); gl.shaderSource(sh, S.header(gl2, stage, defs) + src); gl.compileShader(sh); return sh; };
    const p = gl.createProgram(), v = mk(gl.VERTEX_SHADER, vs, 'vs'), f = mk(gl.FRAGMENT_SHADER, fs, 'fs');
    gl.attachShader(p, v); gl.attachShader(p, f); gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
    return { p, v, f, ok: false };
  };
  // is it compiled? (wait: true blocks until it is, for work that cannot be put off)
  const ready = (prog, wait = false) => {
    if (prog.ok) return true;
    if (gl.isContextLost()) return false;
    if (!wait && par && !gl.getProgramParameter(prog.p, par.COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(prog.p, gl.LINK_STATUS)) {
      const log = gl.getShaderInfoLog(prog.f) || gl.getShaderInfoLog(prog.v) || gl.getProgramInfoLog(prog.p);
      throw new Error('lk3d shader: ' + log);
    }
    const p = prog.p, u = {}, a = {}, nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS), na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let k = 0; k < nu; k++) { const i = gl.getActiveUniform(p, k); u[i.name] = gl.getUniformLocation(p, i.name); }
    for (let k = 0; k < na; k++) { const i = gl.getActiveAttrib(p, k); a[i.name] = gl.getAttribLocation(p, i.name); }
    // the attribute arrays this program reads, worked out once (bindBatch enables exactly these)
    const locs = Object.entries(a).filter(([k, l]) => l >= 0 && (inst || !/^aI/.test(k))).map(([, l]) => l);
    Object.assign(prog, { u, a, locs, plain: locs.filter((l) => l !== a.aUV), ok: true });  // plain: a batch without texture coordinates
    return true;
  };
  const compile = (vs, fs, defs) => { const prog = program(vs, fs, defs); ready(prog, true); return prog; };
  const studioDefs = [...(hifi ? ['HIFI'] : []), ...(shadowsOn ? ['SHADOWS'] : []), ...(hifi && !envHalf ? ['RGBM'] : [])];
  const P = {
    ink: program(S.PART_VS, S.PART_FS, ['INK', ...(shadowsOn ? ['SHADOWS'] : [])]),

    ground: program(S.GROUND_VS, S.GROUND_FS, shadowsOn ? ['SHADOWS'] : []),
  };
  if (shadowsOn) P.depth = program(S.PART_VS, S.DEPTH_FS);
  // particles along paths and solid balls: compiled only for a figure that has them
  const lazy = (name) => P[name] || (P[name] = name === 'pts' ? program(PVS, PFS) : program(DVS, DFS));
  // the studio look, its environment and the glow: compiled when first needed, or ahead of time in the background once
  // the first picture is up (only where that does not block)
  const studioProgs = () => { if (!P.studio) P.studio = program(S.PART_VS, S.PART_FS, studioDefs); if (hifi && !P.envGen) { P.envGen = program(S.QUAD_VS, S.ENV_FS, envHalf ? [] : ['RGBM']); P.envPre = program(S.QUAD_VS, S.PREFILTER_FS, envHalf ? [] : ['RGBM']); } };
  const glowProgs = () => { if (!P.glow) { P.glow = program(S.PART_VS, S.GLOW_FS); P.blur = program(S.QUAD_VS, S.BLUR_FS); P.add = program(S.QUAD_VS, S.ADD_FS); } };

  // ---- geometry: compressed vertices, one buffer set per batch, a matrix per instance
  const buf = (data, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, usage); return b; };
  function upload(b) {
    const g = b.geo, n = g.count, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++) { const v = g.p[3 * k + a]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }
    const qs = [0, 1, 2].map((a) => Math.max(1e-9, (hi[a] - lo[a]) / 2)), qo = [0, 1, 2].map((a) => (hi[a] + lo[a]) / 2);
    const pos = new Int16Array(n * 4), nrm = new Int8Array(n * 4), out = new Int8Array(n * 4);
    for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++) {
      pos[4 * k + a] = Math.round((g.p[3 * k + a] - qo[a]) / qs[a] * 32767);
      nrm[4 * k + a] = Math.round(g.n[3 * k + a] * 127); out[4 * k + a] = Math.round(b.out[3 * k + a] * 127);
    }
    if (n > 65535 && !uint) throw new Error('lk3d: a shape with more than 65535 vertices needs 32-bit indices, which this device lacks');
    const big = n > 65535;
    const im = new Float32Array(b.mats.length * 16); b.mats.forEach((m, i) => im.set(m, 16 * i));
    const col = g.c ? Uint8Array.from(g.c) : new Uint8Array(n * 4);  // a vertex's own colour; alpha 0: the part's
    b.gl = { pos: buf(pos), nrm: buf(nrm), out: buf(out), col: buf(col), ao: buf(new Uint8Array(n).fill(255)), idx: buf(big ? new Uint32Array(g.i) : new Uint16Array(g.i), gl.ELEMENT_ARRAY_BUFFER),
      inst: buf(im, gl.ARRAY_BUFFER, b.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW), n: g.i.length, type: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, qs, qo, count: b.mats.length,
      uv: g.tex && hifi ? buf(new Float32Array(g.uv)) : null, tex: {} };
    if (g.tex && hifi) maps(b.gl.tex, g.tex);
  }
  // a model's texture maps (studio look, WebGL 2): decoded off the main thread, at half size on a phone, and drawn once
  // ready (until then the part's own colour shows)
  function maps(T, tex) {
    for (const k of ['base', 'normal', 'mr']) if (tex[k] && typeof createImageBitmap === 'function') {
      createImageBitmap(new Blob([tex[k].bytes], { type: tex[k].mime }))
        .then((bm) => (opts.small ? createImageBitmap(bm, { resizeWidth: Math.max(1, bm.width >> 1), resizeHeight: Math.max(1, bm.height >> 1), resizeQuality: 'high' }) : bm))
        .then((bm) => {
          if (gl.isContextLost()) return;
          const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bm); gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.activeTexture(gl.TEXTURE0);
          T[k] = t; if (opts.onTexture) opts.onTexture();
        }).catch(() => {});  // an image the browser cannot decode: the part keeps its colour
    }
  }
  for (const part of scene.parts) for (const b of part.batches) upload(b);
  // a batch whose placements change (lines: rays, field lines): its matrices again, in place
  function instances(b) {
    const im = new Float32Array(b.mats.length * 16); b.mats.forEach((m, i) => im.set(m, 16 * i));
    gl.bindBuffer(gl.ARRAY_BUFFER, b.gl.inst); gl.bufferData(gl.ARRAY_BUFFER, im, gl.DYNAMIC_DRAW); b.gl.count = b.mats.length;
  }
  const quad = buf(new Float32Array([-1, -1, 0, 1, 1, -1, 0, 1, 1, 1, 0, 1, -1, -1, 0, 1, 1, 1, 0, 1, -1, 1, 0, 1]));
  const pbuf = gl.createBuffer(), uploads = new WeakMap();  // a ball set's buffer, and the version of its positions in it

  function bindBatch(prog, b) {
    const A = prog.a, G = b.gl;
    only(G.uv ? prog.locs : prog.plain);
    const attr = (name, buffer, size, type, norm) => {
      const l = A[name]; if (l == null || l < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.vertexAttribPointer(l, size, type, norm, 0, 0); if (inst) inst.div(l, 0);
    };
    attr('aPos', G.pos, 4, gl.SHORT, true); attr('aNrm', G.nrm, 4, gl.BYTE, true); attr('aOut', G.out, 4, gl.BYTE, true); attr('aAO', G.ao, 1, gl.UNSIGNED_BYTE, true); attr('aCol', G.col, 4, gl.UNSIGNED_BYTE, true);
    if (inst) {
      gl.bindBuffer(gl.ARRAY_BUFFER, G.inst);
      for (let c = 0; c < 4; c++) { const l = A['aI' + c]; if (l == null || l < 0) continue; gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 64, 16 * c); inst.div(l, 1); }
    }
    if (G.uv) attr('aUV', G.uv, 2, gl.FLOAT, false);
    if (prog.u.uTex) {  // which maps this batch has, on units 4, 5, 6
      const t = [G.tex.base, G.tex.normal, G.tex.mr]; gl.uniform3f(prog.u.uTex, t[0] ? 1 : 0, t[1] ? 1 : 0, t[2] ? 1 : 0);
      t.forEach((x, i) => { if (x) { gl.activeTexture(gl.TEXTURE4 + i); gl.bindTexture(gl.TEXTURE_2D, x); } }); gl.activeTexture(gl.TEXTURE0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, G.idx);
    if (prog.u.uQs) { gl.uniform3fv(prog.u.uQs, G.qs); gl.uniform3fv(prog.u.uQo, G.qo); }
  }
  function drawBatch(prog, b) {
    const G = b.gl;
    if (inst) { inst.draw(gl.TRIANGLES, G.n, G.type, 0, G.count); return; }
    for (const m of b.mats) {  // no instancing at all (very old WebGL 1): the matrix as a constant attribute, one draw each
      for (let c = 0; c < 4; c++) { const l = prog.a['aI' + c]; if (l != null && l >= 0) gl.vertexAttrib4f(l, m[4 * c], m[4 * c + 1], m[4 * c + 2], m[4 * c + 3]); }
      gl.drawElements(gl.TRIANGLES, G.n, G.type, 0);
    }
  }
  function unbindInstances(prog) { for (let c = 0; c < 4; c++) { const l = prog.a['aI' + c]; if (l != null && l >= 0 && inst) inst.div(l, 0); } }

  // ---- render targets
  const tex2d = (w, h, internal, format, type, filter = gl.LINEAR) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  let shadow = null;
  const SHADOW = opts.shadowSize || 1024;
  if (shadowsOn) {
    const t = tex2d(SHADOW, SHADOW, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    shadow = { t, f };
  }
  // the studio environment: drawn once into a cube map, each mip level prefiltered for a rougher surface
  let env = null;
  const ENV = 64, ENV_LEVELS = 6, E = ENVS[opts.env] || ENVS.studio;
  function makeEnv() {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
    const internal = envHalf ? gl.RGBA16F : gl.RGBA8, type = envHalf ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    for (let l = 0; l < ENV_LEVELS; l++) for (let f = 0; f < 6; f++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, l, internal, ENV >> l, ENV >> l, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, ENV_LEVELS - 1);
    studioProgs(); ready(P.envGen, true); ready(P.envPre, true);
    const gen = P.envGen, pre = P.envPre;
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    for (let l = 0; l < ENV_LEVELS; l++) for (let face = 0; face < 6; face++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, t, l);
      gl.viewport(0, 0, ENV >> l, ENV >> l);
      const prog = l === 0 ? gen : pre; gl.useProgram(prog.p);
      gl.uniform1i(prog.u.uFace, face); if (prog.u.uRough) gl.uniform1f(prog.u.uRough, l / (ENV_LEVELS - 1));
      gl.uniform3fv(prog.u.uSky, E.sky); gl.uniform3fv(prog.u.uKey, E.key); gl.uniform3fv(prog.u.uFill, E.fill);
      only([0]); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(f);
    gl.enable(gl.DEPTH_TEST);
    env = { t };
  }
  let shadowKeep = null, back = null;
  function shadowKey(parts, f) {
    const k = new Float32Array(parts.length * 17 + 7);  // each part: which one it is, and where
    parts.forEach((p, i) => { k[17 * i] = f.parts.indexOf(p); k.set(p.m, 17 * i + 1); });
    k.set([f.bounds.center[0], f.bounds.center[1], f.bounds.center[2], f.bounds.radius, f.look.light[0], f.look.light[1], f.look.light[2]], parts.length * 17);
    return k;
  }
  const sameKey = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  // the glow: emission drawn at half resolution, blurred at a quarter, added onto the picture
  let glow = null;
  function glowTargets(w, h) {
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    if (glow && glow.w === w && glow.h === h) return glow;
    if (glow) { for (const t of [glow.a, glow.b, glow.c]) gl.deleteTexture(t); for (const f of [glow.fa, glow.fb, glow.fc]) gl.deleteFramebuffer(f); gl.deleteRenderbuffer(glow.d); }
    const mk = (tw, th) => { const t = tex2d(tw, th, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return [t, f]; };
    const [a, fa] = mk(hw, hh), d = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, d); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, hw, hh);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
    const [b, fb] = mk(qw, qh), [c, fc] = mk(qw, qh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    glow = { w, h, hw, hh, qw, qh, a, fa, d, b, fb, c, fc };
    return glow;
  }
  function fullscreen(prog) { only([0]); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0); if (inst) inst.div(0, 0); gl.drawArrays(gl.TRIANGLES, 0, 6); }

  const NOSHADOW = M.mul(M.trans([10, 10, 10]), M.scale([0, 0, 0]));
  gl.enable(gl.DEPTH_TEST);
  function common(prog, f, VP) {
    gl.useProgram(prog.p); const u = prog.u;
    if (u.uVP) gl.uniformMatrix4fv(u.uVP, false, VP || f.VP); if (u.uEye) gl.uniform3fv(u.uEye, f.eye);
    if (u.uPlane) gl.uniform4fv(u.uPlane, f.plane); if (u.uCut) gl.uniform1f(u.uCut, f.cut ? 1 : 0); if (u.uOutline) gl.uniform1f(u.uOutline, 0);
  }

  return {
    kind: gl2 ? 'webgl2' : 'webgl1', hifi, shadows: shadowsOn, parallel: !!par,
    // after the first picture: start compiling the studio look in the background, where that does not block
    prewarm() { if (par) { studioProgs(); if (hifi) glowProgs(); } },
    upload, instances,
    setAO(b) { if (b.gl && b.ao) { gl.bindBuffer(gl.ARRAY_BUFFER, b.gl.ao); gl.bufferData(gl.ARRAY_BUFFER, b.ao, gl.STATIC_DRAW); } },
    draw(f) {
      const ink = f.style === 'ink', W = gl.canvas.width, H = gl.canvas.height;
      // the programs this picture needs; if one is still compiling, draw nothing yet (the last picture stays up)
      if (!ink) studioProgs();
      const prog = ink ? P.ink : P.studio;
      const solid = f.particles.filter((h) => h.solid && h.visible && h.count), flow = f.particles.filter((h) => !h.solid && h.visible);
      const needs = [prog, P.ground, ...(shadowsOn ? [P.depth] : []), ...(flow.length ? [lazy('pts')] : []), ...(solid.length ? [lazy('dots')] : [])];
      if (!ink && hifi && !env) needs.push(P.envGen, P.envPre);
      let waiting = false;
      for (const q of needs) if (!ready(q)) waiting = true;
      if (waiting) return false;
      const opaque = f.parts.filter((p) => p.drawAlpha >= 0.99), clear = f.parts.filter((p) => p.drawAlpha > 0.01 && p.drawAlpha < 0.99);
      const each = (prog, list, set) => { for (const p of list) { gl.uniformMatrix4fv(prog.u.uModel, false, p.m); if (set) set(p); for (const b of p.batches) { bindBatch(prog, b); drawBatch(prog, b); } } unbindInstances(prog); };
      // 1. the shadow map, from the key light, around what is on screen now. Kept while nothing that casts a shadow
      // moves (turning the camera does not change it): compared on the parts' matrices and the light's frame
      let lightVP = null;
      const key = shadowsOn && f.shadows ? shadowKey(opaque, f) : null;
      if (key && shadowKeep && sameKey(key, shadowKeep.key)) lightVP = shadowKeep.vp;
      else if (key) {
        const c = f.bounds.center, r = f.bounds.radius * 1.05, L = norm(f.look.light), eye = add(c, mulv(L, r * 2));
        lightVP = M.mul(M.ortho(-r, r, -r, r, 0.01, r * 4), M.look(eye, c, Math.abs(L[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]));
        gl.bindFramebuffer(gl.FRAMEBUFFER, shadow.f); gl.viewport(0, 0, SHADOW, SHADOW); gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.colorMask(false, false, false, false); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
        common(P.depth, f, lightVP);
        each(P.depth, opaque);
        gl.colorMask(true, true, true, true); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        shadowKeep = { key, vp: lightVP };
      }
      gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const u = prog.u;
      common(prog, f);
      gl.uniform3fv(u.uLight, f.look.light); gl.uniform3fv(u.uCap, f.look.cap); gl.uniform1f(u.uDpr, f.dpr);
      gl.uniform1f(u.uAOk, f.ao ? 1 : 0);
      if (hifi && !ink) {
        if (!env) { makeEnv(); gl.viewport(0, 0, W, H); gl.useProgram(prog.p); }
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_CUBE_MAP, env.t); gl.uniform1i(u.uEnv, 1);
        gl.uniform1f(u.uEnvMax, ENV_LEVELS - 1); gl.uniform1f(u.uExposure, 1.0);
        // each sampler on its own unit, even unused (one left on unit 0 would meet the shadow map's depth texture)
        gl.uniform1i(u.uBack, 3); gl.uniform1i(u.uBase, 4); gl.uniform1i(u.uNorm, 5); gl.uniform1i(u.uMR, 6);
      }
      if (u.uShadow) {
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, shadow.t); gl.uniform1i(u.uShadow, 2);
        gl.uniform1f(u.uShadowTexel, 1 / SHADOW); gl.uniformMatrix4fv(u.uLightVP, false, lightVP || NOSHADOW);
      }
      // 2. the ink outline: back faces pushed out along the averaged normals, drawn flat in ink
      if (ink) {
        gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
        gl.uniform1f(u.uFlat, 1); gl.uniform3fv(u.uColor, f.look.ink); gl.uniform1f(u.uAlpha, 1); gl.uniform1f(u.uOutline, 0.0028); gl.uniform3fv(u.uEmit, [0, 0, 0]);
        each(prog, opaque);
      }
      // 3. the solid parts (with the section on, both faces: the inside of a cut part shows as a cap)
      gl.uniform1f(u.uFlat, 0); gl.uniform1f(u.uOutline, 0);
      if (f.cut) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
      const look = (p) => {
        gl.uniform3fv(u.uColor, ink ? p.color : p.studioColor); gl.uniform3fv(u.uMat, p.mat); gl.uniform1f(u.uAlpha, p.drawAlpha);
        if (u.uSurf) { gl.uniform3fv(u.uSurf, p.surf); gl.uniform1f(u.uRefr, back && p.drawAlpha < 0.99 ? p.refract : 0); }
        gl.uniform1f(u.uHi, p.id === f.hover || p.id === f.selected ? 1 : 0); gl.uniform3fv(u.uEmit, p.emit);
      };
      each(prog, opaque, look);
      // 4. the ground: the model's shadow and a soft contact shadow, blended onto the background
      if (f.ground) {
        const G = P.ground; gl.useProgram(G.p); gl.enable(gl.BLEND); blendOver(); gl.depthMask(false); gl.disable(gl.CULL_FACE);
        gl.uniformMatrix4fv(G.u.uVP, false, f.VP); gl.uniform3fv(G.u.uCenter, f.ground.center); gl.uniform1f(G.u.uRadius, f.ground.radius); gl.uniform1f(G.u.uY, f.ground.y);
        gl.uniform1f(G.u.uStyle, ink ? 0 : 1); gl.uniform1f(G.u.uDpr, f.dpr); gl.uniform1f(G.u.uContact, f.ground.contact);
        if (G.u.uShadow) { gl.uniform1i(G.u.uShadow, 2); gl.uniform1f(G.u.uShadowTexel, 1 / SHADOW); gl.uniformMatrix4fv(G.u.uLightVP, false, lightVP || NOSHADOW); }
        fullscreen(G);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      // 4b. balls: solid, so they hide each other by depth (no sorting), and behind glass, which tints them
      if (solid.length) {
        const Q = lazy('dots'); gl.useProgram(Q.p); gl.uniformMatrix4fv(Q.u.uVP, false, f.VP); gl.uniform3fv(Q.u.uEye, f.eye);
        gl.uniform3fv(Q.u.uInk, f.look.ink); gl.uniform1f(Q.u.uStudio, ink ? 0 : 1);
        for (const h of solid) {
          h.update();
          let up = uploads.get(h);
          if (!up) uploads.set(h, up = { buf: gl.createBuffer(), version: NaN });
          only([0]); gl.bindBuffer(gl.ARRAY_BUFFER, up.buf);
          if (h.version === undefined || h.version !== up.version) { gl.bufferData(gl.ARRAY_BUFFER, h.pos4.subarray(0, h.count * 4), gl.DYNAMIC_DRAW); up.version = h.version; }
          gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0); if (inst) inst.div(0, 0);
          gl.uniform3fv(Q.u.uC0, h.ramp[0]); gl.uniform3fv(Q.u.uC1, h.ramp[1]); gl.uniform3fv(Q.u.uC2, h.ramp[2]);
          gl.uniform1f(Q.u.uSize, 2 * h.radius * f.pxPerUnit);
          gl.drawArrays(gl.POINTS, 0, h.count);
        }
      }
      // 5. see-through parts, far to near, without writing depth
      if (clear.length) {
        // glass that bends the light (refract, WebGL 2): it samples a copy of the picture behind it, made once
        if (u.uBack && clear.some((p) => p.refract > 0)) {
          gl.activeTexture(gl.TEXTURE3);  // (made and bound on its own unit: the shadow map stays on unit 2)
          if (!back || back.w !== W || back.h !== H) { if (back) gl.deleteTexture(back.t); back = { t: tex2d(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE), w: W, h: H }; }
          gl.bindTexture(gl.TEXTURE_2D, back.t); gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H);
          gl.useProgram(prog.p); gl.uniform2f(u.uView, W, H); gl.activeTexture(gl.TEXTURE0);
        } else if (back) { gl.deleteTexture(back.t); back = null; }
        gl.useProgram(prog.p); gl.enable(gl.BLEND); blendOver(); gl.depthMask(false); gl.disable(gl.CULL_FACE);
        const sorted = clear.map((p) => [p, len(sub(M.pt(p.m, p.center), f.eye))]).sort((a, b) => b[1] - a[1]).map(([p]) => p);
        each(prog, sorted, look);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      // 6. particles
      if (flow.length) {
        const Q = lazy('pts'); gl.useProgram(Q.p); gl.uniformMatrix4fv(Q.u.uVP, false, f.VP); gl.uniform3fv(Q.u.uEye, f.eye);
        gl.enable(gl.BLEND); blendOver(); gl.depthMask(false);
        for (const h of flow) {
          h.update();
          only([0]); gl.bindBuffer(gl.ARRAY_BUFFER, pbuf); gl.bufferData(gl.ARRAY_BUFFER, h.pos4, gl.DYNAMIC_DRAW);
          gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0); if (inst) inst.div(0, 0);
          gl.uniform3fv(Q.u.uColor, h.color); gl.uniform1f(Q.u.uAlpha, 0.95); gl.uniform1f(Q.u.uSize, h.size * f.dpr * 4);
          gl.drawArrays(gl.POINTS, 0, h.count);
        }
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      // 7. glow around glowing parts (WebGL 2)
      const glowing = hifi && f.parts.some((p) => p.drawAlpha > 0.01 && p.emit[0] + p.emit[1] + p.emit[2] > 0.01);
      if (glowing) {
        glowProgs(); for (const q of [P.glow, P.blur, P.add]) ready(q, true);
        const T = glowTargets(W, H), Gp = P.glow;
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.fa); gl.viewport(0, 0, T.hw, T.hh); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        common(Gp, f); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); if (f.cut) gl.disable(gl.CULL_FACE);
        // what glows, and what hides it: opaque parts only (glass and an x-rayed casing let the glow through)
        each(Gp, f.parts.filter((p) => p.drawAlpha >= 0.99 || (p.drawAlpha > 0.01 && p.emit[0] + p.emit[1] + p.emit[2] > 0.01)), (p) => gl.uniform3fv(Gp.u.uEmit, p.emit));
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
        const B = P.blur; gl.useProgram(B.p); gl.uniform1i(B.u.uTex, 0); gl.activeTexture(gl.TEXTURE0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb); gl.viewport(0, 0, T.qw, T.qh); gl.bindTexture(gl.TEXTURE_2D, T.a); gl.uniform2f(B.u.uDir, 1 / T.hw, 0); fullscreen(B);
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.fc); gl.bindTexture(gl.TEXTURE_2D, T.b); gl.uniform2f(B.u.uDir, 0, 1 / T.qh); fullscreen(B);
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb); gl.bindTexture(gl.TEXTURE_2D, T.c); gl.uniform2f(B.u.uDir, 2 / T.qw, 0); fullscreen(B);
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.fc); gl.bindTexture(gl.TEXTURE_2D, T.b); gl.uniform2f(B.u.uDir, 0, 2 / T.qh); fullscreen(B);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
        const A2 = P.add; gl.useProgram(A2.p); gl.uniform1i(A2.u.uTex, 0); gl.bindTexture(gl.TEXTURE_2D, T.c); gl.uniform1f(A2.u.uGain, ink ? 0.9 : 1.4);
        gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE); fullscreen(A2); gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
      }
      return true;
    },
    dispose() { const e = gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); },
  };
}

export { glRenderer };
