/* global LK3D */ // (in the page: the engine, put there by addScriptTag)
// Is this build slower than the last one published? The current dist/lk3d.min.js (the candidate) against a base (the
// published lk3d@latest, fetched with npm pack, or BASE=path), each scene drawn in a fresh page, the two in turn, round
// after round, with the CPU at 1× and slowed 6×: the time to the first picture, and the median frame while the view
// turns. A metric is flagged only when the candidate is slower in a paired t-test (p < 0.05) and by more than 15 %; a
// metric whose runs spread by more than 10 % is inconclusive and passes. (Babylon.js gates its releases the same way.)
// On Linux, without a GPU, Chromium draws in software (SwiftShader): the times are then only good for comparing the two.
//   npm run build && node test/bench/ab.mjs        ROUNDS=10 SCENES=cell,engine RATES=1,6 BASE=old.js CANDIDATE=new.js
// Exit code 1 when something is flagged; the summary also goes to $GITHUB_STEP_SUMMARY when it is set (the nightly job).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const LK = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const { chromium } = require(LK + '/node_modules/playwright');

const rounds = Number(process.env.ROUNDS || 10),
  scenes = (process.env.SCENES || 'cell,engine,molecules,generator').split(','),
  rates = (process.env.RATES || '1,6').split(',').map(Number);
const say = (line) => {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + '\n');
};

// the base: given, or the published package's script
function baseScript() {
  if (process.env.BASE) return fs.readFileSync(process.env.BASE, 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lk3d-base-'));
  const tgz = execFileSync('npm', ['pack', 'lk3d@latest', '--silent', '--pack-destination', dir], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .pop();
  execFileSync('tar', ['-xzf', path.join(dir, tgz), '-C', dir]);
  return fs.readFileSync(path.join(dir, 'package/dist/lk3d.min.js'), 'utf8');
}
let base;
try {
  base = baseScript();
} catch (error) {
  say(`inconclusive: no base to compare with (${String(error.message).split('\n')[0]})`);
  process.exit(0);
}
const candidate = fs.readFileSync(process.env.CANDIDATE || LK + '/dist/lk3d.min.js', 'utf8');

const browser = await chromium.launch({
  args: process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] : [],
});
// one scene drawn by one engine: ms to the first picture, and the median frame over 1.5 s of turning
async function measure(engine, scene, rate) {
  const context = await browser.newContext({ viewport: { width: 640, height: 480 } }),
    page = await context.newPage(),
    cdp = await context.newCDPSession(page);
  await page.setContent(
    '<!doctype html><meta charset=utf-8><body style="margin:0"><div id=g style="width:640px"></div>',
  );
  await page.addScriptTag({ content: engine });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const result = await page.evaluate(async (scene) => {
    // the first picture timed from the page's call to mount (the engine's own stats count from inside it)
    const called = performance.now(),
      fig = LK3D.mount(document.getElementById('g'), JSON.parse(scene)),
      returned = performance.now();
    while (fig.stats().firstFrameMs == null && performance.now() - returned < 30000)
      await new Promise((r) => setTimeout(r, 10));
    const stats = fig.stats(),
      first = returned - called - (stats.setupMs ?? 0) + stats.firstFrameMs,
      times = [];
    let last = performance.now(),
      yaw = 0;
    await new Promise((done) => {
      const end = performance.now() + 1500;
      const step = (now) => {
        times.push(now - last);
        last = now;
        fig.view({ yaw: (yaw += 2) });
        if (now < end) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    times.shift();
    times.sort((a, b) => a - b);
    return { first, frame: times[Math.floor(times.length / 2)] };
  }, scene);
  await context.close();
  return result;
}

// Student's t, two-sided p for t with df degrees of freedom (through the regularized incomplete beta function)
function pValue(t, df) {
  const x = df / (df + t * t);
  return incompleteBeta(x, df / 2, 0.5);
}
function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a);
  // Lentz's continued fraction
  let f = 1,
    c = 1,
    d = 0;
  for (let i = 0; i <= 200; i++) {
    const m = Math.floor(i / 2),
      numerator =
        i === 0
          ? 1
          : i % 2
            ? -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1))
            : (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + numerator * d;
    d = Math.abs(d) < 1e-30 ? 1e-30 : d;
    d = 1 / d;
    c = 1 + numerator / c;
    c = Math.abs(c) < 1e-30 ? 1e-30 : c;
    f *= c * d;
    if (Math.abs(1 - c * d) < 1e-12) break;
  }
  return (front * (f - 1)) / a;
}
function logGamma(z) {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < 8; i++) x += g[i] / (z + i + 1);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length,
  spread = (xs) => Math.sqrt(xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / (xs.length - 1)) / mean(xs);

const runs = {}; // scene@rate → { base: {first: [], frame: []}, candidate: {…} }
for (let round = 0; round < rounds; round++)
  for (const name of scenes) {
    const scene = fs.readFileSync(`${LK}/test/visual/scenes/${name}.json`, 'utf8');
    for (const rate of rates) {
      const key = `${name} at ${rate}×`,
        entry = (runs[key] ??= { base: { first: [], frame: [] }, candidate: { first: [], frame: [] } });
      // (in turn, the order swapped each round: neither always draws on a warmer machine)
      for (const which of round % 2 ? ['candidate', 'base'] : ['base', 'candidate']) {
        const r = await measure(which === 'base' ? base : candidate, scene, rate);
        entry[which].first.push(r.first);
        entry[which].frame.push(r.frame);
      }
    }
  }
await browser.close();

say(`lk3d speed: the current build against ${process.env.BASE || 'lk3d@latest'}, ${rounds} rounds`);
say('');
say('| scene | metric | base (ms) | candidate (ms) | change | p | verdict |');
say('| --- | --- | ---: | ---: | ---: | ---: | --- |');
let flagged = 0,
  inconclusive = 0;
for (const [key, { base: b, candidate: c }] of Object.entries(runs))
  for (const metric of ['first', 'frame']) {
    const diffs = c[metric].map((v, i) => v - b[metric][i]),
      n = diffs.length,
      sd = Math.sqrt(diffs.reduce((s, d) => s + (d - mean(diffs)) ** 2, 0) / Math.max(1, n - 1)),
      t = sd > 0 ? mean(diffs) / (sd / Math.sqrt(n)) : 0,
      p = n > 1 && sd > 0 ? pValue(t, n - 1) : 1,
      change = mean(c[metric]) / mean(b[metric]) - 1,
      noisy = Math.max(spread(b[metric]), spread(c[metric])) > 0.1;
    const verdict =
      p < 0.05 && change > 0.15 && t > 0
        ? noisy
          ? 'inconclusive (slower, but noisy)'
          : 'flagged'
        : noisy
          ? 'inconclusive'
          : 'no change';
    if (verdict === 'flagged') flagged++;
    if (verdict.startsWith('inconclusive')) inconclusive++;
    say(
      `| ${key} | ${metric === 'first' ? 'first picture' : 'median frame'} | ${mean(b[metric]).toFixed(1)} | ` +
        `${mean(c[metric]).toFixed(1)} | ${(change * 100).toFixed(0)} % | ${p.toFixed(3)} | ${verdict} |`,
    );
  }
say('');
say(
  flagged ? `flagged: ${flagged} metric(s) slower` : inconclusive ? 'no change found (some inconclusive)' : 'no change',
);
process.exitCode = flagged ? 1 : 0;
