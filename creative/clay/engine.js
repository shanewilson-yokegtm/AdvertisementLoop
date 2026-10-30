// Clay rainbow ad engine. Draws one frame of a spot at time t (seconds) into a canvas.
// Shared across all five spots: same rainbow, camera, lighting, headline band and end card.
const C = { ink: '#111317', canvas: '#F7F4EC', paper: '#FFFFFF', coral: '#F04B37', stone: '#D8D5CD', muted: '#686A63', panel: '#EFEEE8' };
// Original clay palette (outer -> inner). Soft, earthy, not a spectrum logo.
const BANDS = ['#E2674F', '#EFA44A', '#E9CF6A', '#8DB98A', '#6FA3C9'];
const FONT = '"Instrument Sans", system-ui, sans-serif';

const LAYOUT = {
  '9x16': { W: 1080, H: 1920, headY: 430, ground: 1340, scale: 1.16 },
  '4x5': { W: 1080, H: 1350, headY: 250, ground: 1080, scale: 0.98 },
};

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => k < 0 ? 0 : k > 1 ? 1 : 1 - Math.pow(1 - k, 3);
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Rest geometry: band i is a half-circle tube, centerline radius r, thickness w.
function rainbowRest(L) {
  const k = L.scale, r0 = 120 * k, w = 58 * k, bands = [];
  for (let i = 0; i < BANDS.length; i++) {
    const r = r0 + (BANDS.length - 1 - i) * w + w / 2;
    const pts = [];
    const N = 64;
    for (let j = 0; j <= N; j++) {
      const a = Math.PI - (j / N) * Math.PI;
      // hand-made wobble in radius
      const wob = Math.sin(a * 5 + i * 1.7) * 2.2 * k + Math.sin(a * 11 + i) * 1.1 * k;
      pts.push({ x: Math.cos(a) * (r + wob), y: -Math.sin(a) * (r + wob), s: j / N });
    }
    // feet: extend each leg down into the surface so it reads as pressed onto it
    pts.unshift({ x: pts[0].x, y: w * 0.6, s: 0 }); pts.push({ x: pts[pts.length - 1].x, y: w * 0.6, s: 1 });
    bands.push({ color: BANDS[i], w: w + 2, r, pts, i });
  }
  return { bands, top: r0 + BANDS.length * w, w, k };
}

function shade(hex, amt) { // amt -1..1
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round(lerp(r, f, p)); g = Math.round(lerp(g, f, p)); b = Math.round(lerp(b, f, p));
  return `rgb(${r},${g},${b})`;
}

let off = null;
function offscreen(W, H) { if (!off || off.width !== W || off.height !== H) { off = document.createElement('canvas'); off.width = W; off.height = H; } return off; }

// Draw one clay tube along a polyline of screen points with per-point thickness.
function drawTube(ctx, W, H, pts, color, seed) {
  const o = offscreen(W, H), c = o.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
  c.lineCap = 'round'; c.lineJoin = 'round';
  const path = () => { c.beginPath(); pts.forEach((p, j) => j ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); };
  const avgW = pts.reduce((a, p) => a + p.w, 0) / pts.length;
  // base body (variable width: draw segments)
  c.strokeStyle = color;
  for (let j = 1; j < pts.length; j++) { c.lineWidth = (pts[j].w + pts[j - 1].w) / 2; c.beginPath(); c.moveTo(pts[j - 1].x, pts[j - 1].y); c.lineTo(pts[j].x, pts[j].y); c.stroke(); }
  c.globalCompositeOperation = 'source-atop';
  // core shadow (light from upper left -> shadow lower right)
  c.filter = `blur(${avgW * 0.22}px)`;
  c.save(); c.translate(avgW * 0.26, avgW * 0.30); c.strokeStyle = shade(color, -0.32); c.lineWidth = avgW * 0.55; path(); c.stroke(); c.restore();
  // highlight
  c.filter = `blur(${avgW * 0.16}px)`;
  c.save(); c.translate(-avgW * 0.2, -avgW * 0.24); c.strokeStyle = shade(color, 0.38); c.globalAlpha = 0.85; c.lineWidth = avgW * 0.26; path(); c.stroke(); c.restore();
  c.filter = `blur(${avgW * 0.05}px)`;
  c.save(); c.translate(-avgW * 0.22, -avgW * 0.27); c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = avgW * 0.07; path(); c.stroke(); c.restore();
  c.filter = 'none';
  // fingerprints + tool marks, attached to the clay
  const R = rng(seed);
  c.lineWidth = 1.6; c.lineCap = 'round';
  for (let f = 0; f < 3; f++) {
    const p = pts[Math.floor(lerp(0.12, 0.88, R()) * (pts.length - 1))];
    const rot = R() * Math.PI;
    for (let q = 1; q <= 6; q++) {
      c.strokeStyle = `rgba(40,20,10,${0.07 - q * 0.006})`;
      c.beginPath(); c.ellipse(p.x + (R() - 0.5) * 6, p.y + (R() - 0.5) * 6, q * p.w * 0.05, q * p.w * 0.035, rot, 0.2, Math.PI * 1.6); c.stroke();
    }
  }
  for (let f = 0; f < 18; f++) { // pits
    const p = pts[Math.floor(R() * (pts.length - 1))];
    c.fillStyle = `rgba(30,15,5,${0.05 + R() * 0.05})`;
    c.beginPath(); c.arc(p.x + (R() - 0.5) * p.w * 0.7, p.y + (R() - 0.5) * p.w * 0.7, 1 + R() * 2, 0, 7); c.fill();
  }
  c.globalCompositeOperation = 'source-over';
  ctx.drawImage(o, 0, 0);
}

function drawStage(ctx, L) {
  const { W, H, ground } = L;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#FBF8F1'); g.addColorStop(ground / H - 0.02, '#F3EEE3'); g.addColorStop(ground / H + 0.005, '#E9E2D3'); g.addColorStop(1, '#DCD3C1');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // soft key light pool
  const rg = ctx.createRadialGradient(W * 0.35, ground - 300, 50, W * 0.45, ground - 200, W * 0.9);
  rg.addColorStop(0, 'rgba(255,255,255,0.35)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  // vignette
  const vg = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, H * 0.85);
  vg.addColorStop(0, 'rgba(60,40,20,0)'); vg.addColorStop(1, 'rgba(60,40,20,0.14)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
}

// kickerScale: kicker size relative to the headline (0.62 default). Per-spot option, see SPOTS.<key>.kickerScale.
function drawHeadline(ctx, L, text, alpha = 1, kicker = null, kickerScale = 0.62, headScale = 1) {
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const size = L.W * 0.078;
  if (kicker) {
    let ks = size * kickerScale; ctx.font = `600 ${ks}px ${FONT}`;
    const kw = ctx.measureText(kicker).width, kMax = L.W - 110;
    if (kw > kMax) { ks = ks * kMax / kw; ctx.font = `600 ${ks}px ${FONT}`; }
    ctx.fillStyle = kickerScale > 0.62 ? C.ink : C.muted;
    const gap = headScale === 1 ? Math.max(size * 1.15, ks * 1.25) : size * headScale * 1.1 + ks * 0.2;
    ctx.fillText(kicker, L.W / 2, L.headY - gap); ctx.fillStyle = C.ink;
  }
  const hs = size * headScale; ctx.font = `600 ${hs}px ${FONT}`;
  const tw = ctx.measureText(text).width, maxW = L.W - 110;
  if (tw > maxW) ctx.font = `600 ${hs * maxW / tw}px ${FONT}`;
  ctx.fillText(text, L.W / 2, L.headY);
  ctx.restore();
}

function contactShadow(ctx, cx, ground, halfW, strength = 1) {
  ctx.save(); ctx.filter = 'blur(18px)';
  ctx.fillStyle = `rgba(70,45,20,${0.28 * strength})`;
  ctx.beginPath(); ctx.ellipse(cx + 18, ground + 6, halfW * 1.04, 22, 0, 0, 7); ctx.fill();
  ctx.filter = 'blur(5px)'; ctx.fillStyle = `rgba(50,30,10,${0.35 * strength})`;
  ctx.beginPath(); ctx.ellipse(cx + 6, ground + 2, halfW * 0.98, 7, 0, 0, 7); ctx.fill();
  ctx.restore();
}

// Draw the rainbow with a deformation function def(p, band) -> {x,y,w}
function drawRainbow(ctx, L, R, cx, def) {
  const bands = R.bands.map(b => b.pts.map(p => { const d = def(p, b); return { x: cx + d.x, y: L.ground + d.y, w: d.w ?? b.w }; }));
  let minX = 1e9, maxX = -1e9; bands.forEach(ps => ps.forEach(p => { minX = Math.min(minX, p.x - p.w / 2); maxX = Math.max(maxX, p.x + p.w / 2); }));
  contactShadow(ctx, (minX + maxX) / 2, L.ground, (maxX - minX) / 2);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, L.W, L.ground + 3); ctx.clip();
  bands.forEach((ps, i) => drawTube(ctx, L.W, L.H, ps, R.bands[i].color, 11 + i * 7));
  ctx.restore();
  return { minX, maxX };
}

function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// Simple configuration panel: label + a few abstract setting rows.
function drawPanel(ctx, x, y, w, h, label, rot = 0, k = 1) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.save(); ctx.filter = 'blur(14px)'; ctx.fillStyle = 'rgba(50,30,10,0.22)'; roundRect(ctx, -w / 2 + 10, -h / 2 + 16, w, h, 22 * k); ctx.fill(); ctx.restore();
  ctx.fillStyle = C.paper; roundRect(ctx, -w / 2, -h / 2, w, h, 22 * k); ctx.fill();
  ctx.lineWidth = 4 * k; ctx.strokeStyle = C.ink; ctx.stroke();
  ctx.fillStyle = C.ink; ctx.font = `600 ${50 * k}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(label, -w / 2 + 40 * k, -h / 2 + 52 * k);
  // abstract rows: toggles + bars
  for (let r = 0; r < 2; r++) {
    const ry = -h / 2 + (108 + r * 40) * k;
    ctx.fillStyle = C.stone; roundRect(ctx, -w / 2 + 40 * k, ry - 8 * k, w * (r ? 0.42 : 0.55), 16 * k, 8 * k); ctx.fill();
    ctx.fillStyle = r ? C.stone : C.ink; roundRect(ctx, w / 2 - 110 * k, ry - 14 * k, 64 * k, 28 * k, 14 * k); ctx.fill();
    ctx.fillStyle = C.paper; ctx.beginPath(); ctx.arc(w / 2 - (r ? 96 : 60) * k, ry, 10 * k, 0, 7); ctx.fill();
  }
  ctx.restore();
}

// opts (per-spot, SPOTS.<key>.endCard): { logoScale, type: { start, dur }, buttonAt }. te = seconds since the cut.
// With no opts this draws the original static card.
function drawEndCard(ctx, L, logoImg, opts = null, te = 99) {
  const { W, H } = L;
  ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
  const tall = H > 1500;
  const cy = tall ? H * 0.47 : H * 0.5;
  // lockup
  const ls = opts?.logoScale ?? 0.5;
  const lw = W * ls, lh = lw * (102 / 401.59);
  const logoBottom = cy - (tall ? 330 : 290) + W * 0.5 * (102 / 401.59);
  ctx.drawImage(logoImg, (W - lw) / 2, ls === 0.5 ? cy - (tall ? 330 : 290) : logoBottom - lh, lw, lh);
  // promise
  ctx.fillStyle = C.canvas; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const size = W * 0.074; ctx.font = `600 ${size}px ${FONT}`;
  const l1 = 'Go-to-market engineering', l2 = 'should be easy.';
  const y1 = cy + (tall ? 30 : 20), y2 = y1 + size * 1.18;
  if (!opts?.type) { ctx.fillText(l1, W / 2, y1); ctx.fillText(l2, W / 2, y2); }
  else {
    // typed out, one character at a time; lines stay centred on their final width so nothing shifts
    const n = Math.floor(clamp((te - opts.type.start) / opts.type.dur) * (l1.length + l2.length));
    const s1 = l1.slice(0, n), s2 = l2.slice(0, Math.max(0, n - l1.length));
    ctx.textAlign = 'left';
    const x1 = (W - ctx.measureText(l1).width) / 2, x2 = (W - ctx.measureText(l2).width) / 2;
    ctx.fillText(s1, x1, y1); ctx.fillText(s2, x2, y2);
    // caret: steady while typing, blinks after
    const done = n >= l1.length + l2.length;
    if (te >= opts.type.start - 0.3 && (!done || Math.floor(te * 2.2) % 2 === 0)) {
      const onL2 = n > l1.length;
      const cx = onL2 ? x2 + ctx.measureText(s2).width : x1 + ctx.measureText(s1).width;
      ctx.fillStyle = C.coral; ctx.fillRect(cx + size * 0.06, (onL2 ? y2 : y1) - size * 0.78, size * 0.07, size * 0.92);
    }
    ctx.textAlign = 'center';
  }
  // CTA button
  const bAt = opts?.buttonAt ?? 0;
  if (te < bAt) return;
  const pop = opts ? 1 + Math.exp(-(te - bAt) * 9) * Math.sin((te - bAt) * 28) * 0.1 : 1;
  const bw = W * 0.46 * pop, bh = W * 0.12 * pop, by = cy + (tall ? 250 : 215) + W * 0.06 * (1 - pop);
  ctx.fillStyle = C.coral; roundRect(ctx, (W - bw) / 2, by, bw, bh, bh / 2); ctx.fill();
  ctx.fillStyle = C.ink; ctx.font = `600 ${W * 0.05 * pop}px ${FONT}`; ctx.textBaseline = 'middle';
  ctx.fillText('Start today', W / 2, by + bh / 2 + 2);
}

// ---------------- Spots ----------------
const SPOTS = window.SPOTS = {};

// Spot 2: Crushed by setup
SPOTS.setup = {
  // v2 (job 9d00c858): bigger kicker, smaller headline, clay dents and squishes under the panels, typed end line.
  // v3 (job 7d86aa39): slowed down. Gag plays at 2/3 speed (0-6.0s), cut at 6.0s, 9.0s total.
  headline: 'The setup has a setup.', kicker: 'Go-to-market engineering:', kickerScale: 1.0, headScale: 0.72, cut: 6.0, total: 9.0,
  endCard: { logoScale: 0.72, type: { start: 0.3, dur: 1.7 }, buttonAt: 0 },
  draw(ctx, L, R, tReal) {
    const t = tReal / 1.5; // v3: same choreography, 1.5x slower
    const k = R.k, cx = L.W / 2;
    const lands = [1.15, 2.05, 2.95], targets = [0.74, 0.5, 0.17], labels = ['Configure', 'Connect', 'Configure again'];
    // squash amount over time (sticky: fast compression, tiny rebound, no bounce)
    let s = 1;
    // idle settle wobble at start so motion begins immediately
    s += Math.sin(t * 9) * 0.012 * Math.exp(-t * 2);
    for (let i = 0; i < 3; i++) {
      const tau = t - lands[i]; if (tau < 0) break;
      const prev = i ? targets[i - 1] : 1;
      const dip = 0.06 * Math.sin(Math.min(tau / 0.18, 1) * Math.PI) * (tau < 0.18 ? 1 : 0);
      s = targets[i] + (prev - targets[i]) * Math.exp(-tau * 38) - dip;
    }
    // slow ooze after final slam
    const ooze = clamp((t - lands[2]) / 0.9);
    const sFinal = s - 0.02 * ease(ooze);
    const top = R.top;
    const ph = 190 * k, pw = 640 * k;
    // dent: once the first panel lands, the crown under it is pressed flat and the clay squeezes out at its edges
    const squash = 1 - sFinal;
    const dentD = R.w * 0.8 * clamp(squash / 0.26);
    const cap = top * sFinal - dentD;
    const def = (p, b) => {
      const hgt = -p.y; const hn = hgt / top;
      const bulge = 1 + squash * (0.16 + 0.16 * (1 - hn)) + 0.04 * ease(ooze) * (1 - hn);
      const x = p.x * bulge; let yh = hgt * sFinal, w = b.w * (1 + squash * 0.12);
      if (dentD > 0 && yh > cap) {
        const over = yh - cap, under = Math.abs(x) < pw * 0.5 ? 1 : clamp(1 - (Math.abs(x) - pw * 0.5) / (pw * 0.18));
        yh = cap + over * (1 - under) + Math.sin(clamp(over / dentD) * Math.PI) * dentD * 0.9 * (1 - under); // ridge of pushed-out clay at the panel edge
        w *= 1 + 0.6 * under * clamp(over / dentD); // pressed clay spreads fatter
      }
      return { x, y: -yh, w };
    };
    // stack heights
    const rainbowTop = L.ground - cap - R.w * 0.5;
    // camera shake on impacts
    let shake = 0; lands.forEach(l => { const d = t - l; const amp = l === lands[2] ? 22 : 9; if (d >= 0 && d < 0.4) shake += Math.sin(d * 80) * amp * Math.exp(-d * 14); });
    ctx.save(); ctx.translate(0, shake);
    drawRainbow(ctx, L, R, cx, def);
    // "New campaign" card: sits on top, gets buried at first impact
    if (t < lands[0] + 0.02) {
      const cw = 360 * k, ch = 84 * k, y = rainbowTop - ch / 2 - 6;
      ctx.save(); ctx.translate(cx, y); ctx.rotate(-0.03);
      ctx.save(); ctx.filter = 'blur(8px)'; ctx.fillStyle = 'rgba(50,30,10,0.2)'; roundRect(ctx, -cw / 2 + 6, -ch / 2 + 10, cw, ch, ch / 2); ctx.fill(); ctx.restore();
      ctx.fillStyle = C.paper; roundRect(ctx, -cw / 2, -ch / 2, cw, ch, ch / 2); ctx.fill(); ctx.lineWidth = 3 * k; ctx.strokeStyle = C.ink; ctx.stroke();
      ctx.fillStyle = C.ink; ctx.font = `600 ${38 * k}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('New campaign', 0, 2);
      ctx.restore();
    }
    // panels
    let stackTop = rainbowTop;
    const rots = [-0.025, 0.02, -0.012];
    for (let i = 0; i < 3; i++) {
      const fall = 0.32; const tStart = lands[i] - fall; if (t < tStart) break;
      const restY = stackTop - ph / 2 + (i === 0 ? 10 * k : 6 * k);
      const startY = L.headY + 60 + ph / 2;
      let y;
      if (t < lands[i]) { const q = (t - tStart) / fall; y = lerp(startY, restY, q * q); }
      else y = restY;
      const fade = clamp((t - tStart) / 0.06);
      ctx.save(); ctx.globalAlpha = fade;
      drawPanel(ctx, cx + (i - 1) * 8 * k, y, pw - i * 20 * k, ph, labels[i], rots[i], k);
      ctx.restore();
      if (t >= lands[i]) stackTop = y - ph / 2;
    }
    ctx.restore();
  },
};


// ---------- shared bits for spots 1, 3, 4, 5 ----------
const smooth = k => { k = clamp(k); return k * k * (3 - 2 * k); };
const KICK = 'Go-to-market engineering:';
function stackTopY(L, R) { return L.ground - R.top - R.w * 0.5; }
function drawCursor(ctx, x, y, k, press = 0) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1.7 * k * (1 - press * 0.12), 1.7 * k * (1 - press * 0.12));
  ctx.save(); ctx.filter = 'blur(4px)'; ctx.fillStyle = 'rgba(40,25,10,0.3)'; ctx.translate(4, 6);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 34); ctx.lineTo(8, 26); ctx.lineTo(14, 40); ctx.lineTo(20, 37); ctx.lineTo(14, 24); ctx.lineTo(25, 24); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 34); ctx.lineTo(8, 26); ctx.lineTo(14, 40); ctx.lineTo(20, 37); ctx.lineTo(14, 24); ctx.lineTo(25, 24); ctx.closePath();
  ctx.fillStyle = C.ink; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = C.paper; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.restore();
}
function pill(ctx, x, y, text, k, bg, fg, scale = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.font = `600 ${40 * k}px ${FONT}`; const tw = ctx.measureText(text).width; const w = tw + 110 * k, h = 76 * k;
  ctx.save(); ctx.filter = 'blur(10px)'; ctx.fillStyle = 'rgba(50,30,10,0.2)'; roundRect(ctx, -w / 2 + 6, -h / 2 + 10, w, h, h / 2); ctx.fill(); ctx.restore();
  ctx.fillStyle = bg; roundRect(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fill(); ctx.lineWidth = 3 * k; ctx.strokeStyle = C.ink; ctx.stroke();
  // check mark
  ctx.strokeStyle = fg; ctx.lineWidth = 6 * k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-w / 2 + 30 * k, 0); ctx.lineTo(-w / 2 + 42 * k, 12 * k); ctx.lineTo(-w / 2 + 62 * k, -12 * k); ctx.stroke();
  ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, -w / 2 + 80 * k, 2);
  ctx.restore();
}
// sub-polyline of a band between s0 and s1 (indices on pts incl. feet)
function slicePts(pts, s0, s1) { return pts.filter(p => p.s >= s0 - 1e-9 && p.s <= s1 + 1e-9 && !(p.foot)); }

// ---------- Spot 1: Credit meltdown ----------
// v2 (job d0aee1c6): slower (gag 0-6.5s, 9.5s total). The dial is gone: algebra spins off the rainbow, a buzzing
// swarm of ever more complicated equations circles it, and the rainbow melts under them. Typed end line, bigger lockup.
const CREDIT_EQS = [
  'credits × rows', '÷ 0.8', 'x = ?', 'rows × 14 − refunds', 'Σ credits', 'c₁ + c₂ + … + cₙ', 'y = mx + b',
  'Δcredits / Δt', '(c · r) / w', 'f(x) = 3x² − 7', '∫ cost dt', '√(enrich² + rows²)', 'x = (−b ± √(b² − 4ac)) / 2a',
  'lim n→∞ cost(n)', '2ⁿ waterfalls', '% match × $', 'Σᵢ (credits · rowsᵢ)', 'dC/dr = ?', '(rows − dupes) × 1.5',
  '∂cost/∂waterfall', 'Π(1 − bounce)', 'n! enrichments', 'log₂(credits)', '∑ ∑ cᵢⱼ', 'e^(rows·t)', '≈ $$$', 'x² + y² = credits²', '∞ − credits',
];
SPOTS.credit = {
  headline: 'Still doing credit math?', kicker: KICK, cut: 6.5, total: 9.5,
  endCard: { logoScale: 0.72, type: { start: 0.35, dur: 1.7 }, buttonAt: 2.25 },
  draw(ctx, L, R, t) {
    const k = R.k, cx = L.W / 2, top = R.top;
    const m = smooth((t - 3.7) / 2.5); // melt 3.7-6.2s
    // puddle grows under the rainbow
    if (m > 0.02) {
      for (let i = 0; i < BANDS.length; i++) {
        const rx = (top * 0.25 + top * 0.8 * m) * (1 - i * 0.15), ry = (10 + 26 * m) * k * (1 - i * 0.13);
        const yy = L.ground + 6 * k - i * 3 * k * m;
        ctx.save();
        const g = ctx.createLinearGradient(0, yy - ry, 0, yy + ry); g.addColorStop(0, shade(BANDS[i], 0.25)); g.addColorStop(0.6, BANDS[i]); g.addColorStop(1, shade(BANDS[i], -0.2));
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx + Math.sin(i * 2.1) * 12 * m, yy, rx, ry, 0, 0, 7); ctx.fill();
        ctx.restore();
      }
    }
    // strain: the arch shivers more as the swarm builds, then sags
    const strain = smooth((t - 1.0) / 2.6) * (1 - m);
    const def = (p, b) => {
      const hgt = Math.max(-p.y, -R.w * 0.6), hn = clamp(hgt / top);
      const h2 = hgt * (1 - 0.94 * m) * (1 - 0.12 * m * hn);
      const sag = Math.sin((p.x / top) * 3 + t * 2.5) * 7 * k * m * hn;
      const shiv = Math.sin(t * 31 + p.x * 0.05) * 3 * k * strain * hn;
      return { x: p.x * (1 + 0.3 * m * (1 - hn * 0.4)) + shiv, y: -h2 + sag, w: b.w * (1 + 0.3 * m) };
    };
    drawRainbow(ctx, L, R, cx, def);
    // drips
    if (m > 0.05 && m < 0.98) {
      const drips = [[0, 0.3], [0, 0.72], [1, 0.55], [2, 0.18], [3, 0.8], [4, 0.45]];
      drips.forEach(([bi, s], j) => {
        const b = R.bands[bi]; const p = b.pts.reduce((a, q) => Math.abs(q.s - s) < Math.abs(a.s - s) ? q : a);
        const d = def(p, b); const x = cx + d.x, y = L.ground + d.y;
        const len = (50 + j * 9) * k * Math.sin(Math.PI * clamp((m - 0.05) / 0.9));
        const bottom = Math.min(y + len, L.ground - 4);
        if (bottom - y < 6) return;
        const N = 8, pts = []; for (let q = 0; q <= N; q++) { const u = q / N; pts.push({ x: x + Math.sin(u * 3 + j) * 3, y: lerp(y, bottom, u), w: b.w * (0.55 - 0.25 * Math.sin(u * Math.PI)) }); }
        drawTube(ctx, L.W, L.H, pts, b.color, 99 + j);
      });
    }
    // equation swarm: each one pops off the outer band, then joins a buzzing orbit around the arch
    const tall = L.H > 1500;
    const ocx = cx, ocy = L.ground - top * 0.68;
    const rxB = Math.min(top * 1.15, L.W * 0.38), ryB = top * (tall ? 0.8 : 0.66);
    const N = CREDIT_EQS.length;
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (let j = 0; j < N; j++) {
      const ts = 0.5 + 3.4 * Math.pow(j / (N - 1), 0.75); // slow start, then a flood
      const d = t - ts; if (d < 0) continue;
      const Rn = rng(900 + j * 31);
      const a0 = lerp(0.15, 0.85, Rn()) * Math.PI;           // where on the arch it leaves from
      const b0 = R.bands[0], sp = b0.pts.reduce((a, q) => Math.abs(q.s - a0 / Math.PI) < Math.abs(a.s - a0 / Math.PI) ? q : a);
      const p0 = { x: cx + sp.x, y: L.ground + sp.y };
      const nx = Math.cos(Math.PI - a0), ny = -Math.sin(Math.PI - a0);
      // pop: shoot out along the normal and bounce once
      const pop = ease(d / 0.45), bounce = Math.exp(-d * 6) * Math.sin(d * 18) * 14 * k;
      const pPop = { x: p0.x + nx * (90 * k * pop + bounce), y: p0.y + ny * (90 * k * pop + bounce) };
      // orbit: angle speeds up over time (the buzz), each on its own lane
      const lane = 0.82 + Rn() * 0.36, dir = 1;
      const w0 = Math.atan2((pPop.y - ocy) / ryB, (pPop.x - ocx) / rxB);
      const spin = 0.7 + 1.4 * smooth((t - 1.5) / 4) + Rn() * 1.1, fan = (Rn() - 0.3) * Math.PI * 1.3;
      const ang = w0 + fan * smooth((d - 0.35) / 1.2) + dir * (d * spin + 0.25 * d * d * smooth((t - 2) / 3));
      const pOrb = { x: ocx + Math.cos(ang) * rxB * lane, y: ocy + Math.sin(ang) * ryB * lane + Math.sin(t * 7 + j) * 6 * k };
      const join = smooth((d - 0.35) / 0.8);
      const x = lerp(pPop.x, pOrb.x, join), y = lerp(pPop.y, pOrb.y, join);
      const depth = 0.85 + 0.15 * Math.sin(ang); // a touch smaller "behind"
      const sz = (tall ? 60 : 54) * k * (0.8 + 0.45 * Rn()) * Math.min(1, d / 0.25 + 0.2) * depth;
      const rot = (Rn() - 0.5) * 0.5 + Math.sin(t * 3 + j) * 0.12 + (1 - pop) * 1.2 * (Rn() > 0.5 ? 1 : -1);
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.font = `italic 600 ${sz}px ${FONT}`;
      ctx.lineWidth = sz * 0.22; ctx.strokeStyle = 'rgba(251,248,241,0.92)'; ctx.strokeText(CREDIT_EQS[j], 0, 0);
      ctx.fillStyle = j % 5 === 3 ? C.coral : C.ink; ctx.fillText(CREDIT_EQS[j], 0, 0);
      ctx.restore();
    }
    ctx.restore();
  },
};

// ---------- Spot 3: You wanted pipeline ----------
let RAST = null;
function rainbowRaster(L, R) {
  const key = L.W + 'x' + L.H; if (RAST && RAST.key === key) return RAST;
  const c = document.createElement('canvas'); c.width = L.W; c.height = L.H; const x = c.getContext('2d');
  // draw clay without shadow
  const bands = R.bands.map(b => b.pts.map(p => ({ x: L.W / 2 + p.x, y: L.ground + p.y, w: b.w })));
  x.save(); x.beginPath(); x.rect(0, 0, L.W, L.ground); x.clip(); bands.forEach((ps, i) => drawTube(x, L.W, L.H, ps, R.bands[i].color, 11 + i * 7)); x.restore();
  RAST = { key, data: x.getImageData(0, 0, L.W, L.H).data, W: L.W };
  return RAST;
}
SPOTS.pipeline = {
  headline: 'You wanted pipeline.', kicker: KICK, cut: 4.0, total: 7.0,
  headlineAt: t => t < 1.8 ? 'You wanted pipeline.' : 'You got homework.',
  draw(ctx, L, R, t) {
    const k = R.k, cx = L.W / 2, top = R.top;
    const gw = Math.min(L.W - 60, (top + R.w) * 2 + 40), gh = top + R.w * 0.6;
    const gx = cx - gw / 2, gyRest = L.ground - gh;
    const press = 1.0;
    const drop = ease(clamp((t - 0.15) / (press - 0.15)));
    const gy = lerp(gyRest - 220 * k, gyRest, drop * drop);
    const levelT = [press, 2.15, 2.75, 3.3];
    let lvl = -1; levelT.forEach((lt, i) => { if (t >= lt) lvl = i; });
    if (lvl < 0) {
      // rainbow intact, slight anticipation squash as the grid arrives
      const sq = clamp((t - (press - 0.12)) / 0.12) * 0.06;
      drawRainbow(ctx, L, R, cx, (p, b) => ({ x: p.x * (1 + sq), y: p.y * (1 - sq), w: b.w }));
    } else {
      const rast = rainbowRaster(L, R);
      const cols = [8, 16, 32, 64][lvl];
      const cs = gw / cols; const rows = Math.ceil(gh / cs);
      const since = t - levelT[lvl], pop = Math.exp(-since * 10) * Math.sin(since * 40) * 0.08;
      contactShadow(ctx, cx, L.ground, gw / 2 * 0.95, 0.8);
      const Rn = rng(7 + lvl);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const px = Math.floor(gx + (c + 0.5) * cs), py = Math.floor(gyRest + gh - (r + 0.5) * cs);
        const jitter = (Rn() - 0.5), jit2 = (Rn() - 0.5);
        if (px < 0 || py < 0 || px >= L.W || py >= L.H) continue;
        const o = (py * rast.W + px) * 4; const a = rast.data[o + 3];
        if (a < 120) continue;
        const col = `rgb(${rast.data[o]},${rast.data[o + 1]},${rast.data[o + 2]})`;
        const s = cs * (0.86 + pop) * (lvl >= 2 ? 0.8 : 1);
        const x0 = px - s / 2 + jitter * cs * 0.12 * lvl, y0 = py - s / 2 + jit2 * cs * 0.12 * lvl;
        ctx.fillStyle = col; roundRect(ctx, x0, y0, s, s, Math.min(s * 0.22, 14)); ctx.fill();
        if (s > 10) { ctx.fillStyle = 'rgba(255,255,255,0.28)'; roundRect(ctx, x0 + s * 0.12, y0 + s * 0.1, s * 0.5, s * 0.18, s * 0.09); ctx.fill(); ctx.fillStyle = 'rgba(40,20,5,0.18)'; roundRect(ctx, x0 + s * 0.1, y0 + s * 0.8, s * 0.8, s * 0.12, s * 0.06); ctx.fill(); }
      }
    }
    // the grid: bold lines, gets denser with each level
    const cols = lvl < 0 ? 8 : [8, 16, 32, 64][lvl];
    const cs = gw / cols, rows = Math.ceil(gh / cs);
    ctx.save(); ctx.globalAlpha = clamp(t / 0.25);
    ctx.beginPath(); ctx.rect(0, L.headY + 50, L.W, L.H); ctx.clip();
    ctx.strokeStyle = C.ink; ctx.lineCap = 'square';
    const yBase = (lvl < 0 ? gy : gyRest) + gh;
    ctx.lineWidth = lvl >= 2 ? 2 : 4;
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) { ctx.moveTo(gx + c * cs, yBase - rows * cs); ctx.lineTo(gx + c * cs, yBase); }
    for (let r = 0; r <= rows; r++) { ctx.moveTo(gx, yBase - r * cs); ctx.lineTo(gx + gw, yBase - r * cs); }
    ctx.stroke();
    ctx.lineWidth = 8; ctx.strokeRect(gx, yBase - rows * cs, gw, rows * cs);
    ctx.restore();
  },
};

// ---------- Spot 4: The rainbow repair job ----------
// v2 (job 6b3d0a2e): no kicker, 8s of the cursor chasing pieces back in while more keep breaking out.
// The rainbow never collapses; it's a fight the whole time. Typed end line.
const REPAIR_CHUNKS = [ // band, s0, s1, out direction (tilt), breaks at, fixed at (99 = never)
  [0, 0.62, 0.80, 1, 0.5, 1.6], [1, 0.14, 0.34, -1, 1.1, 2.4], [3, 0.55, 0.75, 1, 1.9, 3.1], [2, 0.30, 0.48, -1, 2.6, 3.8],
  [0, 0.12, 0.30, -1, 3.2, 4.5], [4, 0.40, 0.62, 1, 3.7, 5.1], [1, 0.70, 0.88, 1, 4.4, 5.7], [2, 0.78, 0.95, 1, 4.9, 6.3],
  [3, 0.10, 0.28, -1, 5.4, 6.9], [0, 0.42, 0.58, 1, 5.9, 7.5], [4, 0.75, 0.92, 1, 6.5, 99], [1, 0.40, 0.55, -1, 7.1, 99],
].map(([band, s0, s1, out, tb, tf]) => ({ band, s0, s1, out, tb, tf }));
SPOTS.repair = {
  headline: 'Another day fixing workflows.', kicker: null, cut: 8.0, total: 11.0,
  endCard: { type: { start: 0.35, dur: 1.7 }, buttonAt: 2.25 },
  draw(ctx, L, R, t) {
    const k = R.k, cx = L.W / 2;
    // how far out a chunk is: pops out, keeps sagging while it waits, snaps back when the cursor pushes it
    const amtOf = c => {
      const rise = ease(clamp((t - c.tb) / 0.35));
      const sag = 1 + 0.35 * smooth((t - c.tb - 0.35) / 1.4);
      const back = 1 - smooth((t - c.tf) / 0.3);
      return rise * sag * back;
    };
    const midOf = c => { const b = R.bands[c.band], s = (c.s0 + c.s1) / 2; return b.pts.reduce((a, q) => Math.abs(q.s - s) < Math.abs(a.s - s) ? q : a); };
    const offsetOf = (c, amt) => { const m = midOf(c), len = Math.hypot(m.x, m.y) || 1; return { dx: m.x / len * 120 * k * amt, dy: m.y / len * 80 * k * amt + 95 * k * amt * amt, m }; };
    const pieceXf = (pts, c, amt) => {
      const { dx, dy, m } = offsetOf(c, amt); const rot = 0.35 * amt * c.out;
      return pts.map(p => { const x = p.x - m.x, y = p.y - m.y; return { x: m.x + x * Math.cos(rot) - y * Math.sin(rot) + dx, y: m.y + x * Math.sin(rot) + y * Math.cos(rot) + dy, s: p.s }; });
    };
    const pieces = [];
    R.bands.forEach((b, bi) => {
      const chunks = REPAIR_CHUNKS.filter(c => c.band === bi && amtOf(c) > 0.001);
      let bounds = [0, 1]; chunks.forEach(c => bounds.push(c.s0, c.s1));
      bounds = [...new Set(bounds)].sort((a, c) => a - c);
      for (let j = 0; j < bounds.length - 1; j++) {
        const s0 = bounds[j], s1 = bounds[j + 1];
        let pts = b.pts.filter((p, pi) => p.s >= s0 - 1e-6 && p.s <= s1 + 1e-6 && pi > 0 && pi < b.pts.length - 1);
        if (s0 === 0) pts = [b.pts[0], ...pts]; if (s1 === 1) pts = [...pts, b.pts[b.pts.length - 1]];
        if (pts.length < 2) continue;
        const ch = chunks.find(c => Math.abs(c.s0 - s0) < 1e-6 && Math.abs(c.s1 - s1) < 1e-6);
        if (ch) pts = pieceXf(pts, ch, amtOf(ch));
        pieces.push({ pts, b, seed: bi * 13 + j });
      }
    });
    contactShadow(ctx, cx, L.ground, R.top + R.w * 0.5);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, L.W, L.ground + 3); ctx.clip();
    pieces.forEach(pc => drawTube(ctx, L.W, L.H, pc.pts.map(p => ({ x: cx + p.x, y: L.ground + p.y, w: pc.b.w })), pc.b.color, pc.seed));
    ctx.restore();
    // cursor: chases each broken piece in the order it was fixed, rides it back in, then rushes to the next
    const tip = (c, amt) => { const { dx, dy, m } = offsetOf(c, amt); return { x: cx + m.x + dx + 22 * k, y: L.ground + m.y + dy + 16 * k }; };
    const fixes = REPAIR_CHUNKS.filter(c => c.tf < 50);
    const pending = REPAIR_CHUNKS.filter(c => c.tf > 50);
    let cur = { x: L.W + 80, y: L.ground + 140 * k }, pressing = 0, prevEnd = { t: 0.6, p: cur };
    for (const c of [...fixes, ...pending]) {
      const tArrive = c.tf < 50 ? c.tf - 0.05 : Math.max(prevEnd.t + 0.55, c.tb + 0.45);
      if (t < prevEnd.t) { cur = prevEnd.p; break; }
      if (t < tArrive) {
        const u = ease((t - prevEnd.t) / (tArrive - prevEnd.t)), q = tip(c, amtOf(c));
        cur = { x: lerp(prevEnd.p.x, q.x, u), y: lerp(prevEnd.p.y, q.y, u) - Math.sin(u * Math.PI) * 90 * k };
        break;
      }
      if (c.tf > 50) { cur = tip(c, amtOf(c)); break; }
      const tEnd = c.tf + 0.32;
      if (t < tEnd) { cur = tip(c, amtOf(c)); pressing = 1; break; }
      prevEnd = { t: tEnd, p: tip(c, 0) }; cur = prevEnd.p;
    }
    drawCursor(ctx, cur.x, cur.y, k, pressing);
  },
};

// ---------- Spot 5: What did it actually do? ----------
// v2 (job e12252a0): slower, fewer things. The rainbow unravels band by band into a tangled heap, then "Done" pops.
// v3 (job f593da1e): headline is just "Go-to-market engineering" in big ink type (no question line). A cursor clicks a
// play button on the floor and that starts the unravel. Each strand now droops gently from its cut point instead of
// shooting across the frame. "Done" pops big over the messy pile and holds ~2.7s. Cut at 8.5s, 11.5s total.
function playButton(ctx, x, y, r, press, alpha) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.scale(1 + press * 0.08, 1 - press * 0.12);
  ctx.save(); ctx.filter = 'blur(12px)'; ctx.fillStyle = 'rgba(50,30,10,0.25)'; ctx.beginPath(); ctx.ellipse(8, r * 0.75, r * 1.05, r * 0.35, 0, 0, 7); ctx.fill(); ctx.restore();
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.05);
  g.addColorStop(0, shade(C.coral, 0.3)); g.addColorStop(0.55, C.coral); g.addColorStop(1, shade(C.coral, -0.25));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  ctx.lineWidth = Math.max(3, r * 0.05); ctx.strokeStyle = C.ink; ctx.stroke();
  ctx.fillStyle = C.paper; ctx.beginPath(); ctx.moveTo(-r * 0.28, -r * 0.42); ctx.lineTo(r * 0.48, 0); ctx.lineTo(-r * 0.28, r * 0.42); ctx.closePath();
  ctx.lineJoin = 'round'; ctx.lineWidth = r * 0.12; ctx.strokeStyle = C.paper; ctx.stroke(); ctx.fill();
  ctx.restore();
}
SPOTS.output = {
  headline: 'Go-to-market engineering', kicker: null, cut: 8.5, total: 11.5,
  endCard: { logoScale: 0.72, type: { start: 0.35, dur: 1.7 }, buttonAt: 2.25 },
  drawHead(ctx, L) { // two big ink lines, top of frame
    ctx.save(); ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const tall = L.H > 1500; let size = L.W * (tall ? 0.15 : 0.125);
    ctx.font = `700 ${size}px ${FONT}`;
    const fit = (L.W - 110) / ctx.measureText('Go-to-market').width; if (fit < 1) { size *= fit; ctx.font = `700 ${size}px ${FONT}`; }
    const y2 = tall ? L.headY + 90 : L.headY + 10, y1 = y2 - size * 1.02;
    ctx.fillText('Go-to-market', L.W / 2, y1); ctx.fillText('engineering', L.W / 2, y2);
    ctx.restore();
  },
  // v5 (job a67087d0, review 24b70244) applies to the 9:16 asset only; the 4:5 asset keeps the v4 kneading gag.
  draw(ctx, L, R, t) { if (L.H > 1500) return outputBurst(ctx, L, R, t); return this.drawKnead(ctx, L, R, t); },
  drawKnead(ctx, L, R, t) {
    const k = R.k, cx = L.W / 2, tall = L.H > 1500;
    const fl = L.H - L.ground;
    // 1) play button on the floor; cursor glides in, clicks at 1.4s, button squishes and shrinks away
    const CLICK = 1.4;
    const bx = cx, by = L.ground + fl * (tall ? 0.3 : 0.4), br = (tall ? 140 : 98) * k;
    const press = clamp((t - CLICK) / 0.12) * (1 - clamp((t - CLICK - 0.15) / 0.12));
    const gone = smooth((t - CLICK - 0.2) / 0.35);
    // 2) a clay hand comes down and kneads the rainbow, press by press, into a failed lump (v4)
    const pr = outputPress(t, cx, k);
    const m = pr.m; // 0 = rainbow, 1 = hodgepodge
    const Wm = (tall ? 250 : 230) * k, Hm = (tall ? 175 : 150) * k;
    const shapes = R.bands.map((b, i) => {
      const Rn = rng(500 + i * 31), N = b.pts.length;
      const ph = [Rn() * 6.28, Rn() * 6.28, Rn() * 6.28, Rn() * 6.28];
      const fa = 1.6 + i * 0.41 + Rn() * 0.5, fb = 4.3 + Rn() * 1.5, fc = 3.7 + i * 0.33 + Rn(), fd = 7.1 + Rn();
      const delay = Rn() * 0.25;
      return b.pts.map((p, j) => {
        const v = j / (N - 1), T = v * Math.PI * 2;
        // each colour gets its own patch of the lump, so all five stay visible, mashed side by side
        const ox = [-0.45, 0.35, -0.05, 0.5, -0.3][i], sw = 0.55;
        const u = clamp(ox + sw * (0.72 * Math.sin(fa * T + ph[0]) + 0.28 * Math.sin(fb * T + ph[1])), -1, 1);
        const env = Math.pow(1 - u * u, 0.6);
        const tw = b.w * (0.95 + 0.6 * (0.5 + 0.5 * Math.sin(fd * T + ph[3])));
        const tgt = { x: u * Wm, y: -tw * 0.42 - Hm * env * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(fc * T + ph[2]))), w: tw };
        const mj = smooth((m * 1.3 - delay - 0.05 * Math.sin(T * 3 + i)) / 1.0);
        let x = lerp(p.x, tgt.x, mj), y = lerp(p.y, tgt.y, mj), w = lerp(b.w, tgt.w, mj);
        // squash under the hand: push down and out around the contact point
        if (pr.down > 0) {
          const dx = cx + x - pr.x, f = Math.exp(-(dx * dx) / (2 * Math.pow(150 * k, 2))) * pr.down;
          y = y * (1 - 0.45 * f); x += Math.sign(dx || 1) * 40 * k * f; w *= 1 + 0.35 * f;
        }
        return { x: cx + x, y: L.ground + Math.min(y, b.w * 0.6), w };
      });
    });
    let minX = 1e9, maxX = -1e9; shapes.forEach(ps => ps.forEach(p => { minX = Math.min(minX, p.x - p.w / 2); maxX = Math.max(maxX, p.x + p.w / 2); }));
    contactShadow(ctx, (minX + maxX) / 2, L.ground, (maxX - minX) / 2);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, L.W, L.ground + 3); ctx.clip();
    // late in the morph, draw bands in a shuffled order so colours sit on top of each other like mashed clay
    if (m < 0.35) shapes.forEach((ps, i) => drawTube(ctx, L.W, L.H, ps, R.bands[i].color, 11 + i * 7));
    else { // chop each band into pieces and interleave them, so colours fold over each other like mashed clay
      const pieces = []; shapes.forEach((ps, i) => { const n = ps.length, q = 4; for (let c = 0; c < q; c++) pieces.push({ i, c, ps: ps.slice(Math.floor(c * (n - 1) / q), Math.floor((c + 1) * (n - 1) / q) + 2) }); });
      const Rs = rng(907); pieces.map(p => ({ p, r: Rs() })).sort((a, b) => a.r - b.r).forEach(({ p }) => drawTube(ctx, L.W, L.H, p.ps, R.bands[p.i].color, 11 + p.i * 7 + p.c));
    }
    ctx.restore();
    playButton(ctx, bx, by, br * (1 - 0.6 * gone), press, 1 - gone);
    if (pr.vis > 0) clayHand(ctx, L, pr.x, L.ground - pr.contact(shapes, L.ground) + 6 * k - pr.lift, k * (tall ? 1.1 : 1));
    // 3) "Done": pops in big over the lump, with a burst, and holds
    const DONE = OUT_DONE;
    if (t > DONE) {
      const d = t - DONE;
      const grow = d < 0.28 ? ease(d / 0.28) * 1.18 : 1 + Math.exp(-(d - 0.28) * 7) * Math.cos((d - 0.28) * 20) * 0.18;
      const dx = cx, dy = L.ground - Hm - (tall ? 300 : 230) * k;
      if (d < 0.9) {
        ctx.save(); ctx.translate(dx, dy); ctx.strokeStyle = C.ink; ctx.lineCap = 'round'; ctx.lineWidth = 9 * k; ctx.globalAlpha = 1 - clamp((d - 0.4) / 0.5);
        for (let r = 0; r < 12; r++) { const a = r / 12 * Math.PI * 2 + 0.13, r0 = (230 + 260 * ease(d / 0.6)) * k, r1 = r0 + 70 * k * (1 - clamp(d / 0.9));
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0 * 0.7); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1 * 0.7); ctx.stroke(); }
        ctx.restore();
      }
      ctx.save(); ctx.translate(dx, dy); ctx.rotate(-0.06 * Math.exp(-d * 3)); pill(ctx, 0, 0, 'Done', k * 1.35, '#CDF05B', C.ink, (tall ? 2.4 : 2.0) * grow); ctx.restore();
    }
    // cursor: glides in from lower right, clicks the play button, then drifts out
    const tip = { x: bx + br * 0.25, y: by + br * 0.2 };
    let cur = null;
    if (t < CLICK) { const q = ease((t - 0.3) / (CLICK - 0.3)); cur = { x: lerp(L.W + 60, tip.x, q), y: lerp(L.H + 40, tip.y, q) - Math.sin(q * Math.PI) * 60 * k }; }
    else if (t < CLICK + 0.35) cur = tip;
    else if (t < 2.6) { const q = smooth((t - CLICK - 0.35) / 0.85); cur = { x: lerp(tip.x, L.W + 80, q), y: lerp(tip.y, L.H + 60, q) }; }
    if (cur) drawCursor(ctx, cur.x, cur.y, k * (tall ? 1.15 : 1), press);
  },
};

// v4 (jobs ba1bc4ab / d4880127): the unravel read as unclear, so a clay hand now kneads the rainbow, press by press,
// into an unrecognisable lump. Hand enters ~1.9s, five presses 2.4-5.6s, leaves by 6.3s, "Done" at 6.5s.
const OUT_PRESSES = [2.45, 3.1, 3.75, 4.4, 5.1];
const OUT_DONE = 6.5;
function outputPress(t, cx, k) {
  const xs = [40, -130, 140, -40, 70].map(v => cx + v * k);
  const PD = 0.5; // each press: down 0.18s, hold, up
  let m = 0, down = 0, x = xs[0];
  OUT_PRESSES.forEach((p, i) => {
    m += 0.2 * smooth((t - p - 0.05) / 0.3);
    const ph = (t - p) / PD; if (ph > 0 && ph < 1) down = Math.max(down, ph < 0.35 ? smooth(ph / 0.35) : 1 - smooth((ph - 0.35) / 0.65));
  });
  // hand x glides between press spots while lifted
  for (let i = 0; i < OUT_PRESSES.length; i++) { const a = OUT_PRESSES[i], b = OUT_PRESSES[i + 1]; if (t >= a) x = b && t > a + PD * 0.6 ? lerp(xs[i], xs[i + 1], smooth((t - a - PD * 0.6) / (b - a - PD * 0.6))) : xs[i]; }
  const enter = smooth((t - 1.9) / 0.5), leave = smooth((t - 5.75) / 0.55);
  const lift = (1 - down) * 150 * k + (1 - enter) * 250 * k + leave * 250 * k;
  return { m: clamp(m), down, x: x + (1 - enter) * 900 * k + leave * 1000 * k, lift, vis: t > 1.85 && t < 6.4 ? 1 : 0,
    contact(shapes, ground) { // height of the clay top under the hand, above the floor
      let top = 0; shapes.forEach(ps => ps.forEach(p => { if (Math.abs(p.x - this.x) < 90 * k) top = Math.max(top, ground - (p.y - p.w / 2)); })); return top; } };
}
// Clay hand pressing down, palm toward the floor, fingertips at (x, y). Arm comes in from the top right.
function clayHand(ctx, L, x, y, k) {
  const skin = '#E9B48F', sleeve = '#3B3F48';
  const P = (dx, dy) => ({ x: x + dx * k, y: y + dy * k });
  const tube = (pts, w, col, seed) => drawTube(ctx, L.W, L.H, pts.map(([a, b]) => ({ ...P(a, b), w: w * k })), col, seed);
  tube([[190, -250], [420, -330], [700, -420], [1000, -510]], 150, sleeve, 71);
  tube([[70, -150], [130, -215], [200, -255]], 120, skin, 72); // wrist
  tube([[-40, -90], [20, -110], [80, -150]], 175, skin, 73); // palm
  [[-120, -60, -150, -10], [-80, -55, -95, -2], [-35, -55, -40, 0], [10, -60, 15, -8]].forEach(([a, b, c, d], i) =>
    tube([[a + 20, b - 40], [a, b], [c, d]], 52 - i * 2, skin, 80 + i)); // fingers, tips on the clay
  tube([[95, -150], [125, -95], [120, -45]], 56, skin, 90); // thumb
}

// v5 (job a67087d0, review 24b70244), 9:16 only: no hand. Cursor hits play, pressure surges through the clay tubes
// (bulges run along each band, the rainbow trembles), then the tubes burst like a pipe: clay sprays all over the screen,
// the rainbow collapses onto the floor, and "Done" pops over the mess. Same 8.5s cut, 11.5s total.
const OUT5 = { click: 1.4, surge: 1.8, burst: 4.7, done: 6.3 };
function clayBlob(ctx, x, y, r, color, seed, squash = 1, rot = 0) {
  if (r <= 0.5) return;
  const Rn = rng(seed), n = 5, ph = Rn() * 6.28, amp = 0.07 + Rn() * 0.07;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1 / Math.sqrt(squash), squash);
  ctx.save(); ctx.filter = `blur(${r * 0.25}px)`; ctx.fillStyle = 'rgba(60,35,15,0.22)'; ctx.beginPath(); ctx.ellipse(r * 0.18, r * 0.24, r, r * 0.9, 0, 0, 7); ctx.fill(); ctx.restore();
  ctx.beginPath();
  for (let j = 0; j <= 48; j++) { const a = j / 48 * Math.PI * 2; const rr = r * (1 + amp * Math.sin(a * 3 + ph) + amp * 0.45 * Math.sin(a * n + ph * 2) + amp * 0.5 * Math.sin(a * 2 + ph * 3));
    j ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath();
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r * 1.25);
  g.addColorStop(0, shade(color, 0.42)); g.addColorStop(0.45, color); g.addColorStop(1, shade(color, -0.3));
  ctx.fillStyle = g; ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.ellipse(-r * 0.38, -r * 0.42, r * 0.16, r * 0.09, -0.6, 0, 7); ctx.fill();
  ctx.restore();
}
function outputBurst(ctx, L, R, t) {
  const k = R.k, cx = L.W / 2, fl = L.H - L.ground, T = OUT5;
  const bx = cx, by = L.ground + fl * 0.3, br = 140 * k;
  const press = clamp((t - T.click) / 0.12) * (1 - clamp((t - T.click - 0.15) / 0.12));
  const gone = smooth((t - T.click - 0.2) / 0.35);
  // pressure: 0 at surge start -> 1 just before the burst
  const P = clamp((t - T.surge) / (T.burst - T.surge));
  const db = t - T.burst; // time since burst
  const shake = db < 0 ? Math.pow(P, 3) * 9 * k : 0;
  const sx = Math.sin(t * 71) * shake, sy = Math.cos(t * 53) * shake * 0.6;
  // rupture points per band (s along the arc)
  const RUP = [[0.36, 0.71], [0.28, 0.62], [0.47, 0.83], [0.22, 0.55], [0.4, 0.76]];
  const fall = db > 0 ? clamp(db / 0.9) : 0, fallE = fall * fall * (3 - 2 * fall);
  const bandPts = R.bands.map((b, i) => b.pts.map(p => {
    let x = p.x, y = p.y, w = b.w;
    if (db < 0 && t > T.surge) { // bulges travelling through the tube, faster and bigger as pressure builds
      let bulge = 0; const speed = 0.35 + P * 1.4;
      for (let q = 0; q < 2; q++) { const pos = ((t - T.surge) * speed + q * 0.5 + i * 0.13) % 1.2 - 0.1; bulge += Math.exp(-Math.pow((p.s - pos) / 0.07, 2)); }
      w *= 1 + (0.18 + 0.55 * P) * bulge + 0.12 * P * P;
      const n = Math.hypot(x, y) || 1; x += x / n * w * 0.08 * bulge; y += y / n * w * 0.08 * bulge;
    }
    if (db > 0) { // collapse: arc flattens and slumps onto the floor, spreading outward
      const spread = 1 - 0.12 * fallE, lump = 0.5 + 0.5 * Math.sin(p.s * 9 + i * 1.9), yFloor = -w * 0.4 - i * w * 0.32 * lump - (1 - Math.abs(p.s - 0.5) * 2) * 40 * k;
      x = x * spread + Math.sin(p.s * 20 + i) * 14 * k * fallE; y = lerp(y, yFloor, fallE); w *= 1 + 0.25 * fallE;
    }
    return { x: cx + x + sx, y: L.ground + Math.min(y, b.w * 0.6) + sy, w, s: p.s };
  }));
  let minX = 1e9, maxX = -1e9; bandPts.forEach(ps => ps.forEach(p => { minX = Math.min(minX, p.x - p.w / 2); maxX = Math.max(maxX, p.x + p.w / 2); }));
  contactShadow(ctx, (minX + maxX) / 2, L.ground, (maxX - minX) / 2);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, L.W, L.ground + 3); ctx.clip();
  bandPts.forEach((ps, i) => {
    if (db <= 0) { drawTube(ctx, L.W, L.H, ps, R.bands[i].color, 11 + i * 7); return; }
    const gap = 0.025 + 0.05 * clamp(db / 0.3); const [r1, r2] = RUP[i];
    [[0, r1 - gap], [r1 + gap, r2 - gap], [r2 + gap, 1]].forEach(([a, c], q) => { const seg = ps.filter(p => p.s >= a && p.s <= c); if (seg.length > 1) drawTube(ctx, L.W, L.H, seg, R.bands[i].color, 11 + i * 7 + q); });
  });
  ctx.restore();
  // flying clay from each rupture: arcs out, lands and splats on the floor
  if (db > 0) {
    const g = 2600 * k;
    R.bands.forEach((b, i) => RUP[i].forEach((rs, q) => {
      const idx = Math.round(rs * (b.pts.length - 3)) + 1, o = b.pts[idx];
      const ox = cx + o.x, oy = L.ground + o.y, nx = o.x / (Math.hypot(o.x, o.y) || 1), ny = o.y / (Math.hypot(o.x, o.y) || 1);
      const Rn = rng(300 + i * 17 + q * 5);
      for (let m = 0; m < 7; m++) {
        const sp = (700 + Rn() * 1300) * k, ang = Math.atan2(ny, nx) + (Rn() - 0.5) * 1.6;
        const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp - 300 * k * Rn(), r = (12 + Rn() * 26) * k;
        // landing time on the floor band (somewhere between ground and the bottom of frame)
        const land = L.ground + (0.05 + Rn() * 0.8) * fl, tLand = (-vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * (land - oy)))) / g;
        const tt = Math.min(db, tLand); const x = ox + vx * tt, y = oy + vy * tt + 0.5 * g * tt * tt;
        const landed = db >= tLand, sq = landed ? lerp(1, 0.55, clamp((db - tLand) / 0.08)) : 1;
        if (x > -80 && x < L.W + 80) clayBlob(ctx, x, y, r * (landed ? 1.2 : 1), b.color, 900 + i * 50 + q * 10 + m, sq, landed ? 0 : ang);
      }
    }));
    // splats that hit the screen itself: big flattened clay all over the frame, sliding down slowly
    const SPL = 16, Rs = rng(4242);
    for (let m = 0; m < SPL; m++) {
      const col = BANDS[m % BANDS.length], tx = (0.06 + Rs() * 0.88) * L.W, ty = L.headY + 300 * k + Rs() * (L.H - L.headY - 380 * k);
      const at = 0.06 + Rs() * 0.3, r = (45 + Rs() * 75) * k, d = db - at; if (d <= 0) continue;
      const pop = d < 0.12 ? ease(d / 0.12) * 1.15 : 1 + 0.15 * Math.exp(-(d - 0.12) * 12);
      const slide = Math.max(0, d - 0.4) * (18 + Rs() * 25) * k;
      clayBlob(ctx, tx, ty + slide, r * pop, col, 7000 + m, 0.82, Rs() * 3);
    }
  }
  playButton(ctx, bx, by, br * (1 - 0.6 * gone), press, 1 - gone);
  // "Done" pops big over the mess and holds
  if (t > T.done) {
    const d = t - T.done;
    const grow = d < 0.28 ? ease(d / 0.28) * 1.18 : 1 + Math.exp(-(d - 0.28) * 7) * Math.cos((d - 0.28) * 20) * 0.18;
    const dx = cx, dy = L.ground - 470 * k;
    if (d < 0.9) {
      ctx.save(); ctx.translate(dx, dy); ctx.strokeStyle = C.ink; ctx.lineCap = 'round'; ctx.lineWidth = 9 * k; ctx.globalAlpha = 1 - clamp((d - 0.4) / 0.5);
      for (let r = 0; r < 12; r++) { const a = r / 12 * Math.PI * 2 + 0.13, r0 = (230 + 260 * ease(d / 0.6)) * k, r1 = r0 + 70 * k * (1 - clamp(d / 0.9));
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0 * 0.7); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1 * 0.7); ctx.stroke(); }
      ctx.restore();
    }
    ctx.save(); ctx.translate(dx, dy); ctx.rotate(-0.06 * Math.exp(-d * 3)); pill(ctx, 0, 0, 'Done', k * 1.35, '#CDF05B', C.ink, 2.4 * grow); ctx.restore();
  }
  // cursor: glides in from lower right, clicks play, drifts out
  const tip = { x: bx + br * 0.25, y: by + br * 0.2 }; let cur = null;
  if (t < T.click) { const q = ease((t - 0.3) / (T.click - 0.3)); cur = { x: lerp(L.W + 60, tip.x, q), y: lerp(L.H + 40, tip.y, q) - Math.sin(q * Math.PI) * 60 * k }; }
  else if (t < T.click + 0.35) cur = tip;
  else if (t < 2.6) { const q = smooth((t - T.click - 0.35) / 0.85); cur = { x: lerp(tip.x, L.W + 80, q), y: lerp(tip.y, L.H + 60, q) }; }
  if (cur) drawCursor(ctx, cur.x, cur.y, k * 1.15, press);
}

function drawFrame(canvas, spotKey, ratio, t, logoImg) {
  const L = LAYOUT[ratio]; canvas.width = L.W; canvas.height = L.H;
  const ctx = canvas.getContext('2d');
  const sp = SPOTS[spotKey], cut = sp.cut ?? 2.0;
  if (t >= cut) { drawEndCard(ctx, L, logoImg, sp.endCard || null, t - cut); return; }
  const R = rainbowRest(L);
  drawStage(ctx, L);
  sp.draw(ctx, L, R, t);
  if (sp.drawHead) sp.drawHead(ctx, L, t);
  else drawHeadline(ctx, L, sp.headlineAt ? sp.headlineAt(t) : sp.headline, 1, sp.kicker || null, sp.kickerScale ?? 0.62, sp.headScale ?? 1);
}
window.drawFrame = drawFrame;
