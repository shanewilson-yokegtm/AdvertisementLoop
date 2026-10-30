// B2 M1 "Follow-up strategy" ad engine (9:16). Draws one frame at time t (seconds) into a canvas.
// Story (Shane, Oct 29): black line "Is this your follow-up strategy?" -> Post-its with follow-up tasks fill in
// around it until they crowd the whole screen -> they pop -> they all fall off -> tagline end card.
// v2 (job e750a027): Yoke slams down on the pile at the pop and blasts the notes off the screen.
const C = { ink: '#111317', canvas: '#F7F4EC', paper: '#FFFFFF', coral: '#F04B37', stone: '#D8D5CD', muted: '#686A63', lime: '#CDF05B' };
const FONT = '"Instrument Sans", system-ui, sans-serif';
const W = 1080, H = 1920;

const T = { hookIn: 0.0, notesStart: 1.3, notesEnd: 6.4, pop: 6.6, fall: 6.85, fallEnd: 8.6, card: 8.7, total: 13.2 };

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const eo = k => 1 - Math.pow(1 - clamp(k), 3);
const eob = (k, s = 1.7) => { k = clamp(k) - 1; return 1 + k * k * ((s + 1) * k + s); };
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// Follow-up tasks (names fictional). Order = order they appear.
const TASKS = [
  'Call Dana back', 'Email Marcus the deck', 'Send today’s outreach', 'Follow up with Priya',
  'Check in after the demo', 'Reply to Jordan', 'Send the recap', 'Book next call w/ Lena',
  'Nudge procurement', 'Call Sam re: pricing', 'Email Acme security docs', 'Ping Alex on LinkedIn',
  'Send case study to Kim', 'Follow up: no reply x2', 'Confirm Tuesday call', 'Send proposal v2',
  'Call back Monday?', 'Intro Ravi to CS', 'Email the champion', 'Re-send calendar invite',
  'Ask for referral', 'Send pricing one-pager', 'Follow up on trial', 'Call Morgan (urgent)',
  'Send contract redlines', 'Thank-you note to Lee', 'Chase signature', 'Loop in their CFO',
  'Send ROI calc', 'Text Jamie back', 'Follow up from event', 'Email 40 new leads',
  'Reply to inbound', 'Call Dana back (again)', 'Send onboarding doc', 'Check renewal date',
];
const NOTE_COLORS = ['#FFE680', '#E4F59C', '#FFD3C9', '#FFE680', '#CFE6F5', '#FFE680'];

// Layout: a jittered grid so the screen ends up fully covered, revealed in shuffled order, faster over time.
const NOTES = (() => {
  const R = rng(7), cols = 3, rows = 12, cw = W / cols, rh = H / rows * 1.0, out = [];
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ c, r });
  // first notes land around the headline, later ones fill everything (cover the line last)
  const cy = H * 0.5;
  cells.forEach(o => { const x = (o.c + 0.5) * cw, y = (o.r + 0.5) * rh; o.d = Math.abs(y - cy) < 240 ? 9 + R() : (1 - Math.abs(y - cy) / H) * 4 + R() * 5; });
  cells.sort((a, b) => a.d - b.d);
  const n = cells.length;
  cells.forEach((o, i) => {
    const k = i / (n - 1);
    // accelerating arrival: early ones slow, later ones rapid
    const at = T.notesStart + Math.pow(k, 0.62) * (T.notesEnd - T.notesStart);
    out.push({
      x: (o.c + 0.5) * cw + (R() - 0.5) * 70, y: (o.r + 0.5) * rh + (R() - 0.5) * 40,
      size: 330 + R() * 50, rot: (R() - 0.5) * 0.22, at,
      color: NOTE_COLORS[Math.floor(R() * NOTE_COLORS.length)], text: TASKS[i % TASKS.length],
      // fall: sideways drift, spin, small stagger
      vx: (R() - 0.5) * 500, spin: (R() - 0.5) * 3.2, fd: R() * 0.45, pop: 0.85 + R() * 0.3,
    });
  });
  return out;
})();

function wrap(ctx, text, maxW) {
  const words = text.split(' '), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}

function drawNote(ctx, n, t) {
  const appear = seg(t, n.at, n.at + 0.28);
  if (appear <= 0) return;
  let x = n.x, y = n.y, rot = n.rot, s = lerp(1.35, 1, eob(appear, 1.4)), a = clamp(appear * 3);
  // pop: everything jolts up a touch
  const p = seg(t, T.pop - 0.12, T.pop + 0.18);
  s *= 1 + Math.sin(p * Math.PI) * 0.09 * n.pop;
  // fall (stagger shrunk so the blast reads as one hit)
  const ft = t - (T.fall + n.fd * 0.35);
  // v2 (review 0bac038e): Yoke slams in and blasts the notes outward from the centre before they fall
  if (ft > 0) { const dx = n.x - W / 2, dy = n.y - H / 2, d = Math.hypot(dx, dy) || 1, push = 1100 * Math.exp(-ft * 2.5);
    y += 0.5 * 4200 * ft * ft - 260 * ft + dy / d * push * ft * 0.6; x += n.vx * ft + dx / d * push * ft; rot += n.spin * ft * 1.6; }
  if (y - n.size > H + 50) return;
  const sz = n.size;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  // shadow
  ctx.save(); ctx.filter = 'blur(12px)'; ctx.fillStyle = 'rgba(40,30,10,0.22)'; ctx.fillRect(-sz / 2 + 6, -sz / 2 + 14, sz, sz); ctx.restore();
  // paper with slight curl at bottom
  ctx.fillStyle = n.color; ctx.beginPath();
  ctx.moveTo(-sz / 2, -sz / 2); ctx.lineTo(sz / 2, -sz / 2); ctx.lineTo(sz / 2, sz / 2 - 8);
  ctx.quadraticCurveTo(0, sz / 2 + 6, -sz / 2, sz / 2); ctx.closePath(); ctx.fill();
  // sticky strip shading
  const g = ctx.createLinearGradient(0, -sz / 2, 0, -sz / 2 + 60); g.addColorStop(0, 'rgba(0,0,0,0.07)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(-sz / 2, -sz / 2, sz, 60);
  // text
  ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const fs = 44; ctx.font = `600 ${fs}px ${FONT}`;
  const lines = wrap(ctx, n.text, sz - 70);
  // checkbox
  ctx.strokeStyle = 'rgba(17,19,23,0.55)'; ctx.lineWidth = 4; roundRect(ctx, -sz / 2 + 34, -sz / 2 + 44, 34, 34, 6); ctx.stroke();
  lines.forEach((l, i) => ctx.fillText(l, -sz / 2 + 34, -sz / 2 + 140 + i * fs * 1.15));
  ctx.restore();
}

function drawHook(ctx, t) {
  if (t >= T.notesEnd) return; // buried under the notes by now; gone when they fall
  const a = eo(seg(t, 0.05, 0.55)), dy = lerp(40, 0, eo(seg(t, 0.05, 0.6)));
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `700 112px ${FONT}`;
  const ls = ['Is this your', 'follow-up', 'strategy?'];
  ls.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.5 - 120 + i * 122 + dy));
  ctx.restore();
}

function drawEndCard(ctx, te, logo) {
  ctx.fillStyle = C.canvas; ctx.fillRect(0, 0, W, H);
  const x0 = 90;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  // 1) Yoke keeps the list. And drafts the message.
  const l = [['Yoke keeps the list.', 0.0], ['And drafts the message.', 0.55]];
  ctx.font = `700 80px ${FONT}`;
  l.forEach(([s, at], i) => { const k = seg(te, at, at + 0.45); ctx.globalAlpha = eo(k); ctx.fillStyle = C.ink; ctx.fillText(s, x0 + lerp(30, 0, eo(k)), 680 + i * 94); });
  // 2) Logo + promise + CTA
  const lk = seg(te, 1.6, 2.2); ctx.globalAlpha = eo(lk);
  const lw = 460, lh = lw * (102 / 401.59), ls = lerp(0.9, 1, eob(lk, 1.6));
  ctx.save(); ctx.translate(x0, 1010 + lh / 2); ctx.scale(ls, ls); ctx.drawImage(logo, 0, -lh / 2, lw, lh); ctx.restore();
  ctx.font = `700 88px ${FONT}`;
  const p = [['Follow-ups that don’t', 2.0], ['depend on memory.', 2.15]];
  p.forEach(([s, at], i) => { const k = seg(te, at, at + 0.45); ctx.globalAlpha = eo(k); ctx.fillStyle = i ? C.coral : C.ink; ctx.fillText(s, x0 + lerp(30, 0, eo(k)), 1290 + i * 100); });
  const ck = seg(te, 2.9, 3.35); ctx.globalAlpha = eo(ck);
  const by = 1510 + lerp(30, 0, eo(ck)); ctx.font = `700 42px ${FONT}`;
  const label = 'See how Yoke works', bw = ctx.measureText(label).width + 100, bh = 96;
  ctx.fillStyle = C.ink; roundRect(ctx, x0, by, bw, bh, bh / 2); ctx.fill();
  ctx.fillStyle = C.canvas; ctx.textBaseline = 'middle'; ctx.fillText(label, x0 + 50, by + bh / 2 + 2);
  ctx.globalAlpha = 1;
}

function drawFrame(canvas, t, logo) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (t >= T.card) { drawEndCard(ctx, t - T.card, logo); return; }
  ctx.fillStyle = C.canvas; ctx.fillRect(0, 0, W, H);
  drawHook(ctx, t);
  NOTES.forEach(n => drawNote(ctx, n, t));
  drawYokeSmash(ctx, t, logo);
}

// v2 (job e750a027, review 0bac038e): Yoke drops in on top of the pile and smashes it; the notes pop off the screen.
function drawYokeSmash(ctx, t, logo) {
  const t0 = T.pop - 0.32, d = t - t0; if (d < 0 || t > T.fallEnd) return;
  const drop = eo(seg(t, t0, T.pop)), hit = t - T.pop;
  const out = seg(t, T.fallEnd - 0.5, T.fallEnd);
  const cx = W / 2, cy = lerp(-260, H / 2, drop * drop);
  // impact ring
  if (hit > 0 && hit < 0.6) { ctx.save(); ctx.strokeStyle = C.coral; ctx.globalAlpha = 1 - hit / 0.6; ctx.lineWidth = 26 * (1 - hit / 0.6) + 4;
    ctx.beginPath(); ctx.ellipse(cx, H / 2, 200 + hit * 1500, (200 + hit * 1500) * 0.9, 0, 0, 7); ctx.stroke(); ctx.restore(); }
  const sq = hit > 0 ? 1 + Math.exp(-hit * 9) * Math.sin(hit * 30) * 0.12 : 1;
  const bw = 700, bh = 250;
  ctx.save(); ctx.globalAlpha = 1 - out; ctx.translate(cx, cy); ctx.scale(sq * lerp(1, 0.8, out), (2 - sq) * lerp(1, 0.8, out));
  ctx.save(); ctx.filter = 'blur(24px)'; ctx.fillStyle = 'rgba(40,30,10,0.35)'; roundRect(ctx, -bw / 2 + 10, -bh / 2 + 30, bw, bh, bh / 2); ctx.fill(); ctx.restore();
  ctx.fillStyle = C.paper; roundRect(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fill(); ctx.lineWidth = 8; ctx.strokeStyle = C.ink; ctx.stroke();
  const lw = 470, lh = lw * (102 / 401.59); ctx.drawImage(logo, -lw / 2, -lh / 2, lw, lh);
  ctx.restore();
}
window.drawFrame = drawFrame; window.TOTAL = T.total;
