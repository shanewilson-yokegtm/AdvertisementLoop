'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Consent } from '@/components/Consent';

function Page() { const p = useSearchParams(); return <Consent authorizationId={p.get('authorization_id')} />; }
export default function ConsentPage() { return <Suspense fallback={<div className="empty">Loading</div>}><Page /></Suspense>; }
