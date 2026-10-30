import { NextResponse } from 'next/server';
import { currentMember, serviceClient } from '@/lib/supabase/server';
import { ApiError } from '@/lib/server/api';
import { generate, refresh, startHiggsfieldRevision, usage } from '@/lib/server/higgsfield';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const err = (e: any) => e instanceof ApiError ? NextResponse.json({ error: e.code, message: e.message }, { status: e.status })
  : NextResponse.json({ error: 'error', message: String(e?.message || e).slice(0, 300) }, { status: 500 });
const off = () => NextResponse.json({ error: 'higgsfield_not_connected', message: 'Higgsfield is not switched on (HF_CREDENTIALS missing on the server).' }, { status: 503 });

// POST /api/higgsfield/generate   (signed-in creator)  -> one billable Seedance 2.5 request
// POST /api/higgsfield/revise     (owner/admin)        -> one billable render from the frozen approved feedback
// POST /api/higgsfield/webhook?job=  (Higgsfield)      -> only triggers a status check; the body is not trusted
export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params; const creds = process.env.HF_CREDENTIALS;
  if (!creds || !process.env.SUPABASE_SERVICE_ROLE_KEY) return off();
  try {
    if (action === 'webhook') {
      const job = new URL(req.url).searchParams.get('job') || '';
      if (!/^[0-9a-f-]{36}$/.test(job)) return NextResponse.json({ ok: false }, { status: 400 });
      const j = await refresh(serviceClient(), job, creds);
      return NextResponse.json({ ok: true, status: j.status });
    }
    if (action !== 'generate' && action !== 'revise') return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const m = await currentMember();
    if (!m) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
    const b = await req.json().catch(() => ({}));
    if (action === 'revise') {
      // Regenerate a Higgsfield ad from its approved feedback: one paid render, confirmed by the owner/admin in the app.
      if (b?.confirm !== true) return NextResponse.json({ error: 'invalid', message: 'Confirm the paid render first.' }, { status: 400 });
      const r = await startHiggsfieldRevision(serviceClient(), m as any, String(b?.asset_id || ''), b?.note ? String(b.note).slice(0, 2000) : null, creds, process.env.APP_URL || new URL(req.url).origin);
      return NextResponse.json({ processing_id: r.processing_id, asset_id: r.asset_id, version_id: r.version_id, job_id: r.job.id, status: r.job.status, repeated: r.repeated });
    }
    const r = await generate(serviceClient(), m as any, b, creds, process.env.APP_URL || new URL(req.url).origin);
    return NextResponse.json({ asset_id: r.asset_id, version_id: r.version_id, job_id: r.job.id, status: r.job.status, repeated: r.repeated });
  } catch (e) { return err(e); }
}

// GET /api/higgsfield/status?job=   (members) -> checks Higgsfield once and finishes the version when ready
// GET /api/higgsfield/usage          (members) -> seconds generated this month
export async function GET(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params; const creds = process.env.HF_CREDENTIALS;
  const m = await currentMember();
  if (!m) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
  if (!creds || !process.env.SUPABASE_SERVICE_ROLE_KEY) return off();
  try {
    if (action === 'usage') return NextResponse.json(await usage(serviceClient()));
    if (action === 'status') {
      const job = new URL(req.url).searchParams.get('job') || '';
      if (!/^[0-9a-f-]{36}$/.test(job)) return NextResponse.json({ error: 'invalid' }, { status: 400 });
      const j = await refresh(serviceClient(), job, creds);
      return NextResponse.json({ status: j.status, error: j.error, version_id: j.version_id });
    }
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  } catch (e) { return err(e); }
}
