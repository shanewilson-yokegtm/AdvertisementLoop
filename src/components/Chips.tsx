import type { Version } from '@/lib/data';

export function statusChip(st: string) {
  return st === 'approved' ? <span className="chip ok">Approved</span> : st === 'changes' ? <span className="chip err">Changes requested</span> : <span className="chip warn">Needs review</span>;
}
export function renderChip(v: Version) {
  const r = v.render || {}; if (r.state === 'pending') return <span className="chip warn">{r.label || 'Pending'}</span>;
  if (r.state === 'rendering') return <span className="chip live">Rendering</span>; return null;
}

