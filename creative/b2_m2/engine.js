// B2 M2 "We should do more on LinkedIn." ad engine (9:16). Draws one frame at time t (seconds) into a canvas.
// v1 was a Claude Design Motion film (artifact 2HEZMv52v9HWNvHhpNumJ8). v2 (review 1d99721f, Shane) rebuilds it here:
// the hook and end card are v1's, the middle is now a team chat where "we should do more on LinkedIn" gets thumbs-up
// after thumbs-up, "did we ever get to that?", question marks, then the same line again: it never gets done.
const C = { ink: '#111317', second: '#2A2D33', canvas: '#F7F4EC', paper: '#FFFFFF', coral: '#F04B37', stone: '#D8D5CD',
  muted: '#686A63', lime: '#CDF05B', hair: '#ECE9E1', soft: '#F1EEE6' };
const FONT = '"Instrument Sans", system-ui, sans-serif';
const W = 1080, H = 1920;

// Scene starts (s). hook 2.4 · chat 6.8 · Yoke 3.0 · end card 2.6
const T = { hook: 0, chat: 2.4, team: 9.2, card: 12.2, total: 14.8 };

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const eo = k => 1 - Math.pow(1 - clamp(k), 3);
const eob = (k, s = 1.7) => { k = clamp(k) - 1; return 1 + k * k * ((s + 1) * k + s); };
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function font(ctx, px, wt = 700, ls = 0) { ctx.font = `${wt} ${px}px ${FONT}`; ctx.letterSpacing = ls + 'px'; }
function wrap(ctx, text, maxW) {
  const words = text.split(' '), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
// v1's TextFx.fadeFromRight: each word fades in from 26px right, staggered.
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
  font(ctx, 104, 700, -4.2); const lines = wrap(ctx, '“We should do more on LinkedIn.”', 920);
  wordsIn(ctx, lines, 80, 620 + 92, 106, t, -0.3);
  const k = eo(seg(t, 0.9, 1.3)); font(ctx, 46, 500); ctx.globalAlpha = k; ctx.fillStyle = '#4A4D51';
  ctx.fillText('Your team channel, every few weeks', 80, 620 + 92 + lines.length * 106 + 40 + lerp(20, 0, k)); ctx.globalAlpha = 1;
}

// ---------- 2. Team chat (v2) ----------
// Names fictional. Each post: when it lands (s into the scene), a date divider, and reactions that pop in one by one.
const PEOPLE = { dana: ['Dana Reyes', '#F04B37'], sam: ['Sam Ortiz', '#2A2D33'], jordan: ['Jordan Lee', '#6B8F2A'], priya: ['Priya Shah', '#B7791F'] };
const POSTS = [
  { at: 0.25, day: 'Tuesday, March 3', who: 'dana', text: 'We should do more on LinkedIn.', react: [['up', [0.8, 1.0, 1.2, 1.4]]] },
  { at: 1.95, day: 'Monday, April 14', who: 'sam', text: 'Did we ever get to that LinkedIn thing?', react: [['q', [2.55, 2.75, 2.95]]] },
  { at: 3.45, day: 'Thursday, May 29', who: 'jordan', text: 'Hey, we should do more on LinkedIn', react: [['up', [3.95, 4.1, 4.25, 4.4, 4.55]]] },
  { at: 4.85, day: 'Wednesday, July 9', who: 'priya', text: 'Ok we REALLY need to do more on LinkedIn', react: [['up', [5.25, 5.35, 5.45, 5.55, 5.65, 5.75]], ['q', [5.5, 5.7]]] },
];
const CHAT = { x: 50, y: 250, w: 980, h: 1420, head: 150, foot: 140 };
function thumb(ctx, x, y, s, color) { // simple drawn thumbs-up, no emoji font needed
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = color;
  rr(ctx, -13, -2, 8, 16, 2.5); ctx.fill();                       // cuff
  rr(ctx, -3, -3, 17, 17, 4); ctx.fill();                         // fist
  ctx.beginPath(); ctx.moveTo(-1, -2); ctx.lineTo(3, -15); ctx.quadraticCurveTo(6, -19, 8, -15); ctx.lineTo(8, -3); ctx.closePath(); ctx.fill(); // thumb
  ctx.restore();
}
function postHeight(ctx, p) { font(ctx, 40, 500); return 64 + wrap(ctx, p.text, CHAT.w - 200).length * 52 + (p.react.length ? 84 : 10) + 60; }
function drawPost(ctx, p, y, te) {
  const k = eo(seg(te, p.at, p.at + 0.3)); if (k <= 0) return;
  ctx.save(); ctx.globalAlpha = k; ctx.translate(0, lerp(40, 0, k));
  // date divider
  ctx.strokeStyle = C.hair; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(CHAT.x + 40, y + 22); ctx.lineTo(CHAT.x + CHAT.w - 40, y + 22); ctx.stroke();
  font(ctx, 26, 700); const dw = ctx.measureText(p.day).width + 44; ctx.fillStyle = C.paper; rr(ctx, W / 2 - dw / 2, y + 2, dw, 42, 21); ctx.fill();
  ctx.strokeStyle = C.stone; ctx.stroke(); ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.day, W / 2, y + 24);
  y += 70;
  const [name, col] = PEOPLE[p.who], ax = CHAT.x + 40;
  ctx.fillStyle = col; rr(ctx, ax, y, 84, 84, 20); ctx.fill();
  font(ctx, 38, 700); ctx.fillStyle = C.paper; ctx.fillText(name.split(' ').map(s => s[0]).join(''), ax + 42, y + 44);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const tx = ax + 112; font(ctx, 36, 700); ctx.fillStyle = C.ink; ctx.fillText(name, tx, y + 30);
  const nw = ctx.measureText(name).width; font(ctx, 28, 500); ctx.fillStyle = C.muted; ctx.fillText('10:14 AM', tx + nw + 18, y + 30);
  font(ctx, 40, 500); ctx.fillStyle = C.second; const lines = wrap(ctx, p.text, CHAT.w - 200);
  lines.forEach((l, i) => ctx.fillText(l, tx, y + 84 + i * 52));
  let ry = y + 84 + (lines.length - 1) * 52 + 34, rx = tx;
  p.react.forEach(([kind, times]) => {
    const n = times.filter(a => te >= a).length; if (!n) return;
    const last = times[n - 1], pop = 1 + 0.25 * Math.sin(Math.PI * seg(te, last, last + 0.18));
    const w = 118, h = 60, hot = kind === 'q';
    ctx.save(); ctx.translate(rx + w / 2, ry + h / 2); ctx.scale(pop, pop);
    ctx.fillStyle = hot ? '#FDE8E5' : '#EEF6D6'; rr(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = hot ? '#F5B4AA' : '#B9D66A'; ctx.stroke();
    if (hot) { font(ctx, 40, 700); ctx.fillStyle = C.coral; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', -24, 2); }
    else thumb(ctx, -24, 4, 1.35, '#4E6B12');
    font(ctx, 32, 700); ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(String(n), 6, 2);
    ctx.restore(); rx += w + 16;
  });
  ctx.restore();
}
function drawChat(ctx, t) {
  const te = t - T.chat;
  ctx.fillStyle = C.canvas; ctx.fillRect(0, 0, W, H);
  const enter = eob(seg(te, 0, 0.45), 1.2);
  ctx.save(); ctx.translate(0, lerp(140, 0, enter)); ctx.globalAlpha = eo(seg(te, 0, 0.3));
  ctx.save(); ctx.filter = 'blur(20px)'; ctx.fillStyle = 'rgba(0,0,0,0.07)'; rr(ctx, CHAT.x, CHAT.y + 20, CHAT.w, CHAT.h, 40); ctx.fill(); ctx.restore();
  ctx.fillStyle = C.paper; rr(ctx, CHAT.x, CHAT.y, CHAT.w, CHAT.h, 40); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.stone; ctx.stroke();
  // header: channel, and the result that never changes
  font(ctx, 46, 700); ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('# sales-team', CHAT.x + 44, CHAT.y + 72); font(ctx, 28, 500); ctx.fillStyle = C.muted; ctx.fillText('6 members', CHAT.x + 44, CHAT.y + 114);
  const chip = 'LinkedIn messages sent: 0'; font(ctx, 28, 700); const cw = ctx.measureText(chip).width + 44;
  const cx = CHAT.x + CHAT.w - 40 - cw, flash = te > 5.9 ? eo(seg(te, 5.9, 6.2)) : 0;
  ctx.fillStyle = flash ? '#FDE8E5' : C.soft; rr(ctx, cx, CHAT.y + 50, cw, 54, 27); ctx.fill();
  ctx.fillStyle = flash ? C.coral : C.second; ctx.textBaseline = 'middle'; ctx.fillText(chip, cx + 22, CHAT.y + 78);
  ctx.strokeStyle = C.hair; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(CHAT.x, CHAT.y + CHAT.head); ctx.lineTo(CHAT.x + CHAT.w, CHAT.y + CHAT.head); ctx.stroke();
  // messages, newest at the bottom; the list scrolls up as posts arrive
  const top = CHAT.y + CHAT.head, bottom = CHAT.y + CHAT.h - CHAT.foot;
  ctx.save(); ctx.beginPath(); ctx.rect(CHAT.x, top, CHAT.w, bottom - top); ctx.clip();
  const hs = POSTS.map(p => postHeight(ctx, p));
  let shown = 0; POSTS.forEach((p, i) => { shown += hs[i] * eo(seg(te, p.at - 0.05, p.at + 0.3)); });
  const scroll = Math.max(0, shown - (bottom - top - 30));
  let y = top + 30 - scroll; POSTS.forEach((p, i) => { drawPost(ctx, p, y, te); y += hs[i]; });
  ctx.restore();
  // composer
  const fy = CHAT.y + CHAT.h - CHAT.foot + 30; ctx.fillStyle = C.paper; ctx.strokeStyle = C.stone; ctx.lineWidth = 3;
  rr(ctx, CHAT.x + 36, fy, CHAT.w - 72, 84, 22); ctx.fill(); ctx.stroke();
  font(ctx, 34, 500); ctx.fillStyle = '#9A9C95'; ctx.textBaseline = 'middle'; ctx.fillText('Message #sales-team', CHAT.x + 70, fy + 43);
  ctx.restore();
}

// ---------- 3. With Yoke (v1's sending-profiles beat) ----------
const REPS = ['Alex', 'Sam', 'Jordan'];
function drawTeam(ctx, t) {
  const te = t - T.team; ctx.fillStyle = C.canvas; ctx.fillRect(0, 0, W, H);
  font(ctx, 44, 700, -0.4); ctx.fillStyle = C.muted; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillText('With Yoke', 80, 375);
  const c = seg(te, 0, 0.5), y0 = 430 + lerp(120, 0, eob(c, 1.4));
  ctx.save(); ctx.globalAlpha = eo(c);
  const cardH = 38 + 34 + 22 + 56 + 22 + REPS.length * 80 + 22 + 40 + 38;
  ctx.fillStyle = C.paper; rr(ctx, 80, y0, 920, cardH, 32); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.stone; ctx.stroke();
  let y = y0 + 38 + 28; font(ctx, 28, 700, 1.7); ctx.fillStyle = C.muted; ctx.fillText('SENDING PROFILES', 124, y);
  y += 22 + 50; font(ctx, 46, 700, -0.5); ctx.fillStyle = C.ink; ctx.fillText('LinkedIn outreach', 124, y); y += 22;
  REPS.forEach((r, i) => {
    ctx.strokeStyle = C.hair; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(124, y); ctx.lineTo(956, y); ctx.stroke();
    font(ctx, 38, 500); ctx.fillStyle = C.ink; ctx.textBaseline = 'middle'; ctx.fillText(r + ' · LinkedIn', 124, y + 40);
    const on = te >= 0.7 + 0.35 * i, label = on ? 'Running' : 'Paused'; font(ctx, 28, 700); const w = ctx.measureText(label).width + 44;
    const s = on ? lerp(0.7, 1, eob(seg(te, 0.7 + 0.35 * i, 1.0 + 0.35 * i), 1.8)) : 1;
    ctx.save(); ctx.translate(956 - w / 2, y + 40); ctx.scale(s, s); ctx.fillStyle = on ? C.lime : '#E9E6DE'; rr(ctx, -w / 2, -24, w, 48, 24); ctx.fill();
    ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.fillText(label, 0, 1); ctx.restore(); ctx.textAlign = 'left';
    y += 80;
  });
  ctx.textBaseline = 'alphabetic'; font(ctx, 32, 500); ctx.fillStyle = '#4A4D51'; ctx.fillText('Inside each account’s daily limit', 124, y + 46);
  ctx.restore();
  font(ctx, 84, 700, -3.4); const lines = wrap(ctx, 'Each rep’s profile, inside the limits you set.', 920);
  wordsIn(ctx, lines, 80, 1130 + 74, 86, te, 1.5, 0.07, 0.4);
}

// ---------- 4. End card (v1) ----------
function drawEndCard(ctx, t, logo) {
  const te = t - T.card; ctx.fillStyle = C.canvas; ctx.fillRect(0, 0, W, H);
  const lw = 520, lh = lw * 102 / 401.59, s = lerp(0.86, 1, eob(seg(te, 0, 0.6), 1.6));
  ctx.save(); ctx.globalAlpha = eo(seg(te, 0, 0.3)); ctx.translate(80, 560 + lh / 2); ctx.scale(s, s); ctx.drawImage(logo, 0, -lh / 2, lw, lh); ctx.restore();
  font(ctx, 104, 700, -4.2); const lines = wrap(ctx, 'Do more on LinkedIn. Actually.', 900);
  wordsIn(ctx, lines, 80, 780 + 92, 106, te, 0.3);
  const k = eo(seg(te, 0.95, 1.35)), by = 780 + lines.length * 106 + 26 + 10 + lerp(30, 0, eo(seg(te, 0.95, 1.4)));
  font(ctx, 40, 700); const label = 'See how Yoke works', bw = ctx.measureText(label).width + 96, bh = 98;
  ctx.globalAlpha = k; ctx.fillStyle = C.ink; rr(ctx, 80, by, bw, bh, bh / 2); ctx.fill();
  ctx.fillStyle = C.canvas; ctx.textBaseline = 'middle'; ctx.fillText(label, 128, by + bh / 2 + 1); ctx.globalAlpha = 1;
}

function drawFrame(canvas, t, logo) {
  canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d');
  if (t < T.chat) drawHook(ctx, t); else if (t < T.team) drawChat(ctx, t); else if (t < T.card) drawTeam(ctx, t); else drawEndCard(ctx, t, logo);
}
window.drawFrame = drawFrame; window.TOTAL = T.total; window.POSTER = 8.0;
