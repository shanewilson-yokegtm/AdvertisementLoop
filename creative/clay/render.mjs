import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
import { spawn } from 'child_process';
import fs from 'fs';
const [,, spot, ratio, mode, ...rest] = process.argv; // mode: stills t1,t2.. | video out.mp4
import http from 'http'; import path from 'path'; import { fileURLToPath } from 'url';
// Serve this folder locally (the canvas must be same-origin to export frames).
const here = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
const srv = http.createServer((q, r) => { const f = path.join(here, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(here) || !fs.existsSync(f)) { r.writeHead(404).end(); return; } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise(res => srv.listen(0, res)); const port = srv.address().port;
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(`http://localhost:${port}/page.html`);
await p.evaluate(async () => { await document.fonts.load('600 40px "Instrument Sans"'); await document.fonts.ready; const i = document.getElementById('logo'); if (!i.complete) await new Promise(r => i.onload = r); });
const grab = async (t, q) => Buffer.from((await p.evaluate(([s, r, t, q]) => { const c = document.getElementById('c'); drawFrame(c, s, r, t, document.getElementById('logo')); return c.toDataURL('image/jpeg', q); }, [spot, ratio, t, q])).split(',')[1], 'base64');
if (mode === 'stills') { for (const t of rest[0].split(',').map(Number)) fs.writeFileSync(`still_${spot}_${ratio}_${t}.jpg`, await grab(t, 0.9)); }
else {
  const out = rest[0], tmp = out.replace(/\.mp4$/, '.tmp.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
  const meta = await p.evaluate(s => ({ cut: SPOTS[s].cut ?? 2.0, total: SPOTS[s].total ?? 5.0 }), spot); let endBuf = null;
  for (let f = 0; f < Math.round(meta.total * 30); f++) { const t = f / 30; let buf; if (t >= meta.cut) { endBuf ??= await grab(t, 0.95); buf = endBuf; } else buf = await grab(t, 0.95); if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r)); }
  ff.stdin.end(); const code = await new Promise(r => ff.on('close', r));
  if (code === 0) fs.renameSync(tmp, out); else console.error('ffmpeg failed', code);
}
await b.close(); srv.close();
