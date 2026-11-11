// Screenshot harness (headless Chromium, software WebGL).
//
//   node tools/shot.mjs <out.png> "<query string>" [--size=1280x720] [--page=index.html]
//                       [--wait=ms] [--timeout=ms] [--eval="js run in page before capture"]
//                       [--keys=w:1500,space:200] [--frames=N]
//
// Example:
//   node tools/shot.mjs /tmp/a.png "mode=world&body=Aurelia&lat=12&lon=20&alt=3&tod=0.3"
//
// `shot=1` is always added: fixed timestep, no intro, UI hidden (add ui=1 to
// show it). The page sets window.__ready when the mode has settled; the script
// then optionally evaluates --eval, waits --wait ms and captures. Console
// errors and window.__errors are printed, exit code 2 if any were found.
// Software rendering is slow (often 1-10 fps): prefer small sizes while iterating.
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || '1']; }));
const [out = 'shot.png', query = ''] = argv.filter((a) => !a.startsWith('--'));
const [W, H] = (flags.size || '1280x720').split('x').map(Number);

const { server, port } = await serve(0);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (flags.verbose) console.log('[page]', m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const q = query.includes('shot=') ? query : (query ? query + '&' : '') + 'shot=1';
const url = `http://127.0.0.1:${port}/${flags.page || 'index.html'}?${q}`;
const t0 = Date.now();
let code = 0;
try {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: +(flags.timeout || 180000), polling: 250 });
  if (flags.keys) {
    for (const part of flags.keys.split(',')) {
      const [key, ms] = part.split(':');
      const k = key.length === 1 ? 'Key' + key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
      await page.keyboard.down(k); await page.waitForTimeout(+(ms || 200)); await page.keyboard.up(k);
    }
  }
  if (flags.eval) await page.evaluate(flags.eval);
  if (flags.frames) {
    const target = await page.evaluate((n) => window.__ctx.frame + n, +flags.frames);
    await page.waitForFunction((t) => window.__ctx.frame >= t, target, { timeout: +(flags.timeout || 180000), polling: 100 });
  }
  if (flags.wait) await page.waitForTimeout(+flags.wait);
  // freeze the render loop so the compositor is idle while we capture
  await page.evaluate(() => { window.__ctx.paused = true; });
  await page.waitForTimeout(150);
  await page.screenshot({ path: out, timeout: 120000 });
  const info = await page.evaluate(() => ({ errors: window.__errors || [], frame: window.__ctx ? window.__ctx.frame : -1, calls: window.__ctx ? window.__ctx.renderer.info.render.calls : 0, tris: window.__ctx ? window.__ctx.renderer.info.render.triangles : 0 }));
  for (const e of info.errors) if (!errors.includes(e)) errors.push(e);
  console.log(`saved ${out}  ${W}x${H}  ${((Date.now() - t0) / 1000).toFixed(1)}s  frames=${info.frame} calls=${info.calls} tris=${info.tris}`);
} catch (e) {
  console.error('shot failed:', e.message);
  try { await page.screenshot({ path: out }); console.error(`(saved what was on screen to ${out})`); } catch {}
  const pe = await page.evaluate(() => window.__errors || []).catch(() => []);
  for (const x of pe) if (!errors.includes(x)) errors.push(x);
  code = 1;
}
if (errors.length) { console.error(`--- ${errors.length} page error(s) ---`); for (const e of errors.slice(0, 12)) console.error(String(e).slice(0, 600)); code = code || 2; }
await browser.close();
server.close();
process.exit(code);
