'use client';
import { useEffect, useRef } from 'react';
import { isVideo, fmtSec, type Version } from '@/lib/data';

export function Thumb({ v, urls }: { v: Version; urls: Record<string, string> }) {
  if (!v.file_path) return <div className="pendingbox"><b>{v.render?.label || 'Pending'}</b></div>;
  if (isVideo(v)) return <>
    {v.poster_path && urls[v.poster_path] ? <img src={urls[v.poster_path]} alt="" loading="lazy" /> : urls[v.file_path] ? <video src={urls[v.file_path]} preload="metadata" muted playsInline /> : null}
    <span className="play" aria-hidden="true" /><span className="dur">{fmtSec(v.duration_sec)}</span>
  </>;
  return urls[v.file_path] ? <img src={urls[v.file_path]} alt="" loading="lazy" /> : null;
}

export function Player({ v, urls }: { v: Version; urls: Record<string, string> }) {
  if (!v.file_path) return <div className="pendingbox" style={{ minHeight: 320 }}><b>{v.render?.label || 'Pending'}</b><span>{v.render?.note || ''}</span>
    {v.spec?.brief ? <details><summary>Brief</summary><div style={{ whiteSpace: 'pre-wrap', textAlign: 'left' }}>{v.spec.brief}</div></details> : null}</div>;
  const src = urls[v.file_path]; if (!src) return <div className="pendingbox" style={{ minHeight: 320 }}>Loading</div>;
  if (isVideo(v)) return <VideoPlayer key={v.id} src={src} poster={v.poster_path ? urls[v.poster_path] : undefined} />;
  return <img src={src} alt={`version ${v.version}`} />;
}

function VideoPlayer({ src, poster }: { src: string; poster?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current; if (!video) return;
    // Renewing access to the same immutable version must preserve the playhead.
    const time = video.currentTime; const resume = !video.paused;
    const restore = () => {
      if (time > 0) video.currentTime = Number.isFinite(video.duration) ? Math.min(time, video.duration) : time;
      if (resume) void video.play().catch(() => {});
    };
    video.addEventListener('loadedmetadata', restore, { once: true });
    video.src = src; video.load();
    return () => video.removeEventListener('loadedmetadata', restore);
  }, [src]);
  return <video ref={ref} id="pv" controls playsInline preload="metadata" poster={poster} />;
}
