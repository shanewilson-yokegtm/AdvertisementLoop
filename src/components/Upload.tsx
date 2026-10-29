'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveVersion, FORMATS, type Asset } from '@/lib/data';
import { useApp } from './Shell';

function detectFormat(w: number, h: number) { for (const [k, f] of Object.entries(FORMATS)) if (Math.abs(w / h - f.w / f.h) < 0.012) return k; return 'other'; }
async function meta(file: File): Promise<{ w: number; h: number; d: number | null }> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith('video/')) return await new Promise((res, rej) => { const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.onloadedmetadata = () => res({ w: v.videoWidth, h: v.videoHeight, d: Math.round(v.duration * 10) / 10 }); v.onerror = () => rej(new Error('Unreadable video')); v.src = url; });
    return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight, d: null }); i.onerror = () => rej(new Error('Unreadable image')); i.src = url; });
  } finally { URL.revokeObjectURL(url); }
}
async function posterOf(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try { return await new Promise(res => { const v = document.createElement('video'); v.muted = true; v.src = url; v.onloadedmetadata = () => { v.currentTime = Math.min(1.2, v.duration / 2); };
    v.onseeked = () => { const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d')!.drawImage(v, 0, 0); c.toBlob(b => res(b), 'image/jpeg', 0.88); }; v.onerror = () => res(null); }); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

const TOOLS = ['Claude Design', 'Claude Design Motion', 'Higgsfield', 'Other'];
export default function Upload({ asset, onClose }: { asset?: Asset; onClose: () => void }) {
  const { toast } = useApp(); const router = useRouter();
  const [file, setFile] = useState<File | null>(null); const [name, setName] = useState(''); const [tool, setTool] = useState(TOOLS[0]);
  const [link, setLink] = useState(''); const [note, setNote] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  return <div className="modal" role="dialog" aria-modal="true" aria-labelledby="upT">
    <form className="box" onSubmit={async e => {
      e.preventDefault(); if (!file) return; setBusy(true); setMsg('Reading file');
      try {
        const m = await meta(file); const fmt = detectFormat(m.w, m.h);
        const video = file.type.startsWith('video/');
        setMsg('Uploading');
        const r = await saveVersion({
          assetId: asset?.id, newAsset: asset ? undefined : { concept_name: name.trim() || file.name, kind: video ? (tool === 'Higgsfield' ? 'video' : 'motion') : 'static', format: fmt },
          file, poster: video ? await posterOf(file) : null, width: m.w, height: m.h, duration: m.d,
          source: { tool, link: link.trim() || null }, revisionNote: note.trim() || null, render: { state: 'ready', kind: 'upload' },
        });
        toast(`Saved v${r.version}`); onClose(); router.push(`/a/${r.assetId}`);
      } catch (err: any) { setMsg(err.message || 'Upload failed'); setBusy(false); }
    }}>
      <div className="head" style={{ margin: 0 }}><h2 id="upT">{asset ? `New version · ${asset.concept_name}` : 'Upload to Library'}</h2><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
      <label className="f">File (PNG, JPG, MP4, MOV)<input type="file" required accept="image/png,image/jpeg,video/mp4,video/quicktime,video/webm" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
      {asset ? <label className="f">What changed<input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Shorter hook" /></label>
        : <label className="f">Name<input type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="Your best closer is building a list" /></label>}
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="f" style={{ flex: 1 }}>Made with<select value={tool} onChange={e => setTool(e.target.value)}>{TOOLS.map(t => <option key={t}>{t}</option>)}</select></label>
        <label className="f" style={{ flex: 2 }}>Editable source link (optional)<input type="url" value={link} onChange={e => setLink(e.target.value)} placeholder="https://claude.ai/artifact/…" /></label>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><span className="muted" role="status">{msg}</span><button className="btn primary" disabled={busy}>{asset ? 'Add version' : 'Upload'}</button></div>
    </form></div>;
}
