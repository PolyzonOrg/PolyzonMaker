// The background of the Mac disk image's window, drawn as a page and shot at 1x and 2x:
// node make-background.mjs [out-dir], by default this folder. Needs Microsoft Edge (the one in Windows, or EDGE=<path>).
// The window shows 660 × 420 under its title bar, as settings.py sets it; the app's icon stands at (165, 200),
// Applications at (495, 200). The picture is 460 high, so a taller title bar on another macOS never shows its edge.
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const [out = here] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const ROOT = join(here, '../../../..');
const boat = readFileSync(`${ROOT}/apps/desktop/public/boat.svg`, 'utf8').replace('fill="black"', 'fill="currentColor"');
// No words: the window says what to do by its look. A print bed of dots, two plates where the icons land, a toolpath
// arrow from the app to Applications, and the boat between them. Flat: no gradients, glows or shadows.
const dots = `<svg class="bed" viewBox="0 0 660 460"><defs><pattern id="d" width="22" height="22" patternUnits="userSpaceOnUse" x="11" y="2"><circle cx="11" cy="11" r="1.1" fill="#2c2c31"/></pattern></defs><rect width="660" height="460" fill="url(#d)"/></svg>`;
// the arrow leaves the app's plate and lands on Applications: a dotted arc, as a print head travels, and a solid head
// along the arc's last direction
const [a, c, b] = [[270, 182], [330, 112], [386, 176]];
const dir = Math.atan2(b[1] - c[1], b[0] - c[0]);
const tip = [b[0] + 12 * Math.cos(dir), b[1] + 12 * Math.sin(dir)];
const at = (len, side) => [tip[0] - len * Math.cos(dir) + side * Math.sin(dir), tip[1] - len * Math.sin(dir) - side * Math.cos(dir)].map((v) => v.toFixed(1)).join(' ');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; width: 660px; height: 460px; overflow: hidden; }
body { position: relative; background: #141416; }
svg { position: absolute; }
.bed, .arrow { inset: 0; width: 660px; height: 460px; }
/* where each icon lands: a flat plate, as the app's cards */
.plate { position: absolute; top: 108px; width: 184px; height: 200px; border-radius: 30px; background: #1c1c1f; box-sizing: border-box; border: 1px solid rgba(255, 255, 255, 0.05); }
.app { left: 73px; }
.apps { left: 403px; }
.boat { left: 296px; top: 238px; width: 68px; height: 72px; color: #26262b; }
</style></head><body>
${dots}
<div class="plate app"></div><div class="plate apps"></div>
${boat.replace('<svg ', '<svg class="boat" aria-hidden="true" ')}
<svg class="arrow" viewBox="0 0 660 460" fill="none">
	<path d="M${a.join(' ')} Q${c.join(' ')} ${b.join(' ')}" stroke="#a3a3ab" stroke-width="3" stroke-linecap="round" stroke-dasharray="0.1 9"/>
	<path d="M${tip.map((v) => v.toFixed(1)).join(' ')} L${at(15, 8)} L${at(15, -8)} Z" fill="#a3a3ab" stroke="#a3a3ab" stroke-width="2" stroke-linejoin="round"/>
</svg>
</body></html>`;
const page = join(tmpdir(), 'maker-dmg-bg.html');
writeFileSync(page, html);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9799;
const profile = join(tmpdir(), 'maker-dmg-' + Date.now());
const EDGE = process.env.EDGE ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 120 && !target; i++) {
	await sleep(500);
	try {
		target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
	} catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = new Map();
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id) waiting.get(m.id)?.(m), waiting.delete(m.id);
};
const send = (method, params = {}) => new Promise((r) => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await send('Page.enable');
for (const [scale, name] of [[1, 'background.png'], [2, 'background@2x.png']]) {
	await send('Emulation.setDeviceMetricsOverride', { width: 660, height: 460, deviceScaleFactor: scale, mobile: false });
	await send('Page.navigate', { url: 'file:///' + page.replaceAll('\\', '/') });
	await sleep(1200);
	const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 660, height: 460, scale: 1 } });
	writeFileSync(join(out, name), Buffer.from(r.result.data, 'base64'));
	console.log(name);
}
ws.close();
try {
	execSync(`taskkill /PID ${browser.pid} /T /F`, { stdio: 'ignore' });
} catch {}
process.exit(0);
