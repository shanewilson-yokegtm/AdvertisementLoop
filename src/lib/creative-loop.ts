// Shared rules for links, review readiness and conversation rollover.
export const CHAT_MESSAGE_LIMIT = 60;
export const CHAT_LIMIT_MESSAGE = 'This chat has reached its limit. Start a new chat to continue. Your conversation and Library versions are saved.';

export function assetVersionPath(assetId: string, versionId: string) {
  return `/a/${encodeURIComponent(assetId)}?v=${encodeURIComponent(versionId)}`;
}

export function approvalBlock(v: { file_path: string | null; render: Record<string, any>; qa: any[] }) {
  if (!v.file_path?.trim() || v.render?.state !== 'ready') return 'The media must finish saving before this version can be approved.';
  if ((v.qa || []).some(q => q.status === 'fail')) return 'Fix failed checks before approving this version.';
  return null;
}
