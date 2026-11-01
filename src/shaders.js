// The shaders, written once in GLSL ES 1.00 style and compiled as GLSL ES 3.00 on WebGL 2 (a few #defines translate),
// so WebGL 1 and WebGL 2 draw the same thing. The part shader is compiled twice, once per look (INK, or the studio
// look), so a page that only shows the hand-drawn look never compiles the heavier studio lighting. On WebGL 2 the HIFI path adds physically based shading (the lighting
// model of Google's Filament), light from a generated studio environment, shadows and tone mapping.

function header(gl2, stage, defs) {
  let h = gl2 ? '#version 300 es\n#define GL2 1\n' : '';
  for (const d of defs) h += `#define ${d} 1\n`;
  if (stage === 'vs') h += gl2 ? '#define attribute in\n#define varying out\n' : '';
  else {
    h += gl2 ? 'precision highp float;\nprecision highp sampler2DShadow;\n#define varying in\nout vec4 fragColor;\n#define gl_FragColor fragColor\n#define texture2D texture\n#define textureCube texture\n'
      : '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
  }
  return h;
}

// ---- the parts: positions and normals arrive compressed (16 and 8 bit), each instance brings its own matrix
const PART_VS = `
attribute vec4 aPos; attribute vec4 aNrm; attribute vec4 aOut; attribute float aAO; attribute vec4 aCol;
#ifdef HIFI
attribute vec2 aUV; varying vec2 vUV;
#endif
attribute vec4 aI0; attribute vec4 aI1; attribute vec4 aI2; attribute vec4 aI3;
uniform mat4 uModel; uniform mat4 uVP; uniform vec3 uEye; uniform float uOutline; uniform vec3 uQs; uniform vec3 uQo;
#ifdef SHADOWS
uniform mat4 uLightVP; varying vec4 vSh;
#endif
varying vec3 vW; varying vec3 vN; varying float vAO; varying vec4 vCol; varying vec3 vO;
void main() {
  mat4 m = uModel * mat4(aI0, aI1, aI2, aI3);
  vCol = aCol;
  vO = aPos.xyz * uQs + uQo;
#ifdef HIFI
  vUV = aUV;
#endif
  vec4 w = m * vec4(vO, 1.0);
  vec3 nm = mat3(m) * aNrm.xyz;
  if (uOutline > 0.0) w.xyz += normalize(mat3(m) * aOut.xyz) * uOutline * length(w.xyz - uEye);
  vW = w.xyz; vN = nm; vAO = aAO;
#ifdef SHADOWS
  vSh = uLightVP * w;
#endif
  gl_Position = uVP * w;
}`;

const PART_FS = `
uniform vec3 uColor; uniform float uAlpha; uniform float uStyle; uniform float uFlat; uniform vec3 uMat;
uniform vec3 uLight; uniform vec3 uEye; uniform vec4 uPlane; uniform float uCut; uniform vec3 uCap;
uniform float uHi; uniform vec3 uEmit; uniform float uDpr; uniform float uAOk;
varying vec3 vW; varying vec3 vN; varying float vAO; varying vec4 vCol; varying vec3 vO;
#ifdef HIFI
uniform samplerCube uEnv; uniform float uEnvMax; uniform float uExposure;
uniform vec3 uSurf; uniform float uRefr; uniform sampler2D uBack; uniform vec2 uView; uniform mat4 uVP;
uniform sampler2D uBase; uniform sampler2D uNorm; uniform sampler2D uMR; uniform vec3 uTex; varying vec2 vUV;
#endif
#ifdef SHADOWS
uniform sampler2DShadow uShadow; uniform float uShadowTexel; varying vec4 vSh;
float shadow() {  // 9 taps of hardware-compared depth: soft-edged shadows
  vec3 p = vSh.xyz / vSh.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float s = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) s += texture(uShadow, vec3(p.xy + vec2(float(i), float(j)) * uShadowTexel * 1.5, p.z - 0.0015));
  return s / 9.0;
}
#else
float shadow() { return 1.0; }
#endif
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSRGB(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }
// Khronos PBR Neutral tone mapping: keeps base colours faithful, rolls highlights off smoothly
vec3 neutral(vec3 c) {
  float x = min(c.r, min(c.g, c.b)), off = x < 0.08 ? x - 6.25 * x * x : 0.04; c -= off;
  float peak = max(c.r, max(c.g, c.b));
  if (peak < 0.76) return c;
  float d = 0.24, np = 1.0 - d * d / (peak + d - 0.76); c *= np / peak;
  return mix(c, vec3(np), 1.0 - 1.0 / (0.15 * (peak - np) + 1.0));
}
#ifdef HIFI
vec3 env(vec3 dir, float lod) {
#ifdef GL2
  vec4 e = textureLod(uEnv, dir, lod);
#else
  vec4 e = textureCube(uEnv, dir);
#endif
#ifdef RGBM
  return e.rgb * e.a * 6.0;
#else
  return e.rgb;
#endif
}
// fine surface detail (uSurf: kind, bumps per unit, strength), a height in the part's own coordinates
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn(vec3 p) {  // value noise
  vec3 i = floor(p), f = fract(p), e = vec3(1.0, 0.0, 0.0); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + e), f.x), mix(h3(i + e.yxy), h3(i + e.xxy), f.x), f.y),
    mix(mix(h3(i + e.yyx), h3(i + e.xyx), f.x), mix(h3(i + e.yxx), h3(i + e.xxx), f.x), f.y), f.z);
}
float surf(vec3 o) {
  float k = uSurf.x; vec3 p = o * uSurf.y;
  if (k < 1.5) return vn(p * vec3(0.02, 1.0, 1.0));                                    // brushed: streaks along x
  if (k < 2.5) { float a = atan(o.z, o.y) * length(o.yz) * uSurf.y; return 0.5 + 0.25 * (sin(p.x + a) + sin(p.x - a)); }  // knurl
  if (k < 3.5) return 0.5 + 0.5 * sin(p.x);                                              // ribs round x
  if (k < 4.5) return (vn(p) * 4.0 + vn(p * 2.03) * 2.0 + vn(p * 4.1)) / 7.0;            // grain: rock, wood
  if (k < 5.5) return 1.0 - abs(vn(p) * 2.0 - 1.0) * 0.8 - vn(p * 3.1) * 0.2;            // skin, membrane
  return vn(p) * 0.75 + vn(p * 2.7) * 0.25;                                              // cast metal
}
vec2 envBRDF(float NoV, float r) {  // the split-sum environment term, as Karis approximates it for mobile
  vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022), c1 = vec4(1.0, 0.0425, 1.04, -0.04), rr = r * c0 + c1;
  float a004 = min(rr.x * rr.x, exp2(-9.28 * NoV)) * rr.x + rr.y;
  return vec2(-1.04, 1.04) * a004 + rr.zw;
}
#endif
void main() {
  if (uCut > 0.5 && dot(uPlane.xyz, vW) + uPlane.w > 0.0) discard;
  if (uFlat > 0.5) { gl_FragColor = vec4(uColor, uAlpha); return; }
  vec3 C = mix(uColor, vCol.rgb, vCol.a);  // a vertex's own colour (atoms, bands, layers) where it has one
  vec2 fc = gl_FragCoord.xy / uDpr;
  if (!gl_FrontFacing && uCut > 0.5) {  // the inside of a cut part: a cap in the part's colour, hatched
    float h = step(0.55, fract((fc.x + fc.y) / 7.0));
#ifdef INK
    vec3 cap = mix(C, uCap, 0.35);
#else
    vec3 cap = mix(C, uCap, 0.25) * 1.15;
#endif
    gl_FragColor = vec4(cap * (0.84 + 0.16 * h), uAlpha); return;
  }
  vec3 N = normalize(gl_FrontFacing ? vN : -vN), L = normalize(uLight), V = normalize(uEye - vW);  // the far side of glass faces us
  float d = dot(N, L), ao = mix(1.0, vAO, uAOk), sh = shadow(), al = uAlpha;
  vec3 col;
#ifdef INK
  {  // ink: three bands of coloured pencil, hatching in the shade and in creases, paper grain
    float lit = (d > 0.55 ? 1.0 : d > 0.05 ? 0.82 : 0.64);
    lit = min(lit, sh > 0.5 ? 1.0 : 0.72);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col = C * lit * mix(0.78, 1.0, smoothstep(0.45, 0.85, ao)) + vec3(0.06) * rim;
    float hatch = step(0.5, fract((fc.x - fc.y) / 5.0)), cross2 = step(0.5, fract((fc.x + fc.y) / 5.0));
    if (d <= 0.05 || sh < 0.5) col *= 1.0 - 0.10 * hatch;
    if (ao < 0.55) col *= 1.0 - 0.08 * cross2;
    col *= 0.96 + 0.06 * hash(floor(fc));
    col = mix(col, vec3(0.97, 0.96, 0.93), 0.08);
  }
#else
  {
#ifdef HIFI
    // physically based: GGX distribution, correlated Smith visibility, Schlick Fresnel; light from the studio
    // environment (prefiltered by roughness) and one key light that casts shadows
    float rough = uMat.y, metal = uMat.x;
    if (uTex.x > 0.5) C = texture2D(uBase, vUV).rgb;  // a model's own maps: base colour, metal-roughness, normals
    if (uTex.z > 0.5) { vec4 mr = texture2D(uMR, vUV); rough *= mr.g; metal *= mr.b; }
    if (uTex.y > 0.5) {  // in a tangent frame from the screen derivatives of position and UV (as Khronos's viewer does)
      vec3 ux = dFdx(vec3(vUV, 0.0)), uy = dFdy(vec3(vUV, 0.0));
      vec3 t = (uy.y * dFdx(vW) - ux.y * dFdy(vW)) / (ux.x * uy.y - uy.x * ux.y);
      t = normalize(t - N * dot(N, t));
      N = normalize(mat3(t, cross(N, t), N) * (texture2D(uNorm, vUV).xyz * 2.0 - 1.0)); d = dot(N, L);
    }
    if (uSurf.x > 0.5) {  // bumps from the height's screen derivatives (no tangents needed), a little colour and gloss
      float h = surf(vO), hh = (h - 0.5) * uSurf.z * 0.2 / uSurf.y;  // strength 1: slopes of about 0.2
      vec3 dx = dFdx(vW), dy = dFdy(vW), r1 = cross(dy, N), r2 = cross(N, dx); float det = dot(dx, r1);
      N = normalize(abs(det) * N - sign(det) * (dFdx(hh) * r1 + dFdy(hh) * r2)); d = dot(N, L);
      C *= 1.0 + (h - 0.5) * 0.3 * uSurf.z; rough = clamp(rough + (h - 0.5) * 0.2 * uSurf.z, 0.0, 1.0);
    }
    vec3 base = toLinear(C);
    float a = max(0.04, rough), NoV = max(dot(N, V), 1e-4); rough = a; a *= a;
    vec3 F0 = mix(vec3(0.04), base, metal), diffC = base * (1.0 - metal);
    vec3 H = normalize(L + V);
    float NoL = max(d, 0.0), NoH = max(dot(N, H), 0.0), VoH = max(dot(V, H), 0.0);
    float D = a * a / (3.14159 * pow(NoH * NoH * (a * a - 1.0) + 1.0, 2.0));
    float Vis = 0.5 / (NoL * sqrt(NoV * NoV * (1.0 - a * a) + a * a) + NoV * sqrt(NoL * NoL * (1.0 - a * a) + a * a) + 1e-5);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);
    float NoLw = max((d + uMat.z) / (1.0 + uMat.z), 0.0);  // wrapped: light passing into soft tissue
    vec3 direct = (diffC / 3.14159 * (1.0 - F) * NoLw + D * Vis * F * NoL) * 2.6 * sh;
    vec2 ab = envBRDF(NoV, rough);
    vec3 R = reflect(-V, N);
    vec3 spec = env(R, rough * uEnvMax) * (F0 * ab.x + ab.y);
    vec3 irr = env(N, uEnvMax);
    col = (direct + (diffC * irr * (1.0 + uMat.z * pow(1.0 - NoV, 2.0)) + spec) * ao) * uExposure;
    col = toSRGB(neutral(col));
    if (uRefr > 0.0) {  // glass that bends what is behind it: the picture so far, sampled where the normal sends it
      vec4 b = texture2D(uBack, gl_FragCoord.xy / uView - (uVP * vec4(N, 0.0)).xy * 0.05 * uRefr);
      al = uAlpha + (1.0 - uAlpha) * b.a;
      col = (col * uAlpha + b.rgb * mix(vec3(1.0), C, 0.2 + 0.5 * (1.0 - NoV)) * (1.0 - uAlpha) * b.a) / al;
    }
#else
    // WebGL 1: the same look, approximated (a sky gradient and two softboxes in place of the environment map)
    float metal = uMat.x, rough = uMat.y;
    vec3 H = normalize(L + V), R = reflect(-V, N);
    float spec = pow(max(dot(N, H), 0.0), mix(160.0, 8.0, rough)) * mix(0.35, 1.2, 1.0 - rough);
    vec3 sky = mix(vec3(0.015, 0.017, 0.02), vec3(0.28, 0.31, 0.36), smoothstep(-0.05, 0.85, R.y));
    sky += vec3(1.0, 0.98, 0.95) * smoothstep(0.80, 0.97, dot(R, normalize(vec3(-0.55, 0.55, 0.65)))) * 2.4;
    sky += vec3(0.75, 0.85, 1.0) * smoothstep(0.86, 0.98, dot(R, normalize(vec3(0.75, 0.25, -0.45)))) * 1.3;
    float hz = (R.y - 0.12) * 9.0; sky += vec3(0.9) * exp(-hz * hz) * 0.55;  // (pow of a negative number is undefined)
    float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 diff = C * (0.06 + 0.9 * max((d + uMat.z) / (1.0 + uMat.z), 0.0) * sh) * (1.0 - metal);
    vec3 refl = mix(vec3(0.04) + fres * 0.6, C, metal) * mix(sky, vec3(dot(sky, vec3(0.33))), rough * 0.6) * mix(1.0, 0.5, rough);
    col = (diff + refl * ao + spec * sh * mix(vec3(1.0), C, metal) + fres * 0.08) * mix(0.6, 1.0, ao);
    col = toSRGB(neutral(col * 0.95));
#endif
  }
#endif
  col += uEmit;
  col = mix(col, vec3(1.0, 0.82, 0.35), uHi * 0.35);
  gl_FragColor = vec4(col, al);
}`;

// ---- depth only, for the shadow map
const DEPTH_FS = `uniform vec4 uPlane; uniform float uCut; varying vec3 vW; varying vec3 vN; varying float vAO;
void main() { if (uCut > 0.5 && dot(uPlane.xyz, vW) + uPlane.w > 0.0) discard; gl_FragColor = vec4(1.0); }`;

// ---- emission only, for the glow
const GLOW_FS = `uniform vec3 uEmit; uniform vec4 uPlane; uniform float uCut; varying vec3 vW; varying vec3 vN; varying float vAO;
void main() { if (uCut > 0.5 && dot(uPlane.xyz, vW) + uPlane.w > 0.0) discard; gl_FragColor = vec4(uEmit, 1.0); }`;

// ---- the ground: a disc under the model that only shows the shadow (and a soft contact shadow)
const GROUND_VS = `attribute vec4 aPos; uniform mat4 uVP; uniform vec3 uCenter; uniform float uRadius; uniform float uY;
#ifdef SHADOWS
uniform mat4 uLightVP; varying vec4 vSh;
#endif
varying vec2 vUV;
void main() { vec3 w = vec3(uCenter.x + aPos.x * uRadius, uY, uCenter.z + aPos.y * uRadius); vUV = aPos.xy;
#ifdef SHADOWS
  vSh = uLightVP * vec4(w, 1.0);
#endif
  gl_Position = uVP * vec4(w, 1.0); }`;
const GROUND_FS = `uniform float uStyle; uniform float uDpr; uniform float uContact; varying vec2 vUV;
#ifdef SHADOWS
uniform sampler2DShadow uShadow; uniform float uShadowTexel; varying vec4 vSh;
float shadow() { vec3 p = vSh.xyz / vSh.w * 0.5 + 0.5; if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 1.0;
  float s = 0.0; for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) s += texture(uShadow, vec3(p.xy + vec2(float(i), float(j)) * uShadowTexel * 2.0, p.z - 0.002));
  return s / 25.0; }
#else
float shadow() { return 1.0; }
#endif
void main() {
  float r = length(vUV), fade = 1.0 - smoothstep(0.55, 1.0, r);   // (smoothstep needs edge0 < edge1)
  float contact = uContact * (1.0 - smoothstep(0.0, 0.62, r)) * 0.55;
  float dark = max((1.0 - shadow()) * 0.55, contact) * fade;
  if (dark < 0.004) discard;
  if (uStyle < 0.5) {  // ink: the shadow is pencil hatching on the paper
    vec2 fc = gl_FragCoord.xy / uDpr;
    float h = step(0.5, fract((fc.x - fc.y) / 4.0));
    gl_FragColor = vec4(vec3(0.11, 0.10, 0.12), dark * (0.35 + 0.65 * h));
  } else gl_FragColor = vec4(0.0, 0.0, 0.0, dark * 1.2);
}`;

// ---- full-screen passes: blur and add the glow; draw the studio environment into a cube map, and prefilter it
const QUAD_VS = `attribute vec4 aPos; varying vec2 vUV; void main() { vUV = aPos.xy * 0.5 + 0.5; gl_Position = vec4(aPos.xy, 0.0, 1.0); }`;
const BLUR_FS = `uniform sampler2D uTex; uniform vec2 uDir; varying vec2 vUV;
void main() { vec3 c = texture2D(uTex, vUV).rgb * 0.227;
  c += (texture2D(uTex, vUV + uDir * 1.385).rgb + texture2D(uTex, vUV - uDir * 1.385).rgb) * 0.316;
  c += (texture2D(uTex, vUV + uDir * 3.231).rgb + texture2D(uTex, vUV - uDir * 3.231).rgb) * 0.070;
  gl_FragColor = vec4(c, 1.0); }`;
// added onto the picture; its opacity is the glow's own strength, so a halo shows over the page but the page is not covered
const ADD_FS = `uniform sampler2D uTex; uniform float uGain; varying vec2 vUV; void main() { vec3 c = texture2D(uTex, vUV).rgb * uGain; gl_FragColor = vec4(c, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0)); }`;
const STUDIO = `
uniform vec3 uSky; uniform vec3 uKey; uniform vec3 uFill;  // the environment's colours (studio, warm, night)
vec3 studio(vec3 R) {  // dark floor and walls, a dim ceiling, two softboxes, a bright horizon line (linear light)
  vec3 c = mix(uSky * 0.075, uSky, smoothstep(-0.05, 0.85, R.y));
  c += uKey * smoothstep(0.80, 0.97, dot(R, normalize(vec3(-0.55, 0.55, 0.65))));
  c += uFill * smoothstep(0.86, 0.98, dot(R, normalize(vec3(0.75, 0.25, -0.45))));
  float hz = (R.y - 0.12) * 9.0; c += (uSky.r + uSky.g + uSky.b) * 1.29 * exp(-hz * hz);
  return c;
}
vec3 faceDir(int f, vec2 uv) { vec2 p = uv * 2.0 - 1.0;
  if (f == 0) return normalize(vec3(1.0, -p.y, -p.x)); if (f == 1) return normalize(vec3(-1.0, -p.y, p.x));
  if (f == 2) return normalize(vec3(p.x, 1.0, p.y)); if (f == 3) return normalize(vec3(p.x, -1.0, -p.y));
  if (f == 4) return normalize(vec3(p.x, -p.y, 1.0)); return normalize(vec3(-p.x, -p.y, -1.0)); }
vec4 encode(vec3 c) {
#ifdef RGBM
  c /= 6.0; float m = clamp(max(max(c.r, c.g), max(c.b, 1e-6)), 0.0, 1.0); m = ceil(m * 255.0) / 255.0; return vec4(c / m, m);
#else
  return vec4(c, 1.0);
#endif
}`;
const ENV_FS = `uniform int uFace; varying vec2 vUV;` + STUDIO + `
void main() { gl_FragColor = encode(studio(faceDir(uFace, vUV))); }`;
// prefiltering for a roughness: GGX-importance-sampled reflections of the environment, computed analytically from studio()
const PREFILTER_FS = `uniform int uFace; uniform float uRough; varying vec2 vUV;` + STUDIO + `
void main() {
  vec3 N = faceDir(uFace, vUV), up = abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), T = normalize(cross(up, N)), B = cross(N, T);
  float a = uRough * uRough; vec3 sum = vec3(0.0); float w = 0.0;
  for (int i = 0; i < 96; i++) {
    float u = (float(i) + 0.5) / 96.0, v = fract(float(i) * 0.6180339887);
    float ct = sqrt((1.0 - u) / (1.0 + (a * a - 1.0) * u)), st = sqrt(1.0 - ct * ct), ph = 6.2831853 * v;
    vec3 H = T * (st * cos(ph)) + B * (st * sin(ph)) + N * ct, L = 2.0 * dot(N, H) * H - N;
    float nl = dot(N, L); if (nl > 0.0) { sum += studio(L) * nl; w += nl; }
  }
  gl_FragColor = encode(sum / max(w, 1e-4));
}`;

export { header, PART_VS, PART_FS, DEPTH_FS, GLOW_FS, GROUND_VS, GROUND_FS, QUAD_VS, BLUR_FS, ADD_FS, ENV_FS, PREFILTER_FS };
