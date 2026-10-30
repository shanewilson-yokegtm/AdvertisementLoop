// B2 M3 "You'll follow up when things calm down. So, never." ad engine (9:16). Draws one frame at time t into a canvas.
// v1 was a Claude Design Motion film (artifact FMJbmrDN1SgtwCbnukmMJR). v2 (review f21c3e44, Shane) rebuilds it here:
// the hook, "So, never." and the end card are v1's; the middle is now a week calendar filling up with meetings while
// "Follow up with warm leads" keeps getting pushed later and later, then off the week. The calendar is a generic week
// view (no product branding).
const C = { ink: '#111317', second: '#2A2D33', canvas: '#F7F4EC', paper: '#FFFFFF', coral: '#F04B37', stone: '#D8D5CD',
  muted: '#686A63', lime: '#CDF05B', hair: '#ECE9E1' };
const FONT = '"Instrument Sans", system-ui, sans-serif';
const W = 1080, H = 1920;

// Scene starts (s). hook 2.2 · calendar 6.0 · never 1.4 · sent 2.8 · end card 2.4
const T = { hook: 0, cal: 2.2, never: 8.2, sent: 9.6, card: 12.4, total: 14.8 };

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const eo = k => 1 - Math.pow(1 - clamp(k), 3);
const eio = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
const eob = (k, s = 1.7) => { k = clamp(k) - 1; return 1 + k * k * ((s + 1) * k + s); };
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function font(ctx, px, wt = 700, ls = 0) { ctx.font = `${wt} ${px}px ${FONT}`; ctx.letterSpacing = ls + 'px'; }
function wrap(ctx, text, maxW) {
  const words = text.split(' '), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
function wordsIn(ctx, lines, x, y, lh, t, t0, stagger = 0.08, dur = 0.45, color = C.ink) {
  let i = 0; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  lines.forEach((l, li) => { let cx = x; l.split(' ').forEach(w => {
    const k = eo(seg(t, t0 + i * stagger, t0 + i * stagger + dur)); ctx.globalAlpha = k;
    ctx.fillText(w, cx + lerp(26, 0, k), y + li * lh); cx += ctx.measureText(w + ' ').width; i++; }); });
  ctx.globalAlpha = 1;
}

// ---------- 1. Hook (v1) ----------
function drawHook(ctx, t) {
  ctx.fillStyle = C.canvas; ctx.fillRect(0, 0, W, H);
  font(ctx, 104, 700, -4.2); wordsIn(ctx, wrap(ctx, 'You’ll follow up when things calm down.', 920), 80, 680 + 92, 106, t, -0.3, 0.09);
}

// ---------- 2. The week fills up (v2) ----------
const CAL = { x: 40, y: 250, w: 1000, head: 130, days: 84, gut: 96, hour: 140, from: 9, hours: 8 };
CAL.h = CAL.head + CAL.days + CAL.hour * CAL.hours; CAL.col = (CAL.w - CAL.gut - 16) / 5;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const TONES = [['#DCEBFB', '#3D6FB6'], ['#E7F3D4', '#5C8A1F'], ['#FBE7C7', '#B7791F'], ['#ECE3FA', '#7553C2'], ['#D8F1EE', '#23867B'], ['#F3E3D8', '#9A5B32']];
// The follow-up's slots, in order: each time a meeting lands on it, it slides to the next one (later, then later days).
const FU = [[0, 9], [0, 11], [0, 14], [1, 10], [1, 15], [2, 13], [3, 11], [3, 15], [4, 13], [4, 16]];
const PUSH = [0.9, 1.45, 1.95, 2.4, 2.8, 3.15, 3.45, 3.72, 3.98, 4.22, 4.45]; // last one pushes it off the week
const OFF = 4.45;
const TITLES = ['Payroll', 'Client call', 'Hiring panel', 'Quote for Ruiz', 'Van repair', 'Board prep', 'Inventory', 'Client fire drill',
  'Vendor sync', 'Team standup', 'Pipeline review', 'Budget check', 'Site visit', 'Interview', 'Customer QBR', '1:1 with Maya', 'Supplier call',
  'Ops review', 'Lunch w/ partner', 'Invoice run', 'Training', 'Insurance call', 'Planning', 'Demo for Hale Co', 'Tax prep', 'Recruiter call',
  'Contract review', 'All-hands', 'Bank meeting', 'Office move', 'Onboarding', 'Pricing review', 'Board call', 'Weekly report', 'Fix the CRM', 'Hiring sync',
  'Ad review', 'Support escalation', 'Quarterly plan', 'Expense report'];
const EVENTS = (() => {
  const R = rng(11), fuKey = new Set(FU.map(([d, h]) => d + ':' + h)), out = []; let n = 0;
  // pushers: land exactly on the follow-up's current slot
  FU.forEach(([d, h], i) => out.push({ d, h, at: PUSH[i], title: TITLES[n++ % TITLES.length], tone: TONES[i % TONES.length] }));
  const free = [];
  for (let d = 0; d < 5; d++) for (let h = CAL.from; h < CAL.from + CAL.hours; h++) if (!fuKey.has(d + ':' + h)) free.push([d, h]);
  for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
  free.forEach(([d, h], i) => { const k = i / (free.length - 1); // faster and faster
    out.push({ d, h, at: 0.45 + Math.pow(k, 0.7) * 3.9, title: TITLES[n++ % TITLES.length], tone: TONES[Math.floor(R() * TONES.length)] }); });
  return out;
})();
const slotX = d => CAL.x + CAL.gut + d * CAL.col + 6;
const slotY = h => CAL.y + CAL.head + CAL.days + (h - CAL.from) * CAL.hour;
function fuPose(te) {
  let i = 0; while (i < PUSH.length && te >= PUSH[i]) i++;
  const prev = FU[Math.max(0, i - 1)], cur = FU[Math.min(i, FU.length - 1)], k = eio(seg(te, PUSH[i - 1] ?? -1, (PUSH[i - 1] ?? -1) + 0.32));
  if (i === 0) return { x: slotX(FU[0][0]), y: slotY(FU[0][1]), moves: 0 };
  if (i > FU.length - 1) { const f = seg(te, OFF, OFF + 0.6); // off the bottom of Friday
    return { x: slotX(4), y: lerp(slotY(16), CAL.y + CAL.h + 160, eio(f)), moves: i, off: f }; }
  return { x: lerp(slotX(prev[0]), slotX(cur[0]), k), y: lerp(slotY(prev[1]), slotY(cur[1]), k), moves: i };
}
function drawEvent(ctx, x, y, w, h, title, tone, sub) {
  ctx.fillStyle = tone[0]; rr(ctx, x, y, w, h, 14); ctx.fill();
  ctx.fillStyle = tone[1]; rr(ctx, x, y, 9, h, 4); ctx.fill();
  let px = 27; font(ctx, px, 700); // shrink a long single word so it stays inside its day column
  while (px > 20 && Math.max(...title.split(' ').map(x => ctx.measureText(x).width)) > w - 34) font(ctx, --px, 700);
  ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  wrap(ctx, title, w - 34).slice(0, 2).forEach((l, i) => ctx.fillText(l, x + 22, y + 40 + i * 32));
  if (sub) { font(ctx, 22, 500); ctx.fillStyle = '#4A4D51'; ctx.fillText(sub, x + 22, y + h - 18); }
}
function drawCalendar(ctx, te, opts = {}) {
  // card + header
  ctx.save(); ctx.filter = 'blur(20px)'; ctx.fillStyle = 'rgba(0,0,0,0.07)'; rr(ctx, CAL.x, CAL.y + 20, CAL.w, CAL.h, 36); ctx.fill(); ctx.restore();
  ctx.fillStyle = C.paper; rr(ctx, CAL.x, CAL.y, CAL.w, CAL.h, 36); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.stone; ctx.stroke();
  font(ctx, 50, 700, -1); ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText('This week', CAL.x + 40, CAL.y + 82);
  font(ctx, 30, 600); ctx.fillStyle = C.muted; ctx.fillText('Week view', CAL.x + 300, CAL.y + 80);
  if (opts.moves) { const s = `Follow-up moved ${opts.moves}×`; font(ctx, 30, 700); const w = ctx.measureText(s).width + 48, x = CAL.x + CAL.w - 36 - w;
    const p = 1 + 0.12 * Math.sin(Math.PI * seg(te, opts.lastPush, opts.lastPush + 0.2));
    ctx.save(); ctx.translate(x + w / 2, CAL.y + 70); ctx.scale(p, p); ctx.fillStyle = '#FDE8E5'; rr(ctx, -w / 2, -29, w, 58, 29); ctx.fill();
    ctx.fillStyle = C.coral; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s, 0, 2); ctx.restore(); }
  // day headers
  const gy = CAL.y + CAL.head; ctx.strokeStyle = C.hair; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(CAL.x, gy); ctx.lineTo(CAL.x + CAL.w, gy); ctx.stroke();
  DAYS.forEach((d, i) => { const x = slotX(i) - 6 + CAL.col / 2; font(ctx, 30, 700); ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(d.toUpperCase(), x, gy + CAL.days / 2); });
  // hour lines + labels
  for (let i = 0; i <= CAL.hours; i++) { const y = gy + CAL.days + i * CAL.hour;
    ctx.strokeStyle = C.hair; ctx.beginPath(); ctx.moveTo(CAL.x + CAL.gut, y); ctx.lineTo(CAL.x + CAL.w - 16, y); ctx.stroke();
    if (i < CAL.hours) { const h = CAL.from + i, lab = (h > 12 ? h - 12 : h) + (h >= 12 ? ' PM' : ' AM'); font(ctx, 24, 600); ctx.fillStyle = '#9A9C95'; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(lab, CAL.x + CAL.gut - 14, y + 8); } }
  for (let d = 1; d < 5; d++) { const x = slotX(d) - 6; ctx.beginPath(); ctx.moveTo(x, gy + CAL.days); ctx.lineTo(x, CAL.y + CAL.h - 8); ctx.stroke(); }
  // meetings
  EVENTS.forEach(e => { const k = seg(te, e.at, e.at + 0.22); if (k <= 0) return;
    const s = lerp(0.6, 1, eob(k, 1.9)), x = slotX(e.d), y = slotY(e.h) + 5, w = CAL.col - 12, h = CAL.hour - 10;
    ctx.save(); ctx.globalAlpha = clamp(k * 2.5); ctx.translate(x + w / 2, y + h / 2); ctx.scale(s, s);
    drawEvent(ctx, -w / 2, -h / 2, w, h, e.title, e.tone); ctx.restore(); });
}
function drawFollowUp(ctx, p) {
  const w = CAL.col - 12, h = CAL.hour - 10;
  ctx.save(); ctx.beginPath(); ctx.rect(0, CAL.y + CAL.head + CAL.days, W, CAL.h - CAL.head - CAL.days + (p.off ? 0 : 0)); ctx.clip();
  ctx.save(); ctx.filter = 'blur(10px)'; ctx.fillStyle = 'rgba(240,75,55,0.35)'; rr(ctx, p.x + 4, p.y + 14, w, h, 14); ctx.fill(); ctx.restore();
  ctx.fillStyle = C.coral; rr(ctx, p.x, p.y + 5, w, h, 14); ctx.fill();
  font(ctx, 27, 700); ctx.fillStyle = C.paper; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ['Follow up', 'with warm', 'leads'].forEach((l, i) => ctx.fillText(l, p.x + 18, p.y + 44 + i * 31));
  ctx.restore();
}
function drawCalScene(ctx, t) {
  const te = t - T.cal; ctx.fillStyle = C.canvas; ctx.fillRect(0, 0, W, H);
  const enter = eob(seg(te, 0, 0.45), 1.2), p = fuPose(te);
  ctx.save(); ctx.translate(0, lerp(140, 0, enter)); ctx.globalAlpha = eo(seg(te, 0, 0.3));
  drawCalendar(ctx, te, { moves: p.moves, lastPush: PUSH[Math.max(0, p.moves - 1)] });
  drawFollowUp(ctx, p);
  ctx.restore();
  // what happens to it
  if (te > OFF + 0.3) { const k = eo(seg(te, OFF + 0.3, OFF + 0.6)); font(ctx, 46, 700, -1); const s = 'Moved to next week';
    const w = ctx.measureText(s).width + 70, x = W / 2 - w / 2, y = CAL.y + CAL.h + 40 + lerp(30, 0, k);
    ctx.globalAlpha = k; ctx.fillStyle = C.coral; rr(ctx, x, y, w, 90, 45); ctx.fill(); ctx.fillStyle = C.paper; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s, W / 2, y + 47); ctx.globalAlpha = 1; }
  else { font(ctx, 40, 600); ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = eo(seg(te, 0.5, 0.9));
    ctx.fillText('Every meeting pushes it later.', W / 2, CAL.y + CAL.h + 100); ctx.globalAlpha = 1; }
}

// ---------- 3. So, never. (v1) ----------
function drawNever(ctx, t) {
  const te = t - T.never; ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
  const p = seg(te, 0.05, 0.35), s = lerp(1.12, 1, eob(p, 1.5)); font(ctx, 150, 700, -6);
  ctx.save(); ctx.globalAlpha = eo(p); ctx.translate(80, 780 + 132); ctx.scale(s, s); ctx.fillStyle = C.coral; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText('So, never.', 0, 0); ctx.restore();
}

// ---------- 4. Same week, sent on schedule (v1's beat, on the calendar) ----------
function drawSent(ctx, t) {
  const te = t - T.sent; ctx.fillStyle = C.canvas; ctx.fillRect(0, 0, W, H);
  const sc = 0.78; ctx.save(); ctx.translate(W / 2, 170); ctx.scale(sc, sc); ctx.translate(-W / 2, -CAL.y);
  drawCalendar(ctx, 99, {});
  [[1, 11, 0.3], [3, 14, 0.8]].forEach(([d, h, at]) => { const k = seg(te, at, at + 0.35); if (k <= 0) return;
    const s = lerp(0.6, 1, eob(k, 1.8)) * 1.06, w = CAL.col - 12, hh = CAL.hour - 10, x = slotX(d), y = slotY(h) + 5;
    ctx.save(); ctx.globalAlpha = eo(k); ctx.translate(x + w / 2, y + hh / 2); ctx.scale(s, s);
    ctx.save(); ctx.filter = 'blur(10px)'; ctx.fillStyle = 'rgba(0,0,0,0.18)'; rr(ctx, -w / 2 + 4, -hh / 2 + 10, w, hh, 14); ctx.fill(); ctx.restore();
    ctx.fillStyle = C.lime; rr(ctx, -w / 2, -hh / 2, w, hh, 14); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.stroke();
    font(ctx, 25, 700); ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('Follow-ups', -w / 2 + 18, -hh / 2 + 42); ctx.fillText('sent ✓', -w / 2 + 18, -hh / 2 + 74); ctx.restore(); });
  ctx.restore();
  font(ctx, 84, 700, -3.4); wordsIn(ctx, wrap(ctx, 'Yoke sends them on the schedule you set.', 920), 80, 1330 + 74, 86, te, 1.0, 0.07, 0.4);
}

// ---------- 5. End card (v1) ----------
function drawEndCard(ctx, t, logo) {
  const te = t - T.card; ctx.fillStyle = C.canvas; ctx.fillRect(0, 0, W, H);
  const lw = 520, lh = lw * 102 / 401.59, s = lerp(0.86, 1, eob(seg(te, 0, 0.6), 1.6));
  ctx.save(); ctx.globalAlpha = eo(seg(te, 0, 0.3)); ctx.translate(80, 560 + lh / 2); ctx.scale(s, s); ctx.drawImage(logo, 0, -lh / 2, lw, lh); ctx.restore();
  font(ctx, 104, 700, -4.2); const lines = wrap(ctx, 'Busy weeks still get follow-ups.', 900);
  wordsIn(ctx, lines, 80, 780 + 92, 106, te, 0.3);
  const k = eo(seg(te, 0.95, 1.35)), by = 780 + lines.length * 106 + 36 + lerp(30, 0, eo(seg(te, 0.95, 1.4)));
  font(ctx, 40, 700); const label = 'See how Yoke works', bw = ctx.measureText(label).width + 96, bh = 98;
  ctx.globalAlpha = k; ctx.fillStyle = C.ink; rr(ctx, 80, by, bw, bh, bh / 2); ctx.fill();
  ctx.fillStyle = C.canvas; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, 128, by + bh / 2 + 1); ctx.globalAlpha = 1;
}

function drawFrame(canvas, t, logo) {
  canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d');
  if (t < T.cal) drawHook(ctx, t); else if (t < T.never) drawCalScene(ctx, t); else if (t < T.sent) drawNever(ctx, t);
  else if (t < T.card) drawSent(ctx, t); else drawEndCard(ctx, t, logo);
}
window.drawFrame = drawFrame; window.TOTAL = T.total; window.POSTER = 6.2;
