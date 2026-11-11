/* global LK3D */ // (in the page: the engine, put there by addScriptTag)
// lk3d on a phone-like device: Chromium with the CPU slowed (4x and 6x, the usual stand-ins for mid- and low-end
// Android phones), a 390 px screen at 2.75 device pixels per CSS pixel, touch. For each scene: setup, first picture,
// picking ready, crease shading done (ms from mount), then 3 s of turning it a step each frame (frame ms, median and
// 95th percentile). The GPU is the machine's own, not slowed: frame times show the engine's CPU work, not a phone GPU.
//   npm run build && node test/bench/phone.mjs        SCENES=cell,engine RATES=1,6 ENGINE=path/to/lk3d.min.js node test/bench/phone.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const LK = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const { chromium } = require(LK + '/node_modules/playwright');
const engine = fs.readFileSync(process.env.ENGINE || LK + '/dist/lk3d.min.js', 'utf8');
const scenes = (process.env.SCENES || 'generator,cell,engine,solar,molecules').split(',');
const rates = (process.env.RATES || '1,4,6').split(',').map(Number);
const b = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2.75,
  isMobile: true,
  hasTouch: true,
});
const rows = [];
for (const name of scenes) {
  const scene = fs.readFileSync(`${LK}/test/visual/scenes/${name}.json`, 'utf8');
  for (const rate of rates) {
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await p.setContent(
      `<!doctype html><meta charset=utf-8><body style="margin:0"><div id=g style="width:390px"></div>`,
    );
    await p.addScriptTag({ content: engine });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const r = await p.evaluate(async (scene) => {
      const gl = document.createElement('canvas').getContext('webgl2'),
        dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?';
      const t0 = performance.now();
      const fig = LK3D.mount(document.getElementById('g'), JSON.parse(scene));
      const setup = performance.now() - t0;
      const until = async (f, ms = 30000) => {
        const s = performance.now();
        while (!f() && performance.now() - s < ms) await new Promise((r) => setTimeout(r, 20));
        return performance.now() - t0;
      };
      await until(() => fig.stats().firstFrameMs != null);
      await until(() => fig.stats().treesMs != null && fig.stats().aoMs != null, 20000);
      const s0 = fig.stats(),
        first = s0.firstFrameMs,
        ready = Math.max(s0.treesMs ?? -1, s0.aoMs ?? -1);
      // turn it for 3 s, one step a frame, and time the frames
      const times = [];
      let last = performance.now(),
        yaw = 0;
      await new Promise((done) => {
        const end = performance.now() + 3000;
        const step = (now) => {
          times.push(now - last);
          last = now;
          yaw += 2;
          fig.view({ yaw });
          if (now < end) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
      times.shift();
      times.sort((a, b) => a - b);
      const q = (k) => times[Math.min(times.length - 1, Math.floor(k * times.length))];
      const st = fig.stats();
      return {
        gpu,
        setup: Math.round(setup),
        first: Math.round(first),
        ready: Math.round(ready),
        picking: Math.round(s0.treesMs ?? -1),
        shading: Math.round(s0.aoMs ?? -1),
        med: +q(0.5).toFixed(1),
        p95: +q(0.95).toFixed(1),
        frames: times.length,
        tris: st.triangles,
        dpr: st.dpr ?? st.pixelRatio,
        backend: st.backend ?? st.kind,
      };
    }, scene);
    rows.push({ scene: name, cpu: rate + 'x', ...r });
    console.log(JSON.stringify(rows[rows.length - 1]));
    await p.close();
  }
}
await b.close();
