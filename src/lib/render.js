// Yoke brand renderers: static ads drawn on canvas, kinetic-type motion recorded in the browser.
/* eslint-disable */
const BR={ground:"#F7F4EC",ink:"#111317",second:"#2A2D33",coral:"#F04B37",lime:"#CDF05B",paper:"#FFFFFF",stone:"#D8D5CD",muted:"#686A63",panel:"#EFEEE8",coralTint:"#FDE3DF"};
const FONT='"Instrument Sans",Inter,Arial,sans-serif';
const LOGO=[["M16 18 C16 52 36 58 96 58 C156 58 160 64 160 98","coral",true],["M168 18 C168 52 148 58 96 58 C44 58 28 64 28 98","ink",true]];
const LOGO_GLYPHS=[[190.4239,"M279 0V-291L11 -720H196L408 -339H321L532 -720H701L433 -291V0Z"],[240.6828,"M302 10Q218 10 154.5 -23.5Q91 -57 55.5 -117.5Q20 -178 20 -257Q20 -336 55.5 -395.0Q91 -454 154.5 -487.0Q218 -520 302 -520Q387 -520 450.5 -487.0Q514 -454 549.0 -395.0Q584 -336 584 -257Q584 -178 548.5 -117.5Q513 -57 449.5 -23.5Q386 10 302 10ZM302 -108Q337 -108 365.5 -126.0Q394 -144 411.0 -177.5Q428 -211 428 -258Q428 -327 391.5 -364.5Q355 -402 302 -402Q249 -402 212.5 -364.0Q176 -326 176 -258Q176 -211 193.0 -177.5Q210 -144 238.5 -126.0Q267 -108 302 -108Z"],[299.7606,"M60 0V-720H210V0ZM387 0 175 -265 382 -510H555L312 -242L319 -289L565 0Z"],[347.7343,"M300 10Q215 10 152.0 -23.5Q89 -57 54.5 -117.0Q20 -177 20 -255Q20 -334 54.5 -393.5Q89 -453 151.0 -486.5Q213 -520 295 -520Q374 -520 432.0 -488.0Q490 -456 522.0 -399.0Q554 -342 554 -265Q554 -249 553.0 -235.5Q552 -222 550 -210H108V-309H429L403 -291Q403 -353 373.5 -382.5Q344 -412 293 -412Q234 -412 201.5 -372.0Q169 -332 169 -252Q169 -174 201.5 -136.0Q234 -98 299 -98Q335 -98 361.0 -110.0Q387 -122 400 -149H541Q516 -75 455.5 -32.5Q395 10 300 10Z"]];
function drawLogo(ctx,x,y,w,ink){const s=w/401.59;ctx.save();ctx.translate(x-5*s,y-7*s);ctx.scale(s,s);ctx.lineCap="round";ctx.lineJoin="round";ctx.lineWidth=22;
  ctx.strokeStyle=BR.coral;ctx.stroke(new Path2D(LOGO[0][0]));ctx.strokeStyle=ink||BR.ink;ctx.stroke(new Path2D(LOGO[1][0]));ctx.fillStyle=ink||BR.ink;
  for(const[tx,d]of LOGO_GLYPHS){ctx.save();ctx.translate(tx,103.9);ctx.scale(0.10625,0.10625);ctx.fill(new Path2D(d));ctx.restore()}ctx.restore()}
function font(ctx,wt,px,ls){ctx.font=`${wt} ${px}px ${FONT}`;try{ctx.letterSpacing=(ls||0)+"px"}catch(_){}}
function wrap(ctx,text,maxW){const words=String(text||"").split(/\s+/).filter(Boolean);const out=[];let line="";
  for(const w of words){const t=line?line+" "+w:w;if(ctx.measureText(t).width>maxW&&line){out.push(line);line=w}else line=t}if(line)out.push(line);return out}
function fitLines(ctx,text,maxW,wt,px,minPx,maxLines,lsEm){let p=px;for(;p>=minPx;p-=4){font(ctx,wt,p,p*(lsEm||0));const L=wrap(ctx,text,maxW);if(L.length<=maxLines)return{lines:L,px:p}}font(ctx,wt,minPx,minPx*(lsEm||0));return{lines:wrap(ctx,text,maxW),px:minPx}}
function drawRich(ctx,lines,x,y,lh,accent,base){let acc=accent&&accent.trim()?accent.trim():null;
  for(let i=0;i<lines.length;i++){const ln=lines[i];if(acc&&ln.includes(acc)){const k=ln.indexOf(acc);const pre=ln.slice(0,k);ctx.fillStyle=base;ctx.fillText(pre,x,y+i*lh);const w=ctx.measureText(pre).width;ctx.fillStyle=BR.coral;ctx.fillText(acc,x+w,y+i*lh);ctx.fillStyle=base;ctx.fillText(ln.slice(k+acc.length),x+w+ctx.measureText(acc).width,y+i*lh)}
    else{ctx.fillStyle=base;ctx.fillText(ln,x,y+i*lh)}}}
function rr(ctx,x,y,w,h,r,fill,stroke,lw){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw||2;ctx.stroke()}}
function pill(ctx,text,x,y,px,bg,fg,alignRight){font(ctx,700,px,0);const w=ctx.measureText(text).width+px*1.4,hh=px*1.7;const X=alignRight?x-w:x;rr(ctx,X,y,w,hh,hh/2,bg);ctx.fillStyle=fg;ctx.textBaseline="middle";ctx.fillText(text,X+px*0.7,y+hh/2+1);ctx.textBaseline="alphabetic";return{w,h:hh}}
const DIMS={feed45:[1080,1350],square:[1080,1080],vertical:[1080,1920]};
async function fontsReady(){try{await Promise.all(["700 80px \"Instrument Sans\"","500 40px \"Instrument Sans\"","600 30px \"Instrument Sans\""].map(f=>document.fonts.load(f)))}catch(_){}}
function drawStatic(ctx,W,H,s){
  const pad=80,top=H>1500?300:80,bottom=H>1500?1500:H-72,inner=W-pad*2;
  ctx.fillStyle=BR.ground;ctx.fillRect(0,0,W,H);ctx.textBaseline="alphabetic";
  const layout=s.layout||"card";
  const hk=fitLines(ctx,s.hook,inner,700,layout==="statement"?120:H<1200?76:84,52,layout==="statement"?5:4,-0.04);
  let y=top+hk.px*0.86;drawRich(ctx,hk.lines,pad,y,hk.px*1.04,s.hookAccent,BR.ink);y+=(hk.lines.length-1)*hk.px*1.04;
  if(s.sub){y+=hk.px*0.5+10;const sb=fitLines(ctx,s.sub,inner,layout==="quote"?600:500,40,28,3,0);ctx.fillStyle=layout==="quote"?BR.muted:BR.second;sb.lines.forEach((l,i)=>ctx.fillText(l,pad,y+i*sb.px*1.25));y+=(sb.lines.length-1)*sb.px*1.25}
  y+=56;
  // footer first (payoff, CTA, logo) anchored to bottom
  const pf=fitLines(ctx,s.payoff,inner-20,500,36,28,3,0);const ctaY=bottom-66;const pfY=ctaY-28-(pf.lines.length-1)*pf.px*1.3;
  ctx.fillStyle=BR.ink;pf.lines.forEach((l,i)=>ctx.fillText(l,pad,pfY+i*pf.px*1.3));
  pill(ctx,"See how Yoke works",pad,ctaY,28,BR.ink,BR.ground);drawLogo(ctx,W-pad-170,ctaY+8,170);
  const cardBottom=pfY-pf.px-40;
  if(layout==="card"&&s.card&&(s.card.rows||[]).length){
    const rows=(s.card.rows||[]).slice(0,4);const rowH=Math.min(96,Math.max(62,(cardBottom-y-170)/rows.length));
    const ch=(s.card.label?44:0)+(s.card.title?58:0)+rows.length*rowH+56;const cy=Math.max(y,Math.min(cardBottom-ch,y+(cardBottom-y-ch)/2));
    rr(ctx,pad,cy,inner,ch,28,BR.paper,BR.stone,3);let yy=cy+48;
    if(s.card.label){font(ctx,700,22,22*0.06);ctx.fillStyle=BR.muted;ctx.fillText(String(s.card.label).toUpperCase(),pad+40,yy);yy+=44}
    if(s.card.title){font(ctx,700,36,-0.3);ctx.fillStyle=BR.ink;ctx.fillText(s.card.title,pad+40,yy+6);yy+=58}
    rows.forEach((r,i)=>{const ry=yy+i*rowH;ctx.strokeStyle=BR.panel;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(pad+40,ry-rowH*0.55);ctx.lineTo(pad+inner-40,ry-rowH*0.55);ctx.stroke();
      font(ctx,r.tone==="strike"?500:550,30,0);ctx.fillStyle=r.tone==="muted"||r.tone==="strike"?BR.muted:BR.ink;const tx=String(r.text).slice(0,60);ctx.fillText(tx,pad+40,ry+4);
      if(r.tone==="strike"){const w=ctx.measureText(tx).width;ctx.fillRect(pad+40,ry-6,w,3)}
      if(r.chip){const bg=r.tone==="live"?BR.lime:r.tone==="hot"?BR.coralTint:BR.panel;const fg=r.tone==="hot"?BR.coral:BR.ink;pill(ctx,String(r.chip).slice(0,24),pad+inner-40,ry-26,22,bg,fg,true)}});
  }
}
function easeOut(x){x=Math.max(0,Math.min(1,x));return 1-Math.pow(1-x,3)}
function drawMotionFrame(ctx,W,H,s,t,beats,total){
  ctx.fillStyle=BR.ground;ctx.fillRect(0,0,W,H);const pad=80,inner=W-pad*2;const top=H>1500?300:120;
  let acc=0;for(let i=0;i<beats.length;i++){const b=beats[i];const t0=acc;acc+=b.dur;if(t<t0||t>=acc)continue;const lt=t-t0;
    const ink=b.accent?BR.coral:BR.ink;const big=fitLines(ctx,b.text,inner,700,H>1500?104:84,56,5,-0.04);
    const words=big.lines;const lh=big.px*1.04;const y0=Math.round(H>1500?Math.max(top+big.px,760-(words.length*lh)/2):H*0.42-(words.length*lh)/2);
    words.forEach((ln,k)=>{const p=easeOut((lt-0.08*k)/0.45);ctx.globalAlpha=p;font(ctx,700,big.px,-0.04*big.px);ctx.fillStyle=ink;ctx.fillText(ln,pad+(1-p)*30,y0+k*lh)});ctx.globalAlpha=1;
    if(b.sub){const p=easeOut((lt-0.6)/0.4);ctx.globalAlpha=p;const sb=fitLines(ctx,b.sub,inner,500,44,30,3,0);ctx.fillStyle=BR.second;sb.lines.forEach((l,k)=>ctx.fillText(l,pad,y0+words.length*lh+30+k*sb.px*1.25+(1-p)*16));ctx.globalAlpha=1}
    // beat counter dots
    for(let d=0;d<beats.length;d++){ctx.fillStyle=d<=i?BR.ink:BR.stone;ctx.beginPath();ctx.arc(pad+d*26+8,top-60,7,0,7);ctx.fill()}
    return}
  const lt=t-acc;const p=easeOut(lt/0.5);ctx.globalAlpha=p;const ly=H>1500?620:Math.round(H*0.22);drawLogo(ctx,pad,ly,460);
  const el=fitLines(ctx,s.endLine,inner,700,H>1500?96:80,56,4,-0.04);el.lines.forEach((l,k)=>{const q=easeOut((lt-0.25-0.08*k)/0.45);ctx.globalAlpha=q;font(ctx,700,el.px,-0.04*el.px);ctx.fillStyle=BR.ink;ctx.fillText(l,pad+(1-q)*26,ly+200+el.px+k*el.px*1.04)});
  const q=easeOut((lt-0.9)/0.4);ctx.globalAlpha=q;pill(ctx,"See how Yoke works",pad,ly+200+el.px*(el.lines.length)*1.04+50,38,BR.ink,BR.ground);ctx.globalAlpha=1;
}

export async function renderStatic(s){
  await fontsReady();const fmt=DIMS[s.format]?s.format:"feed45";const[W,H]=DIMS[fmt];
  const c=document.createElement("canvas");c.width=W;c.height=H;drawStatic(c.getContext("2d"),W,H,s);
  const blob=await new Promise(r=>c.toBlob(r,"image/png"));return{blob,W,H,fmt,dur:null,poster:null};
}
export async function renderMotion(s,progress){
  const fmt=DIMS[s.format]?s.format:"vertical";const[W,H]=DIMS[fmt];await fontsReady();
  const beats=(s.beats||[]).slice(0,5).map(b=>({...b,dur:Math.min(3.2,Math.max(1.4,Number(b.dur)||2.2))}));
  if(beats.length<1)throw new Error("Motion needs at least one beat");
  const END=2.6;const total=beats.reduce((t,b)=>t+b.dur,0)+END;
  const c=document.createElement("canvas");c.width=W;c.height=H;const ctx=c.getContext("2d");
  if(!c.captureStream||typeof MediaRecorder==="undefined")throw new Error("This browser can't record video");
  const types=["video/mp4;codecs=avc1.640028","video/mp4;codecs=avc1.42E01E","video/mp4","video/webm;codecs=vp9","video/webm"];const mime=types.find(t=>MediaRecorder.isTypeSupported(t));
  if(!mime)throw new Error("No supported video format in this browser");
  drawMotionFrame(ctx,W,H,s,0,beats,total);
  const stream=c.captureStream(30);const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6e6});const chunks=[];rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
  const done=new Promise(r=>rec.onstop=r);rec.start(250);const t0=performance.now();
  await new Promise(res=>{const tick=()=>{const t=(performance.now()-t0)/1000;drawMotionFrame(ctx,W,H,s,Math.min(t,total-0.01),beats,total);
      progress&&progress(`Recording motion · ${Math.min(total,t).toFixed(0)} of ${total.toFixed(0)} s · keep this tab open`);
      if(t>=total){res();return}requestAnimationFrame(tick)};requestAnimationFrame(tick)});
  rec.stop();await done;stream.getTracks().forEach(x=>x.stop());
  const blob=new Blob(chunks,{type:mime.split(";")[0]});
  const pc=document.createElement("canvas");pc.width=W;pc.height=H;drawMotionFrame(pc.getContext("2d"),W,H,s,Math.min(1.2,beats[0].dur-0.1),beats,total);
  const poster=await new Promise(r=>pc.toBlob(r,"image/jpeg",0.88));
  return{blob,W,H,fmt,dur:Math.round(total*10)/10,poster,beats};
}
