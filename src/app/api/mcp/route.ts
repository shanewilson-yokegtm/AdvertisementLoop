// Remote MCP endpoint for the Claude connector (Streamable HTTP, stateless). Each request carries a Supabase OAuth
// access token issued to the registered Ad Studio connector client for this exact resource. Off unless configured.
import { NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { serviceClient } from '@/lib/supabase/server';
import { McpAuthError, challenge, mcpActor, mcpConfig, originAllowed, requireLiveSession, verifyMcpToken } from '@/lib/server/mcp-auth';
import { buildMcpServer } from '@/lib/server/mcp-tools';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function serve(req: Request) {
  const origin = new URL(req.url).origin;
  const cfg = mcpConfig(process.env, origin);
  if (!cfg || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'connector_not_enabled', message: 'The Ad Studio Claude connector is not switched on yet.' }, { status: 503 });
  // Origin first (before any token work): browsers may only call from an allowlisted origin. No CORS headers are sent.
  if (!originAllowed(req.headers.get('origin'), cfg)) return NextResponse.json({ error: 'forbidden_origin', message: 'This origin may not call the Ad Studio MCP endpoint.' }, { status: 403 });
  let actor;
  const db = serviceClient();
  try {
    const t = await verifyMcpToken(req.headers.get('authorization'), cfg);
    await requireLiveSession(db, t);
    actor = await mcpActor(db, t.sub);
    const server = buildMcpServer(db, actor, process.env.APP_URL || origin);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const res = await transport.handleRequest(req, { authInfo: { token: t.token, clientId: t.clientId, scopes: [], expiresAt: t.exp, resource: new URL(cfg.resource), extra: { userId: t.sub } } });
    void server.close();
    return res;
  } catch (e) {
    if (e instanceof McpAuthError) {
      const status = e.status === 503 ? 503 : e.status;
      return NextResponse.json({ error: e.code, error_description: e.message }, { status, headers: status === 401 || status === 403 ? { 'WWW-Authenticate': challenge(cfg, e) } : {} });
    }
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
