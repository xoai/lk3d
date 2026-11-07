// The shaders, written once in GLSL ES 1.00 style and compiled as GLSL ES 3.00 on WebGL 2 (a few #defines translate),
// so WebGL 1 and WebGL 2 draw the same thing. The part shader is compiled once per look (INK, PEN, or the studio
// look), so a page that only shows the hand-drawn look never compiles the heavier studio lighting. On WebGL 2 the HIFI path adds physically based shading (the lighting
// model of Google's Filament), light from a generated studio environment, shadows and tone mapping.

function header(gl2, stage, defs) {
  let h = gl2 ? '#version 300 es\n#define GL2 1\n' : '';
  for (const d of defs) h += `#define ${d} 1\n`;
  if (stage === 'vs') h += gl2 ? '#define attribute in\n#define varying out\n' : '';
  else {
    h += gl2
      ? 'precision highp float;\nprecision highp sampler2DShadow;\n#define varying in\nout vec4 fragColor;\n#define gl_FragColor fragColor\n#define texture2D texture\n#define textureCube texture\n'
      : '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
  }
  return h;
}

// ---- the parts: positions and normals arrive compressed (16 and 8 bit), each instance brings its own matrix.
// The ink look shades a curve made of crisp bands (a lathe's profile segments, each with its own normal) by the normal
// averaged where the bands meet (aOut, the outline's) when they meet at a small angle (up to about 30 degrees; from 40,
// where the pen look draws an edge, a crease stays crisp): its hard step from one tone to the next then runs smoothly
// round the curve instead of stepping band by band, and is blended across about a pixel (fwidth), so it is not jagged.
const PART_VS = `
attribute vec4 aPos; attribute vec4 aNrm; attribute vec4 aOut; attribute float aAO; attribute vec4 aCol;
#if defined(HIFI) || defined(CUTS)
attribute vec2 aUV; varying vec2 vUV;
#endif
attribute vec4 aI0; attribute vec4 aI1; attribute vec4 aI2; attribute vec4 aI3;
// the part's own state, the same for each copy (per copy when parts alike are drawn in one call): its colour and how
// much of it the pen look shows (aIC); its glow, and its flags: 1 lit (pointed at or chosen), 2 cut (aIE)
attribute vec4 aIC; attribute vec4 aIE; varying vec4 vIC; varying vec4 vIE;
uniform mat4 uModel; uniform mat4 uVP; uniform vec3 uEye; uniform float uOutline; uniform vec3 uQs; uniform vec3 uQo;
uniform float uViewD;  // the camera's distance in ortho (0 in perspective): what an outline's width scales with
#ifdef SHADOWS
uniform mat4 uLightVP; varying vec4 vSh;
#endif
varying vec3 vW; varying vec3 vN; varying float vAO; varying vec4 vCol; varying vec3 vO;
void main() {
  mat4 m = uModel * mat4(aI0, aI1, aI2, aI3);
  vCol = aCol; vIC = aIC; vIE = aIE;
  vO = aPos.xyz * uQs + uQo;
#if defined(HIFI) || defined(CUTS)
  vUV = aUV;
#endif
  vec4 w = m * vec4(vO, 1.0);
  vec3 nm = aNrm.xyz;
#ifdef INK
  nm = mix(nm, aOut.xyz, smoothstep(0.94, 0.966, dot(normalize(aOut.xyz), normalize(nm))));
#endif
  nm = mat3(m) * nm;
  if (uOutline > 0.0) w.xyz += normalize(mat3(m) * aOut.xyz) * uOutline * (uViewD > 0.0 ? uViewD : length(w.xyz - uEye));
  vW = w.xyz; vN = nm; vAO = aAO;
#ifdef SHADOWS
  // (looked up a little off the surface, along its normal: about two of the shadow map's texels, which are its width,
  // 2 / that row's length, over 1024; a surface the light grazes does not shadow itself in specks)
  vSh = uLightVP * vec4(w.xyz + normalize(nm) * 0.004 / max(length(vec3(uLightVP[0][0], uLightVP[1][0], uLightVP[2][0])), 1e-6), 1.0);
#endif
  gl_Position = uVP * w;
}`;

// CAPS: the caps alone (renderer-gl draws them again where the cut's plane lies inside a solid, counted in the stencil),
// put on the cut's plane instead of the far wall they are drawn with, so whatever lies inside the solid between the two
// (a blade's root buried in its hub, a hub inside a spinner) is hidden, as the solid would hide it. A five-hundredth of the
// way back towards the wall: where two parts' sections overlap, the nearer wall's wins, steadily.
const PART_FS = `
uniform vec3 uColor; uniform float uAlpha; uniform float uFlat; uniform vec3 uMat;  // (uColor: the outline's)
uniform vec3 uLight; uniform vec3 uEye; uniform vec4 uPlane; uniform vec3 uCap;
// (a cap's hatching lies on the cut's plane, every uHatch units: uFwd and uOrtho give the ray from the eye)
uniform vec3 uFwd; uniform float uOrtho; uniform float uHatch;
uniform float uDpr; uniform float uAOk; uniform vec3 uPaper; uniform vec3 uSolid;
varying vec3 vW; varying vec3 vN; varying float vAO; varying vec4 vCol; varying vec3 vO; varying vec4 vIC; varying vec4 vIE;
#ifdef HIFI
uniform samplerCube uEnv; uniform float uEnvMax; uniform float uExposure;
uniform vec3 uSurf; uniform float uRefr; uniform sampler2D uBack; uniform vec2 uView; uniform mat4 uVP;
uniform sampler2D uBase; uniform sampler2D uNorm; uniform sampler2D uMR; uniform vec4 uTex; varying vec2 vUV;
#elif defined(CAPS)
uniform mat4 uVP;
#endif
#ifdef CUTS
uniform sampler2D uBase; uniform vec4 uTex; varying vec2 vUV;  // (the drawn looks: only a cut-out's shape from its map)
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
  float cut = step(1.5, vIE.w), hi = step(0.5, vIE.w - 2.0 * cut);
  if (cut > 0.5 && dot(uPlane.xyz, vW) + uPlane.w > 0.0) discard;
#ifdef CUTS
  if (uTex.x > 0.5 && texture2D(uBase, vUV).a < uTex.w) discard;  // a cut-out's clear texels
#endif
  if (uFlat > 0.5) { gl_FragColor = vec4(uColor, uAlpha); return; }
  vec3 C = mix(vIC.rgb, vCol.rgb, vCol.a);  // a vertex's own colour (atoms, bands, layers) where it has one
  vec2 fc = gl_FragCoord.xy / uDpr;
  if (!gl_FrontFacing && cut > 0.5) {  // the inside of a cut part: a cap in the part's colour, hatched
    // the inside face is drawn where it is (so a cap shows only where the cut runs through material: an inside face
    // behind open space, a bore, is hidden by the nearer wall), hatched where the ray to it crosses the cut's plane,
    // in the plane's own coordinates: the hatching stays put on the section as the camera drifts
    vec3 rd = uOrtho > 0.5 ? uFwd : vW - uEye;
    float den = dot(uPlane.xyz, rd);
    vec3 P = abs(den) > 1e-6 ? vW - rd * ((dot(uPlane.xyz, vW) + uPlane.w) / den) : vW;
    vec3 ax = normalize(cross(uPlane.xyz, abs(uPlane.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    float hs = (dot(P, ax) + dot(P, cross(uPlane.xyz, ax))) / max(uHatch, 1e-4), h = step(0.55, fract(hs));
#ifdef GL2
    h = mix(h, 0.45, smoothstep(0.15, 0.4, fwidth(hs)));  // (lines too fine for the pixels: their even tone, no moiré)
#endif
#ifdef INK
    vec3 cap = mix(C, uCap, 0.35);
#elif defined(PEN)
    vec3 cap = mix(uSolid, uCap, 0.3);
#else
    vec3 cap = mix(C, uCap, 0.25) * 1.15;
#endif
    gl_FragColor = vec4(cap * (0.84 + 0.16 * h), uAlpha);
#ifdef CAPS
    vec4 cp = uVP * vec4(P, 1.0);
    gl_FragDepth = mix(clamp(cp.z / cp.w * 0.5 + 0.5, 0.0, 1.0), gl_FragCoord.z, 0.002);
#endif
    return;
  }
  vec3 N = normalize(gl_FrontFacing ? vN : -vN), L = normalize(uLight), V = normalize(uEye - vW);  // the far side of glass faces us
  float d = dot(N, L), ao = mix(1.0, vAO, uAOk), sh = shadow(), al = uAlpha;
  vec3 col;
#ifdef INK
  {  // ink: three bands of coloured pencil, hatching in the shade and in creases, paper grain
#ifdef GL2
    float aa = fwidth(d) * 0.7 + 1e-4;
#else
    float aa = 1e-4;
#endif
    float lit = mix(mix(0.64, 0.82, smoothstep(0.05 - aa, 0.05 + aa, d)), 1.0, smoothstep(0.55 - aa, 0.55 + aa, d));
    lit = min(lit, sh > 0.5 ? 1.0 : 0.72);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col = C * lit * mix(0.78, 1.0, smoothstep(0.45, 0.85, ao)) + vec3(0.06) * rim;
    float hatch = step(0.5, fract((fc.x - fc.y) / 5.0)), cross2 = step(0.5, fract((fc.x + fc.y) / 5.0));
    if (d <= 0.05 || sh < 0.5) col *= 1.0 - 0.10 * hatch;
    if (ao < 0.55) col *= 1.0 - 0.08 * cross2;
    col *= 0.96 + 0.06 * hash(floor(fc));
    col = mix(col, uPaper, 0.08);
  }
#elif defined(PEN)
  {  // pen: light solids lit from the viewer's upper left (a fifth darker facing away), faces turned up a step
     // lighter; full colour where it means something (vIC.a 1: an accent part, a glowing one, the one chosen), a soft
     // wash of it elsewhere (0.4), a vertex's own colour (an atom's) keeping most of its
    // (a smooth ramp, not steps: a flat face has one normal, so one tone, and neighbouring faces still differ; a curved
    // one shades evenly instead of in stripes)
    float t = mix(0.8, 1.0, smoothstep(-0.3, 0.7, d));
    t = min(1.0, t + 0.05 * smoothstep(0.55, 0.85, N.y));
    col = mix(uSolid, C, max(vIC.a, 0.7 * vCol.a)) * t * mix(0.86, 1.0, smoothstep(0.35, 0.85, ao));
  }
#else
  {
#ifdef HIFI
    // physically based: GGX distribution, correlated Smith visibility, Schlick Fresnel; light from the studio
    // environment (prefiltered by roughness) and one key light that casts shadows
    float rough = uMat.y, metal = uMat.x;
    if (uTex.x > 0.5) {  // a model's own maps: base colour (a cut-out's clear texels dropped), metal-roughness, normals
      vec4 bc = texture2D(uBase, vUV);
      if (bc.a < uTex.w) discard;
      C = bc.rgb;
    }
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
      col = (col * uAlpha + b.rgb * mix(vec3(1.0), C, 0.2 + 0.5 * (1.0 - NoV)) * (1.0 - uAlpha)) / al;  // (b: premultiplied)
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
  col += vIE.rgb;
  float wash = 0.35;
#ifdef HIFI
  // a textured model lit by its rim and a faint wash, so its own colours (a scan's feathers) still read
  if (uTex.x > 0.5) wash = 0.08 + 0.45 * pow(1.0 - max(dot(N, V), 0.0), 2.0);
#endif
  col = mix(col, vec3(1.0, 0.82, 0.35), hi * wash);
  gl_FragColor = vec4(col, al);
}`;

// ---- depth only, for the shadow map (and a cut-out's clear texels casting none)
const DEPTH_FS = `uniform vec4 uPlane; varying vec3 vW; varying vec4 vIE;
#ifdef CUTS
uniform sampler2D uBase; uniform vec4 uTex; varying vec2 vUV;
#endif
void main() {
  if (vIE.w > 1.5 && dot(uPlane.xyz, vW) + uPlane.w > 0.0) discard;
#ifdef CUTS
  if (uTex.x > 0.5 && texture2D(uBase, vUV).a < uTex.w) discard;
#endif
  gl_FragColor = vec4(1.0);
}`;

// ---- emission only, for the glow
const GLOW_FS = `uniform vec4 uPlane; varying vec3 vW; varying vec4 vIE;
void main() { if (vIE.w > 1.5 && dot(uPlane.xyz, vW) + uPlane.w > 0.0) discard; gl_FragColor = vec4(vIE.rgb, 1.0); }`;

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
const GROUND_FS = `uniform float uStyle; uniform float uDpr; uniform float uContact; uniform vec3 uShade; varying vec2 vUV;
uniform float uBlur; uniform float uShadowK;
#ifdef SHADOWS
uniform sampler2DShadow uShadow; uniform float uShadowTexel; varying vec4 vSh;
float shadow() { vec3 p = vSh.xyz / vSh.w * 0.5 + 0.5; if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 1.0;
  float s = 0.0; for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) s += texture(uShadow, vec3(p.xy + vec2(float(i), float(j)) * uShadowTexel * uBlur, p.z - 0.002));
  return s / 25.0; }
#else
float shadow() { return 1.0; }
#endif
void main() {
  float r = length(vUV), fade = 1.0 - smoothstep(0.55, 1.0, r);   // (smoothstep needs edge0 < edge1)
  float contact = uContact * (1.0 - smoothstep(0.0, 0.62, r)) * 0.55;
  float dark = max((1.0 - shadow()) * 0.55, contact) * fade;
  if (dark < 0.004 && (uStyle < 1.5 || r > 0.7)) discard;
  if (uStyle < 0.5) {  // ink: the shadow is pencil hatching on the paper
    vec2 fc = gl_FragCoord.xy / uDpr;
    float h = step(0.5, fract((fc.x - fc.y) / 4.0));
    gl_FragColor = vec4(uShade, dark * (0.35 + 0.65 * h));
  } else if (uStyle > 1.5) gl_FragColor = vec4(uShade, dark * uShadowK / 0.55 + 0.04 * fade * (1.0 - smoothstep(0.0, 0.7, r)));  // pen: the object's soft shadow and a halo
  else gl_FragColor = vec4(uShade, dark * 1.2);
}`;

// ---- flow streaks (flow.js): each vertex pushed sideways across the streak's direction on screen, by half its width
// in pixels; alpha fades from head to tail and across the width, with a little dither against banding, and the
// colour comes from a ramp of four stops along the path. Written premultiplied: over the picture on a light page,
// added to it on a dark one (the blending decides).
const FLOW_VS = `attribute vec4 aPos; attribute vec4 aDir; attribute float aA;
uniform mat4 uVP; uniform vec2 uView; uniform float uWidth; varying float vA; varying float vSide; varying float vT;
varying vec3 vW;
void main() {
  vec4 a = uVP * vec4(aPos.xyz, 1.0), b = uVP * vec4(aPos.xyz + aDir.xyz, 1.0);
  vW = aPos.xyz;
  vec2 d = (b.xy / b.w - a.xy / a.w) * uView;
  d = normalize(d + vec2(1e-6, 0.0));  // (a streak squeezed to a point: any side will do)
  a.xy += vec2(-d.y, d.x) * aPos.w * uWidth / uView * a.w;
  gl_Position = a; vA = aA; vSide = aPos.w; vT = aDir.w;
}`;
const FLOW_FS = `uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform float uAlpha;
uniform vec4 uPlane; uniform float uCut; varying float vA; varying float vSide; varying float vT; varying vec3 vW;
void main() {
  if (uCut > 0.5 && dot(uPlane.xyz, vW) + uPlane.w > 0.0) discard;  // cut away with the parts it flows through
  float x = clamp(vT, 0.0, 1.0) * 3.0;
  vec3 c = x < 1.0 ? mix(uC0, uC1, x) : x < 2.0 ? mix(uC1, uC2, x - 1.0) : mix(uC2, uC3, x - 2.0);
  float a = uAlpha * vA * (1.0 - smoothstep(0.3, 1.0, abs(vSide)));
  a = clamp(a + (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0, 0.0, 1.0);
  gl_FragColor = vec4(c * a, a);
}`;
// ---- edges: where a part's faces meet at an angle (geometry.js edgesOf), thin lines of a constant width on screen,
// each instance of a batch placed by its matrix; nudged towards the eye so the faces they lie on do not hide them, while
// faces in front still do
const EDGE_VS = `attribute vec4 aPos; attribute vec4 aDir; attribute vec3 aFace;
attribute vec4 aI0; attribute vec4 aI1; attribute vec4 aI2; attribute vec4 aI3; attribute vec4 aIC; attribute vec4 aIE;
uniform mat4 uModel; uniform mat4 uVP; uniform vec3 uEye; uniform vec2 uView; uniform float uWidth; uniform float uViewD;
uniform vec3 uLight; varying float vSide; varying vec3 vW; varying float vLit; varying float vTint; varying float vCut;
void main() {
  mat4 m = uModel * mat4(aI0, aI1, aI2, aI3);
  vec4 w = m * vec4(aPos.xyz, 1.0);
  w.xyz += normalize(uEye - w.xyz) * 0.004 * (uViewD > 0.0 ? uViewD : length(uEye - w.xyz));
  vec4 a = uVP * w, b = uVP * (w + vec4(mat3(m) * aDir.xyz, 0.0));
  vec2 d = normalize((b.xy / b.w - a.xy / a.w) * uView + vec2(1e-6, 0.0));
  a.xy += vec2(-d.y, d.x) * aPos.w * uWidth / uView * a.w;
  gl_Position = a; vSide = aPos.w; vW = w.xyz; vLit = dot(normalize(mat3(m) * aFace), uLight);
  vTint = aIC.a; vCut = aIE.w;
}`;
const EDGE_FS = `uniform vec3 uColor; uniform vec3 uLit; uniform float uAlpha; uniform vec4 uPlane;
varying float vSide; varying vec3 vW; varying float vLit; varying float vTint; varying float vCut;
void main() {
  if (vCut > 1.5 && dot(uPlane.xyz, vW) + uPlane.w > 0.0) discard;
  // a lit part's edges light (an accent, a glowing one, the one chosen: as if catching the light); and an edge whose
  // faces turn to the light lighter, one turned away darker (a bevel catching the light)
  vec3 c = vTint > 0.5 ? uLit : uColor;
  gl_FragColor = vec4(min(c * mix(0.8, 1.2, smoothstep(-0.2, 0.7, vLit)), 1.0), uAlpha * (1.0 - smoothstep(0.45, 1.0, abs(vSide))));
}`;

// ---- streams (stream.js): drawn on the back faces of a hull round the path, into a half-size picture of their own.
// Each fragment marches from the hull's far side towards the eye, skipping what lies behind a solid part (the scene's
// depth) or on the cut side; at each sample it finds where it is along the path and how far from it, and builds a
// density there: filaments along the flow (ridges of noise stretched downstream), broken into runs, moving with the
// phase, their coordinates warped by slow noise, more so towards the edge and further downstream; a little haze; faded
// in and out at the ends. The colour comes from the ramp at that point of the path; nearer samples go over farther.
const STREAM_VS = `attribute vec4 aPos; uniform mat4 uVP; varying vec3 vW;
void main() { vW = aPos.xyz; gl_Position = uVP * vec4(aPos.xyz, 1.0); }`;
const STREAM_FS = `uniform vec4 uPts[16]; uniform vec3 uTab[24]; uniform int uN;
uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
uniform vec3 uEye; uniform vec3 uFwd; uniform float uOrtho; uniform mat4 uVP;
uniform sampler2D uDepth; uniform float uHasDepth; uniform vec2 uView;
uniform vec4 uF; uniform vec3 uG; uniform float uDen; uniform vec4 uPlane; uniform float uCut; uniform vec3 uLo; uniform vec3 uHi;
varying vec3 vW;  // uF: how far the air has travelled, the field's scale along the path, reach (how far a ray crosses),
// turbulence; uG: swirl, the path's length, where it fades; uTab: inner and outer radius and travel time along the path
float h3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn(vec3 p) {
  vec3 i = floor(p), f = fract(p), e = vec3(1.0, 0.0, 0.0); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + e), f.x), mix(h3(i + e.yxy), h3(i + e.xxy), f.x), f.y),
    mix(mix(h3(i + e.yyx), h3(i + e.xyx), f.x), mix(h3(i + e.yxx), h3(i + e.xxx), f.x), f.y), f.z);
}
// the nearest point of the path: the direction there (returned), the offset from it (d) and the distance along it (s)
vec3 near(vec3 p, out vec3 d, out float s) {
  float best = 1e9; vec3 T = vec3(1.0, 0.0, 0.0); s = 0.0; d = vec3(0.0);
  for (int k = 0; k < 15; k++) {
    if (k + 1 >= uN) break;
    vec3 a = uPts[k].xyz, ab = uPts[k + 1].xyz - a;
    float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    vec3 q = p - a - ab * t; float dd = dot(q, q);
    if (dd < best) { best = dd; d = q; T = normalize(ab); s = mix(uPts[k].w, uPts[k + 1].w, t); }
  }
  return T;
}
float dens(vec3 p, out float f) {
  vec3 d; float s; vec3 T = near(p, d, s);
  if (dot(d, d) * 6.76 > uF.z * uF.z) return 0.0;  // (beyond the widest it gets: reach is 2.6 times that)
  f = s / uG.y;
  float r = length(d), x = clamp(f, 0.0, 1.0) * 23.0; vec3 R = uTab[0];
  for (int k = 0; k < 23; k++) R += clamp(x - float(k), 0.0, 1.0) * (uTab[k + 1] - uTab[k]);
  float w = R.y - R.x, edge = clamp((R.y - r) / (0.3 * w + 1e-4), 0.0, 1.0) * (R.x > 0.0 ? clamp((r - R.x) / (0.3 * w), 0.0, 1.0) : 1.0);
  if (edge <= 0.0) return 0.0;
  vec3 N = normalize(abs(T.y) < 0.9 ? cross(T, vec3(0.0, 1.0, 0.0)) : cross(T, vec3(1.0, 0.0, 0.0)));
  // across: scaled by the local radius (filaments draw together where the stream narrows); along: by travel time
  vec3 q = vec3((R.z - uF.x) * uF.y, vec2(dot(d, N), dot(d, cross(T, N))) * 11.0 / max(R.y, 0.05));
  vec3 o = vec3(0.0, 0.0, uF.x * uF.y * 0.05), wv = vec3(vn(q * 0.3 + o), vn(q * 0.3 + o + vec3(5.2, 1.3, 0.0)), vn(q * 0.3 + 7.7)) - 0.5;
  q += wv * uF.w * 2.5 * (1.0 + uG.x * f * (1.0 - edge) * 4.0);
  // filaments: thin ridges of noise across the flow, stretched along it; broken into runs
  float fil = pow(1.0 - abs(2.0 * vn(vec3(q.x * 0.06, q.yz)) - 1.0), 6.0) * smoothstep(0.25, 0.7, vn(vec3(q.x * 0.18, q.yz * 0.25 + 9.0)));
  return edge * (0.05 * vn(q * 0.5) + fil) * smoothstep(0.0, 0.06, f) * (1.0 - smoothstep(uG.z, 1.0, f));
}
void main() {
  vec3 dir = uOrtho > 0.5 ? uFwd : normalize(vW - uEye);
  float zs = uHasDepth > 0.5 ? texture2D(uDepth, gl_FragCoord.xy / uView).r : 2.0, f;
  // the march: from the hull's farthest face towards the eye, until the ray leaves the hull's box (the whole of the
  // stream on this ray, however much of it lies along the ray), in 48 steps
  vec3 b = mix(uLo, uHi, step(0.0, -dir)), q = (b - vW) / (-dir + sign(-dir) * 1e-6 + vec3(equal(dir, vec3(0.0))) * 1e-6);
  float st = max(0.0, min(q.x, min(q.y, q.z))) / 48.0, j = fract(52.9829 * fract(dot(gl_FragCoord.xy, vec2(0.06711, 0.00584))));  // (a smooth dither)
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 48; i++) {
    vec3 p = vW - dir * st * (float(i) + j);
    if (uCut > 0.5 && dot(uPlane.xyz, p) + uPlane.w > 0.0) continue;
    vec4 cp = uVP * vec4(p, 1.0);
    if (cp.z / cp.w * 0.5 + 0.5 > zs) continue;
    float a = min(1.0, dens(p, f) * st * 2.0 * uDen);
    if (a <= 0.0) continue;
    float x = clamp(f, 0.0, 1.0) * 3.0;
    vec3 c = x < 1.0 ? mix(uC0, uC1, x) : x < 2.0 ? mix(uC1, uC2, x - 1.0) : mix(uC2, uC3, x - 2.0);
    acc = vec4(c * a, a) + acc * (1.0 - a);
  }
  gl_FragColor = acc;
}`;
// the streams' picture, put on the page (premultiplied: the blending decides over or added)
const COPY_FS = `uniform sampler2D uTex; varying vec2 vUV; void main() { gl_FragColor = texture2D(uTex, vUV); }`;

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
const ENV_FS =
  `uniform int uFace; varying vec2 vUV;` +
  STUDIO +
  `
void main() { gl_FragColor = encode(studio(faceDir(uFace, vUV))); }`;
// prefiltering for a roughness: GGX-importance-sampled reflections of the environment, computed analytically from studio()
const PREFILTER_FS =
  `uniform int uFace; uniform float uRough; varying vec2 vUV;` +
  STUDIO +
  `
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

export {
  header,
  PART_VS,
  PART_FS,
  DEPTH_FS,
  GLOW_FS,
  GROUND_VS,
  GROUND_FS,
  QUAD_VS,
  BLUR_FS,
  ADD_FS,
  FLOW_VS,
  FLOW_FS,
  EDGE_VS,
  EDGE_FS,
  STREAM_VS,
  STREAM_FS,
  COPY_FS,
  ENV_FS,
  PREFILTER_FS,
};
