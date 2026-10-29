'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useState, useCallback } from 'react';
import { useMember, type Member } from '@/lib/data';
import { sb } from '@/lib/supabase/browser';
import Feedback from './Feedback';

const Ctx = createContext<{ member: Member | null; loading: boolean; toast: (s: string) => void }>({ member: null, loading: true, toast: () => {} });
export const useApp = () => useContext(Ctx);

const Logo = () => (
  <svg viewBox="5 7 174 102" aria-hidden="true"><path d="M16 18C16 52 36 58 96 58C156 58 160 64 160 98" stroke="#F04B37" fill="none" strokeWidth="22" strokeLinecap="round" /><path d="M168 18C168 52 148 58 96 58C44 58 28 64 28 98" stroke="currentColor" fill="none" strokeWidth="22" strokeLinecap="round" /></svg>
);

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || '/';
  const { member, loading, email } = useMember();
  const [msg, setMsg] = useState<string | null>(null);
  const toast = useCallback((s: string) => { setMsg(s); setTimeout(() => setMsg(null), 3200); }, []);
  if (path.startsWith('/login') || path.startsWith('/auth')) return <>{children}</>;
  const lib = path === '/' || path.startsWith('/a/');
  return (
    <Ctx.Provider value={{ member, loading, toast }}>
      <header className="top"><div className="wrap bar">
        <Link className="brand" href="/"><Logo />Ad Studio</Link>
        <nav className="main" aria-label="Main">
          <Link href="/" aria-current={lib ? 'page' : undefined}>Library</Link>
          <Link href="/create" aria-current={path.startsWith('/create') ? 'page' : undefined}>Create an ad</Link>
        </nav>
        <div className="me">
          <span className="nm">{member ? member.display_name : loading ? '' : email || ''}</span>
          {member ? <span className="chip">{member.role === 'admin' || member.role === 'approver' ? 'Approver' : member.role === 'creator' ? 'Creator' : 'Viewer'}</span> : null}
          <button className="btn small" onClick={async () => { await sb().auth.signOut(); location.href = '/login'; }}>Sign out</button>
        </div>
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
