// The fallback where there is no WebGL: Canvas 2D, flat shading in the same bands, triangles sorted far to near.
// Same interface as the WebGL renderer; it draws the coarser geometry the scene was built with for it.
import { M, sub, cross, dot, norm } from './math.js';

function canvasRenderer(cv, scene) {
  const g = cv.getContext('2d');
  // balls, without depth: in the three colour bands of the WebGL renderer, one fill each
  function balls(h, f, VP, W, H) {
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
      g.fillStyle = `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
      g.beginPath();
      for (let j = 0; j < b.length; j += 3) {
        g.moveTo(b[j] + b[j + 2], b[j + 1]);
        g.arc(b[j], b[j + 1], b[j + 2], 0, 6.3);
      }
      g.fill();
    });
  }
  return {
    kind: '2d',
    hifi: false,
    shadows: false,
    setAO() {},
    draw(f) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      const tris = [],
        ink = f.style === 'ink',
        L = f.look.light,
        VP = f.VP,
        W = cv.width,
        H = cv.height;
      for (const p of f.parts) {
        if (p.drawAlpha < 0.05) continue;
        const base = ink ? p.color : p.studioColor,
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
              if (
                (scr[3 * b2] - scr[3 * a]) * (scr[3 * c + 1] - scr[3 * a + 1]) -
                  (scr[3 * b2 + 1] - scr[3 * a + 1]) * (scr[3 * c] - scr[3 * a]) >=
                0
              )
                continue; // facing away
              const A = [wp[3 * a], wp[3 * a + 1], wp[3 * a + 2]];
              const nrm = norm(
                  cross(
                    sub([wp[3 * b2], wp[3 * b2 + 1], wp[3 * b2 + 2]], A),
                    sub([wp[3 * c], wp[3 * c + 1], wp[3 * c + 2]], A),
                  ),
                ),
                d = dot(nrm, L);
              const lit = ink ? (d > 0.55 ? 1 : d > 0.05 ? 0.82 : 0.64) : 0.35 + 0.65 * Math.max(0, d);
              const C = b.geo.c,
                al = C ? (C[4 * a + 3] + C[4 * b2 + 3] + C[4 * c + 3]) / 765 : 0; // vertex colours, averaged
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
        g.fillStyle = `rgb(${h.color.map((v) => Math.round(v * 255)).join(',')})`;
        for (let i = 0; i < h.count; i++) {
          const s = M.project(VP, [h.pos4[4 * i], h.pos4[4 * i + 1], h.pos4[4 * i + 2]], W, H);
          if (s) {
            g.beginPath();
            g.arc(s[0], s[1], 2.5 * f.dpr, 0, 6.3);
            g.fill();
          }
        }
      }
    },
    dispose() {},
  };
}

export { canvasRenderer };
