// RFC 9728 protected resource metadata for the Claude connector. Served at both
// /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp.
import { NextResponse } from 'next/server';
import { mcpConfig, resourceMetadata } from '@/lib/server/mcp-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const cfg = mcpConfig(process.env, origin);
  if (!cfg) return NextResponse.json({ error: 'connector_not_enabled' }, { status: 404 });
  return NextResponse.json(resourceMetadata(cfg, process.env.APP_URL || origin), { headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } });
}
