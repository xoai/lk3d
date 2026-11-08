// The fallback where there is no WebGL: Canvas 2D, flat shading in the same bands, triangles sorted far to near.
// Same interface as the WebGL renderer; it draws the coarser geometry the scene was built with for it.
import { M, sub, cross, dot, norm } from './math.js';
import { rampAt, PTS, STRIDE } from './flow.js';

function canvasRenderer(cv, scene) {
  const g = cv.getContext('2d');
  // balls, without depth: in the three colour bands of the WebGL renderer, one fill each
  function balls(h, f, VP, W, H) {
    /** @type {number[][]} */
    const bands = [[], [], []];
    for (let i = 0; i < h.count; i++) {
      const p = [h.pos4[4 * i], h.pos4[4 * i + 1], h.pos4[4 * i + 2]],
        s = M.project(VP, p, W, H);
      if (!s) continue;
      const d = Math.hypot(p[0] - f.eye[0], p[1] - f.eye[1], p[2] - f.eye[2]);
      const w = h.pos4[4 * i + 3];
      bands[w < 0.35 ? 0 : w < 0.65 ? 1 : 2].push(s[0], s[1], Math.max(1, (h.radius * f.pxPerUnit) / d));
    }
    bands.forEach((b, k) => {
      const c = h.ramp[k];
      g.fillStyle = css(c);
      g.beginPath();
      for (let j = 0; j < b.length; j += 3) {
        g.moveTo(b[j] + b[j + 2], b[j + 1]);
        g.arc(b[j], b[j + 1], b[j + 2], 0, 6.3);
      }
      g.fill();
    });
  }
  // flow streaks: each one stroke from head to tail, in the ramp's colour at its head
  const css = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
  function streaks(F, f, VP, W, H) {
    const V = F.verts;
    g.lineWidth = Math.max(1.25, F.width) * f.dpr;
    g.lineCap = 'round';
    g.globalCompositeOperation = f.look.dark ? 'lighter' : 'source-over';
    for (let i = 0; i < F.n; i++) {
      const o = i * PTS * 2 * STRIDE;
      g.globalAlpha = F.opacity * V[o + 8] * 0.6;
      g.strokeStyle = css(rampAt(F.colors, V[o + 7]));
      g.beginPath();
      for (let k = 0; k < PTS; k++) {
        const s = M.project(VP, [V[o + 2 * k * STRIDE], V[o + 2 * k * STRIDE + 1], V[o + 2 * k * STRIDE + 2]], W, H);
        if (s) g.lineTo(s[0], s[1]);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  return {
    kind: '2d',
    hifi: false,
    shadows: false,
    setAO() {},
    draw(f) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      if (f.look.fill) {
        g.fillStyle = css(f.look.fill);
        g.fillRect(0, 0, cv.width, cv.height);
      }
      const tris = [],
        kind = f.look.kind,
        L = f.look.light,
        VP = f.VP,
        W = cv.width,
        H = cv.height;
      for (const p of f.parts) {
        if (p.drawAlpha < 0.05) continue;
        // pen: the part's colour mixed into the near-white solid (all of it for an accent part)
        const base =
            kind === 1
              ? p.studioColor
              : kind === 2
                ? f.look.solid.map((v, i) => v + (p.color[i] - v) * p.tint)
                : p.color,
          hi = p.id === f.hover || p.id === f.selected;
        for (const b of p.batches)
          for (const im of b.mats) {
            const m = M.mul(p.m, im),
              P = b.geo.p,
              I = b.geo.i,
              n = b.geo.count,
              scr = new Float32Array(n * 3),
              wp = new Float32Array(n * 3);
            for (let k = 0; k < n; k++) {
              const w = M.pt(m, [P[3 * k], P[3 * k + 1], P[3 * k + 2]]);
              wp[3 * k] = w[0];
              wp[3 * k + 1] = w[1];
              wp[3 * k + 2] = w[2];
              const s = M.project(VP, w, W, H) || [0, 0, -1];
              scr[3 * k] = s[0];
              scr[3 * k + 1] = s[1];
              scr[3 * k + 2] = s[2];
            }
            for (let t = 0; t < I.length; t += 3) {
              const a = I[t],
                b2 = I[t + 1],
                c = I[t + 2];
              if (scr[3 * a + 2] <= 0 || scr[3 * b2 + 2] <= 0 || scr[3 * c + 2] <= 0) continue;
              const away =
                (scr[3 * b2] - scr[3 * a]) * (scr[3 * c + 1] - scr[3 * a + 1]) -
                  (scr[3 * b2 + 1] - scr[3 * a + 1]) * (scr[3 * c] - scr[3 * a]) >=
                0;
              if (away && !b.geo.twoSided) continue; // facing away (a two-sided surface shows its other face)
              const A = [wp[3 * a], wp[3 * a + 1], wp[3 * a + 2]];
              const nrm = norm(
                  cross(
                    sub([wp[3 * b2], wp[3 * b2 + 1], wp[3 * b2 + 2]], A),
                    sub([wp[3 * c], wp[3 * c + 1], wp[3 * c + 2]], A),
                  ),
                ),
                d = away ? -dot(nrm, L) : dot(nrm, L);
              // the shaders' light: ink's three bands; pen's smooth ramp, deeper than on the GPU (here no outline
              // or edge shows the shape); studio's smooth light
              const x = Math.max(0, Math.min(1, (d + 0.3) / 1)),
                lit =
                  kind === 1
                    ? 0.35 + 0.65 * Math.max(0, d)
                    : kind
                      ? 0.7 + 0.3 * x * x * (3 - 2 * x)
                      : d > 0.55
                        ? 1
                        : d > 0.05
                          ? 0.82
                          : 0.64;
              const C = b.geo.c,
                // vertex colours, averaged (in pen, at most half of theirs unless the part is coloured in full)
                al = C
                  ? ((C[4 * a + 3] + C[4 * b2 + 3] + C[4 * c + 3]) / 765) * (kind === 2 ? Math.max(p.tint, 0.7) : 1)
                  : 0;
              const own = al
                ? base.map((v, i) => v * (1 - al) + ((C[4 * a + i] + C[4 * b2 + i] + C[4 * c + i]) / 765) * al)
                : base;
              const col = own.map((v, i) => Math.round(Math.min(1, v * lit + p.emit[i] * 0.3 + (hi ? 0.12 : 0)) * 255));
              tris.push([
                scr[3 * a],
                scr[3 * a + 1],
                scr[3 * b2],
                scr[3 * b2 + 1],
                scr[3 * c],
                scr[3 * c + 1],
                (scr[3 * a + 2] + scr[3 * b2 + 2] + scr[3 * c + 2]) / 3,
                `rgb(${col.join(',')})`,
                p.drawAlpha,
              ]);
            }
          }
      }
      tris.sort((u, v) => v[6] - u[6]);
      g.lineJoin = 'round';
      for (const t of tris) {
        g.globalAlpha = t[8];
        g.beginPath();
        g.moveTo(t[0], t[1]);
        g.lineTo(t[2], t[3]);
        g.lineTo(t[4], t[5]);
        g.closePath();
        g.fillStyle = t[7];
        g.fill();
        g.strokeStyle = t[7];
        g.lineWidth = 0.6;
        g.stroke();
      }
      g.globalAlpha = 1;
      for (const h of f.particles) {
        if (!h.visible) continue;
        h.update();
        if (h.solid) {
          balls(h, f, VP, W, H);
          continue;
        }
        g.fillStyle = css(h.color);
        for (let i = 0; i < h.count; i++) {
          const s = M.project(VP, [h.pos4[4 * i], h.pos4[4 * i + 1], h.pos4[4 * i + 2]], W, H);
          if (s) {
            g.beginPath();
            g.arc(s[0], s[1], 2.5 * f.dpr, 0, 6.3);
            g.fill();
          }
        }
      }
      for (const F of f.flows || []) streaks(F, f, VP, W, H);
    },
    dispose() {},
  };
}

export { canvasRenderer };
