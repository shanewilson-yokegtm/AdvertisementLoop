'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useMember, useInbox, type Member } from '@/lib/data';
import { sb } from '@/lib/supabase/browser';
import Feedback from './Feedback';

const Ctx = createContext<{ member: Member | null; loading: boolean; toast: (s: string) => void }>({ member: null, loading: true, toast: () => {} });
export const useApp = () => useContext(Ctx);

const Logo = () => (
  <svg viewBox="5 7 174 102" aria-hidden="true"><path d="M16 18C16 52 36 58 96 58C156 58 160 64 160 98" stroke="#F04B37" fill="none" strokeWidth="22" strokeLinecap="round" /><path d="M168 18C168 52 148 58 96 58C44 58 28 64 28 98" stroke="currentColor" fill="none" strokeWidth="22" strokeLinecap="round" /></svg>
);

export const roleLabel = (r?: Member['role']) => (r === 'admin' ? 'Admin' : r === 'approver' ? 'Approver' : r === 'creator' ? 'Creator' : 'Viewer');
const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

/** Account menu: who you are, your role, Connect Claude and Sign out. Closes on Escape or outside click. */
export function AccountMenu({ member, email }: { member: Member | null; email: string | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null); const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    (box.current?.querySelector('.menu .mi') as HTMLElement | null)?.focus();
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const name = member?.display_name || email || '';
  if (!name) return null;
  return <div className="acct" ref={box} onKeyDown={e => { if (e.key === 'Escape' && open) { setOpen(false); btn.current?.focus(); } }}>
    <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Account: ${name}`} onClick={() => setOpen(o => !o)}>
      <span className="avatar" aria-hidden="true">{initials(name)}</span><span className="nm">{name}</span></button>
    {open ? <div className="menu" role="menu" aria-label="Account">
      <div className="mhead"><b>{name}</b><span className="muted small">{member?.email || email}</span>{member ? <span className="muted small">{roleLabel(member.role)}</span> : null}</div>
      <Link role="menuitem" className="mi" href="/connect" onClick={() => setOpen(false)}>Connect Claude<span className="muted">Skill token</span></Link>
      <hr />
      <button role="menuitem" type="button" className="mi" onClick={async () => { await sb().auth.signOut(); location.href = '/login'; }}>Sign out</button>
    </div> : null}
  </div>;
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || '/';
  const { member, loading, email } = useMember();
  const [msg, setMsg] = useState<string | null>(null);
  const toast = useCallback((s: string) => { setMsg(s); setTimeout(() => setMsg(null), 3200); }, []);
  const inbox = useInbox('mine', !!member);
  if (path.startsWith('/login') || path.startsWith('/auth')) return <>{children}</>;
  const lib = path === '/' || path.startsWith('/a/');
  return (
    <Ctx.Provider value={{ member, loading, toast }}>
      <header className="top"><div className="wrap bar">
        <Link className="brand" href="/" aria-label="Yoke Ad Studio"><Logo /><span className="bt">Ad Studio</span></Link>
        <nav className="main" aria-label="Main">
          <Link href="/" aria-current={lib ? 'page' : undefined}>Library{inbox.rows.length ? <span className="navcount" aria-label={`, ${inbox.rows.length} with feedback for you`}>{inbox.rows.length}</span> : null}</Link>
          <Link href="/create" aria-current={path.startsWith('/create') ? 'page' : undefined}>Create an ad</Link>
          <Link href="/campaigns" aria-current={path.startsWith('/campaigns') ? 'page' : undefined}>Campaigns</Link>
        </nav>
        <AccountMenu member={member} email={email} />
      </div></header>
      <main className="wrap">
        {loading ? <div className="empty"><span className="muted">Loading</span></div>
          : !member ? <div className="empty"><h2>No access yet</h2><span className="muted">{email} isn&apos;t a Yoke Ad Studio member. Ask Shane to add you.</span></div>
          : children}
      </main>
      {member ? <Feedback /> : null}
      {msg ? <div className="toast" role="status">{msg}</div> : null}
    </Ctx.Provider>
  );
}
