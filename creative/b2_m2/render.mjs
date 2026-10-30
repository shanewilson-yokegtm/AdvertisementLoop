// node render.mjs stills 0.5,3,6.6 | node render.mjs video out.mp4 [poster.jpg]
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
import { spawn } from 'child_process'; import fs from 'fs'; import http from 'http'; import path from 'path'; import { fileURLToPath } from 'url';
const [,, mode, arg, poster] = process.argv;
// Serve creative/ (shares fonts and lockups with the clay series); canvas must be same-origin.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404).end(); return; } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise(res => srv.listen(0, res));
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(`http://localhost:${srv.address().port}/b2_m2/page.html`);
await p.evaluate(async () => { await document.fonts.load('700 40px "Instrument Sans"'); await document.fonts.ready; const i = document.getElementById('logo'); if (!i.complete) await new Promise(r => i.onload = r); });
const grab = async (t, q) => Buffer.from((await p.evaluate(([t, q]) => { const c = document.getElementById('c'); drawFrame(c, t, document.getElementById('logo')); return c.toDataURL('image/jpeg', q); }, [t, q])).split(',')[1], 'base64');
if (mode === 'stills') { for (const t of arg.split(',').map(Number)) fs.writeFileSync(`still_${t}.jpg`, await grab(t, 0.9)); }
else {
  const out = arg, tmp = out.replace(/\.mp4$/, '.tmp.mp4'), total = await p.evaluate(() => window.TOTAL);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = 0; f < Math.round(total * 30); f++) { const buf = await grab(f / 30, 0.95); if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r)); }
  ff.stdin.end(); const code = await new Promise(r => ff.on('close', r));
  if (code === 0) fs.renameSync(tmp, out); else console.error('ffmpeg failed', code);
  if (poster) fs.writeFileSync(poster, await grab(await p.evaluate(() => window.POSTER), 0.9));
}
await b.close(); srv.close();
