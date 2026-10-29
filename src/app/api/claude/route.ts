import { NextResponse } from 'next/server';
import { currentMember, serviceClient } from '@/lib/supabase/server';
import { systemPrompt, STATIC_TOOL, MOTION_TOOL } from '@/lib/server/prompt';
import { CHAT_LIMIT_MESSAGE, CHAT_MESSAGE_LIMIT } from '@/lib/creative-loop';

// One round of the Create-an-ad conversation. History comes from the database (not the browser).
// Tool calls are executed in the browser (rendering + saving to the Library) and come back as `turn`.
// When Claude finishes, the server writes the assistant message (users cannot write those).
export async function POST(req: Request) {
  try {
  const m = await currentMember();
  if (!m || !['creator', 'approver', 'admin'].includes(m.role)) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: 'claude_not_enabled' }, { status: 503 });
  const { chatId, type, turn = [], assetRefs = [], blocked = null, replyTo = null } = await req.json();
  if (!['static', 'motion', 'higgsfield'].includes(type)) return NextResponse.json({ error: 'Bad type' }, { status: 400 });
  const s = m.client;
  const { data: chat } = await s.from('chats').select('*').eq('id', chatId).maybeSingle();
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
  let requestedAt: string | null = null;
  if (replyTo) {
    const { data: request } = await s.from('chat_messages').select('at').eq('id', replyTo).eq('chat_id', chatId).eq('role', 'user').maybeSingle();
    if (!request) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    requestedAt = request.at;
    const { data: existing, error } = await s.from('chat_messages').select('body').eq('reply_to', replyTo).eq('chat_id', chatId).eq('role', 'assistant').maybeSingle();
    if (error) throw error;
    if (existing) return NextResponse.json({ stop: 'end_turn', text: existing.body });
  }
  let historyQuery = s.from('chat_messages').select('role,body,author,create_type,asset_refs,error').eq('chat_id', chatId).order('at', { ascending: true }).order('id', { ascending: true });
  if (requestedAt) historyQuery = historyQuery.lte('at', requestedAt);
  const [{ data: msgs }, { data: members }, { data: pack }] = await Promise.all([
    historyQuery.limit(CHAT_MESSAGE_LIMIT + 1).throwOnError(),
    s.from('members').select('user_id,display_name'), s.from('brand_pack').select('pack').maybeSingle()]);
  if ((msgs || []).length > CHAT_MESSAGE_LIMIT) return NextResponse.json({ error: 'chat_limit_reached', message: CHAT_LIMIT_MESSAGE }, { status: 409 });
  const nm = Object.fromEntries((members || []).map((x: any) => [x.user_id, x.display_name]));
  let ctx = '';
  if (chat.asset_id) {
    const { data: v } = await s.from('versions').select('version,copy,spec,source').eq('asset_id', chat.asset_id).order('version', { ascending: false }).limit(1).maybeSingle();
    const { data: a } = await s.from('assets').select('concept_name,kind,format').eq('id', chat.asset_id).maybeSingle();
    const { data: cs } = await s.from('comments').select('body,status,author,legacy_author').eq('asset_id', chat.asset_id).eq('status', 'open').order('created_at', { ascending: false }).limit(15);
    if (a && v) ctx = `\n\nITERATING ON LIBRARY ASSET "${a.concept_name}" (${a.kind}, ${a.format}, latest v${v.version}).\nCopy: ${JSON.stringify(v.copy)}\n${v.spec ? 'Design spec: ' + JSON.stringify(v.spec).slice(0, 3000) : 'Made in ' + (v.source?.tool || 'another tool') + ': ' + (v.source?.prompt || '')}\nFeedback:\n${(cs || []).map((c: any) => `- ${nm[c.author] || c.legacy_author || 'Teammate'} (${c.status}): ${c.body}`).join('\n') || '(none yet)'}\nYour version is saved as v${v.version + 1}.`;
  }
  const history: any[] = [];
  for (const x of msgs || []) {
    if (!x.body?.trim() || x.error) continue;
    const role = x.role === 'user' ? 'user' : 'assistant';
    const text = role === 'user' ? `${nm[x.author] || 'Teammate'}${x.create_type ? ` [${x.create_type}]` : ''}: ${x.body}` : x.body;
    if (history.length && history[history.length - 1].role === role) history[history.length - 1].content += '\n\n' + text; else history.push({ role, content: text });
  }
  while (history.length && history[0].role !== 'user') history.shift();
  if (!history.length) return NextResponse.json({ error: 'Send a message first' }, { status: 400 });
  const messages = [...history, ...turn];
  const tools = type === 'static' ? [STATIC_TOOL] : type === 'motion' ? [MOTION_TOOL] : [];
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(90_000), headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 1500, system: systemPrompt(pack?.pack, type, ctx), messages, ...(tools.length ? { tools } : {}) }),
  });
  const j = await r.json();
  if (!r.ok) return NextResponse.json({ error: `Claude API: ${j?.error?.message || r.status}` }, { status: 502 });
  if (j.stop_reason === 'tool_use') return NextResponse.json({ stop: 'tool_use', content: j.content });
  const text = (j.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  // keep only refs to versions that really exist
  const refs = Array.isArray(assetRefs) ? assetRefs.slice(0, 6) : [];
  const ids = refs.map((x: any) => x.version_id).filter(Boolean);
  const { data: real } = ids.length ? await s.from('versions').select('id,asset_id').in('id', ids) : { data: [] as any[] };
  const ok = (real || []).map((x: any) => ({ asset_id: x.asset_id, version_id: x.id }));
  const { error } = await serviceClient().from('chat_messages').insert({ chat_id: chatId, role: 'assistant', body: text, create_type: type, asset_refs: ok, author: m.user_id, blocked, reply_to: replyTo });
  if (error?.code === '23505' && replyTo) {
    const { data: existing } = await s.from('chat_messages').select('body').eq('reply_to', replyTo).eq('chat_id', chatId).eq('role', 'assistant').maybeSingle();
    if (existing) return NextResponse.json({ stop: 'end_turn', text: existing.body });
  }
  if (error) return NextResponse.json({ error: 'Reply not saved: ' + error.message }, { status: 500 });
  return NextResponse.json({ stop: 'end_turn', text });
  } catch (e: any) {
    return NextResponse.json({ error: e.name === 'TimeoutError' ? 'Claude timed out. Your message is saved; please retry.' : 'Claude could not complete the request. Your message is saved; please retry.' }, { status: 502 });
  }
}
