// node render.mjs out.png  -> 1080x1350 PNG of page.html, rendered with Chromium
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'fs'; import http from 'http'; import path from 'path'; import { fileURLToPath } from 'url';
const out = process.argv[2] || 'out.png';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // serve creative/ (shares clay/assets)
const types = { '.html': 'text/html', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404).end(); return; } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise(res => srv.listen(0, res));
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
await p.goto(`http://localhost:${srv.address().port}/b2_s3/page.html`, { waitUntil: 'networkidle' });
await p.evaluate(async () => { await document.fonts.load('700 40px "Instrument Sans"'); await document.fonts.ready; });
await p.screenshot({ path: out, clip: { x: 0, y: 0, width: 1080, height: 1350 } });
await b.close(); srv.close();
