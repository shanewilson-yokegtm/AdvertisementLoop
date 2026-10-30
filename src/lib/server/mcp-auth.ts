// Account-based Claude connector: verifies Supabase OAuth 2.1 access tokens for the Ad Studio MCP endpoint.
// No shared secrets: tokens are checked against the project's published signing keys (ES256/RS256 JWKS).
import { createRemoteJWKSet, jwtVerify, errors, type JWTVerifyGetKey } from 'jose';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Actor } from './api';

export type McpAuthConfig = {
  issuer: string;          // https://<ref>.supabase.co/auth/v1
  resource: string;        // https://<app>/api/mcp (RFC 8707 resource; the only accepted audience)
  clientIds: string[];     // registered connector client(s); empty = connector switched off
  metadataUrl: string;     // RFC 9728 protected resource metadata for this endpoint
};

export class McpAuthError extends Error {
  constructor(public status: 401 | 403 | 503, public code: 'invalid_request' | 'invalid_token' | 'insufficient_scope' | 'not_configured', msg: string) { super(msg); }
}

/** Configuration from the environment. Returns null (connector off) unless every part is set. */
export function mcpConfig(env: Record<string, string | undefined> = process.env, origin?: string): McpAuthConfig | null {
  const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const app = (env.APP_URL || origin || '').replace(/\/+$/, '');
  const clientIds = (env.MCP_OAUTH_CLIENT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!supabaseUrl || !app || !clientIds.length || env.MCP_CONNECTOR_ENABLED !== 'true') return null;
  return { issuer: `${supabaseUrl}/auth/v1`, resource: `${app}/api/mcp`, clientIds, metadataUrl: `${app}/.well-known/oauth-protected-resource/api/mcp` };
}

const jwksCache = new Map<string, JWTVerifyGetKey>();
const jwksFor = (issuer: string) => {
  let k = jwksCache.get(issuer);
  if (!k) { k = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { cooldownDuration: 30_000, cacheMaxAge: 600_000 }); jwksCache.set(issuer, k); }
  return k;
};

export type VerifiedToken = { sub: string; clientId: string; exp: number; token: string; sessionId: string | null };

/** Verify a bearer token for this resource. Throws McpAuthError; never returns a partially trusted token. */
export async function verifyMcpToken(header: string | null, cfg: McpAuthConfig, keys: JWTVerifyGetKey = jwksFor(cfg.issuer)): Promise<VerifiedToken> {
  const m = /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)\s*$/.exec(header || '');
  if (!m) throw new McpAuthError(401, 'invalid_request', 'Sign in with the Ad Studio connector');
  try {
    const { payload } = await jwtVerify(m[1], keys, {
      issuer: cfg.issuer, audience: cfg.resource, algorithms: ['ES256', 'RS256'],
      requiredClaims: ['sub', 'exp', 'iat', 'client_id'], clockTolerance: 30,
    });
    const clientId = String(payload.client_id || '');
    if (!cfg.clientIds.includes(clientId)) throw new McpAuthError(401, 'invalid_token', 'This OAuth client is not the Ad Studio connector');
    if (payload.role !== 'authenticated') throw new McpAuthError(401, 'invalid_token', 'Token is not a signed-in user token');
    if (typeof payload.sub !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.sub)) throw new McpAuthError(401, 'invalid_token', 'Token has no user');
    return { sub: payload.sub, clientId, exp: Number(payload.exp), token: m[1], sessionId: typeof payload.session_id === 'string' ? payload.session_id : null };
  } catch (e) {
    if (e instanceof McpAuthError) throw e;
    if (e instanceof errors.JWTExpired) throw new McpAuthError(401, 'invalid_token', 'Token expired');
    if (e instanceof errors.JWTClaimValidationFailed) throw new McpAuthError(401, 'invalid_token', `Token not issued for this server (${e.claim})`);
    throw new McpAuthError(401, 'invalid_token', 'Token could not be verified');
  }
}

/** Refuse tokens whose session was revoked (Disconnect, sign-out, user removed). Tokens without a session id are refused. */
export async function requireLiveSession(db: SupabaseClient, t: VerifiedToken) {
  if (!t.sessionId) throw new McpAuthError(401, 'invalid_token', 'Token has no session');
  const { data, error } = await db.rpc('mcp_session_active', { p_session: t.sessionId });
  if (error) throw new McpAuthError(503, 'not_configured', 'Could not check the connection');
  if (data !== true) throw new McpAuthError(401, 'invalid_token', 'This connection was disconnected. Connect again from Claude.');
}

/** The member behind a verified token, with their current role. Removed members and viewers-without-rows get nothing. */
export async function mcpActor(db: SupabaseClient, sub: string): Promise<Actor> {
  const { data, error } = await db.from('members').select('user_id, email, display_name, role').eq('user_id', sub).maybeSingle();
  if (error) throw new McpAuthError(503, 'not_configured', 'Could not check membership');
  if (!data || !['viewer', 'creator', 'approver', 'admin'].includes((data as any).role)) throw new McpAuthError(403, 'insufficient_scope', 'Not a Yoke Ad Studio member. Ask Shane to add you.');
  return data as Actor;
}

/** RFC 6750 / RFC 9728 challenge so MCP clients can discover how to sign in. */
export function challenge(cfg: McpAuthConfig, err?: McpAuthError) {
  const parts = [`resource_metadata="${cfg.metadataUrl}"`];
  if (err && err.code !== 'invalid_request') parts.push(`error="${err.code}"`, `error_description="${err.message.replace(/"/g, "'")}"`);
  return `Bearer ${parts.join(', ')}`;
}

/** RFC 9728 protected resource metadata. Authorization is Supabase Auth's OAuth 2.1 server. */
export function resourceMetadata(cfg: McpAuthConfig, appUrl: string) {
  return {
    resource: cfg.resource,
    authorization_servers: [cfg.issuer],
    bearer_methods_supported: ['header'],
    resource_name: 'Yoke Ad Studio',
    resource_documentation: `${appUrl.replace(/\/+$/, '')}/connect`,
  };
}
