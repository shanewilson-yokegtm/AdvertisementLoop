#!/usr/bin/env python3
"""Ad Studio API client for the yoke-ad-maker skill. Standard library only.

Reads AD_STUDIO_API (e.g. https://advertisementloop-eight.vercel.app/api/v1) and AD_STUDIO_TOKEN (your personal
yas_... token from Ad Studio > Connect Claude) from the environment. Never prints the token.

  adstudio.py me
  adstudio.py inbox [--all]
  adstudio.py list [--mine]
  adstudio.py get ASSET_ID                       # asset, versions (signed media/source URLs), comments, your review if you own it
  adstudio.py create --name N --kind static|motion|video --format feed45|square|vertical|landscape
  adstudio.py save ASSET_ID --file F [--poster P] [--source S] [--parent VERSION_ID] [--note TEXT] [--meta JSON] [--key KEY] [--review REVIEW_ID]
  adstudio.py save-pending ASSET_ID --note "Higgsfield render pending: ..." [--meta JSON] [--key KEY]
  adstudio.py comment ASSET_ID --version VERSION_ID --text T [--at SECONDS]
  adstudio.py process ASSET_ID                   # start or resume the shared review (no edits)
  adstudio.py propose REVIEW_ID --rev N --json PROPOSAL_JSON
  adstudio.py approve REVIEW_ID --rev N --decisions JSON --instructions TEXT [--worker]
  adstudio.py complete REVIEW_ID --rev N --version NEW_VERSION_ID [--note TEXT]
  adstudio.py status REVIEW_ID --rev N --status failed|cancelled|executing|reviewing [--message TEXT]
  adstudio.py revert ASSET_ID --from VERSION_ID --latest LATEST_VERSION_ID
  adstudio.py channels
  adstudio.py share ASSET_ID --version VERSION_ID --channel CHANNEL_ID [--question TEXT] [--key KEY]
  adstudio.py handoff OUT_DIR --title T --format F --files F1 [F2 ...] [--meta JSON]   # manual-upload bundle, no network

Exit code 0 on success; on failure prints {"error":..., "message":...} and exits 1. Nothing is reported as saved unless
the API returned it.
"""
import argparse, hashlib, json, mimetypes, os, struct, sys, urllib.error, urllib.request, uuid, zipfile

TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
         '.webm': 'video/webm', '.svg': 'image/svg+xml', '.html': 'text/html', '.json': 'application/json', '.zip': 'application/zip', '.txt': 'text/plain'}


def sniff(path):
    """Real content type from the file's bytes (so a WebM is never sent as MP4)."""
    with open(path, 'rb') as f:
        head = f.read(64)
    if head.startswith(b'\x89PNG'): return 'image/png'
    if head[:3] == b'\xff\xd8\xff': return 'image/jpeg'
    if head[:4] == b'RIFF' and head[8:12] == b'WEBP': return 'image/webp'
    if head[:4] == b'\x1a\x45\xdf\xa3': return 'video/webm'
    if head[4:8] == b'ftyp': return 'video/quicktime' if head[8:10] == b'qt' else 'video/mp4'
    if head[:2] == b'PK': return 'application/zip'
    ext = os.path.splitext(path)[1].lower()
    return TYPES.get(ext) or mimetypes.guess_type(path)[0] or 'application/octet-stream'


def image_size(path):
    with open(path, 'rb') as f:
        b = f.read(32)
    if b.startswith(b'\x89PNG'): return struct.unpack('>II', b[16:24])
    return None


def api(method, route, body=None):
    base, tok = os.environ.get('AD_STUDIO_API', '').rstrip('/'), os.environ.get('AD_STUDIO_TOKEN', '')
    if not base or not tok:
        fail('not_configured', 'Set AD_STUDIO_API and AD_STUDIO_TOKEN (Ad Studio > Connect Claude). Without them, use: adstudio.py handoff')
    req = urllib.request.Request(f'{base}/{route}', method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'authorization': f'Bearer {tok}', 'content-type': 'application/json', 'accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try: err = json.loads(e.read())
        except Exception: err = {'error': str(e.code)}
        fail(err.get('error', str(e.code)), err.get('message', ''), e.code)
    except urllib.error.URLError as e:
        fail('network', f'Could not reach Ad Studio ({e.reason}). If this Claude cannot reach the internet, use: adstudio.py handoff')


def fail(code, message='', status=None):
    print(json.dumps({'error': code, 'message': message, 'status': status}))
    sys.exit(1)


def put_bytes(url, path, ctype):
    with open(path, 'rb') as f:
        data = f.read()
    req = urllib.request.Request(url, method='PUT', data=data, headers={'content-type': ctype, 'x-upsert': 'false'})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            if r.status >= 300: fail('upload_failed', f'{path}: HTTP {r.status}')
    except urllib.error.HTTPError as e:
        fail('upload_failed', f'{path}: HTTP {e.code} {e.read()[:200]!r}')
    except urllib.error.URLError as e:
        fail('upload_blocked', f'{path}: {e.reason}. This environment may not reach storage; use: adstudio.py handoff')
    return len(data), hashlib.sha256(data).hexdigest()


def upload(asset, files):
    """files: list of local paths. Returns {local_path: {path, content_type, bytes, sha256}}."""
    specs = [{'name': os.path.basename(p), 'content_type': sniff(p)} for p in files]
    got = api('POST', f'assets/{asset}/uploads', {'files': specs})['uploads']
    out = {}
    for p, u in zip(files, got):
        n, h = put_bytes(u['upload_url'], p, u['content_type'])
        out[p] = {'path': u['path'], 'content_type': u['content_type'], 'bytes': n, 'sha256': h}
    return out


def main():
    ap = argparse.ArgumentParser(description='Ad Studio API client')
    sp = ap.add_subparsers(dest='cmd', required=True)
    sp.add_parser('me'); sp.add_parser('channels')
    x = sp.add_parser('inbox'); x.add_argument('--all', action='store_true')
    x = sp.add_parser('list'); x.add_argument('--mine', action='store_true')
    x = sp.add_parser('get'); x.add_argument('asset')
    x = sp.add_parser('create'); x.add_argument('--name', required=True); x.add_argument('--kind', required=True); x.add_argument('--format', required=True)
    x = sp.add_parser('save'); x.add_argument('asset'); x.add_argument('--file', required=True); x.add_argument('--poster'); x.add_argument('--source')
    x.add_argument('--parent'); x.add_argument('--note'); x.add_argument('--meta', default='{}'); x.add_argument('--key'); x.add_argument('--review')
    x = sp.add_parser('save-pending'); x.add_argument('asset'); x.add_argument('--note', required=True); x.add_argument('--meta', default='{}'); x.add_argument('--key')
    x = sp.add_parser('comment'); x.add_argument('asset'); x.add_argument('--version', required=True); x.add_argument('--text', required=True); x.add_argument('--at', type=float)
    x = sp.add_parser('process'); x.add_argument('asset')
    x = sp.add_parser('propose'); x.add_argument('review'); x.add_argument('--rev', type=int, required=True); x.add_argument('--json', required=True)
    x = sp.add_parser('approve'); x.add_argument('review'); x.add_argument('--rev', type=int, required=True); x.add_argument('--decisions', required=True)
    x.add_argument('--instructions', default=''); x.add_argument('--worker', action='store_true')
    x = sp.add_parser('complete'); x.add_argument('review'); x.add_argument('--rev', type=int, required=True); x.add_argument('--version', required=True); x.add_argument('--note')
    x = sp.add_parser('status'); x.add_argument('review'); x.add_argument('--rev', type=int, required=True); x.add_argument('--status', required=True); x.add_argument('--message')
    x = sp.add_parser('revert'); x.add_argument('asset'); x.add_argument('--from', dest='frm', required=True); x.add_argument('--latest', required=True)
    x = sp.add_parser('share'); x.add_argument('asset'); x.add_argument('--version', required=True); x.add_argument('--channel', required=True); x.add_argument('--question'); x.add_argument('--key')
    x = sp.add_parser('handoff'); x.add_argument('out'); x.add_argument('--title', required=True); x.add_argument('--format', required=True)
    x.add_argument('--files', nargs='+', required=True); x.add_argument('--meta', default='{}')
    a = ap.parse_args()

    if a.cmd == 'me': r = api('GET', 'me')
    elif a.cmd == 'inbox': r = api('GET', 'inbox' + ('?scope=all' if a.all else ''))
    elif a.cmd == 'list': r = api('GET', 'assets' + ('?mine=1' if a.mine else ''))
    elif a.cmd == 'get': r = api('GET', f'assets/{a.asset}')
    elif a.cmd == 'channels': r = api('GET', 'slack/channels')
    elif a.cmd == 'create': r = api('POST', 'assets', {'concept_name': a.name, 'kind': a.kind, 'format': a.format})
    elif a.cmd == 'save':
        meta = json.loads(a.meta)
        files = [f for f in [a.file, a.poster, a.source] if f]
        up = upload(a.asset, files)
        main_f = up[a.file]
        if a.file and not meta.get('width') and image_size(a.file): meta['width'], meta['height'] = image_size(a.file)
        body = {**meta, 'file_path': main_f['path'], 'content_type': main_f['content_type'], 'sha256': main_f['sha256'],
                'poster_path': up[a.poster]['path'] if a.poster else None, 'editable_path': up[a.source]['path'] if a.source else None,
                'parent_version_id': a.parent, 'revision_note': a.note, 'processing_id': a.review,
                'idempotency_key': a.key or f'save-{main_f["sha256"][:24]}-{a.parent or "new"}'}
        r = api('POST', f'assets/{a.asset}/versions', body); r['uploaded'] = up
    elif a.cmd == 'save-pending':
        r = api('POST', f'assets/{a.asset}/versions', {**json.loads(a.meta), 'render_state': 'pending', 'render_note': a.note, 'idempotency_key': a.key or f'pending-{uuid.uuid4()}'})
    elif a.cmd == 'comment': r = api('POST', f'assets/{a.asset}/comments', {'version_id': a.version, 'body': a.text, 'at_sec': a.at})
    elif a.cmd == 'process': r = api('POST', f'assets/{a.asset}/processing', {})
    elif a.cmd == 'propose': r = api('POST', f'processing/{a.review}/proposal', {'rev': a.rev, 'proposal': json.loads(a.json)})
    elif a.cmd == 'approve': r = api('POST', f'processing/{a.review}/approve', {'rev': a.rev, 'decisions': json.loads(a.decisions), 'instructions': a.instructions, 'queue_worker': a.worker})
    elif a.cmd == 'complete': r = api('POST', f'processing/{a.review}/complete', {'rev': a.rev, 'result_version_id': a.version, 'note': a.note})
    elif a.cmd == 'status': r = api('POST', f'processing/{a.review}/status', {'rev': a.rev, 'status': a.status, 'message': a.message})
    elif a.cmd == 'revert': r = api('POST', f'assets/{a.asset}/revert', {'from_version_id': a.frm, 'expected_latest_version_id': a.latest})
    elif a.cmd == 'share': r = api('POST', f'assets/{a.asset}/share', {'version_id': a.version, 'channel_id': a.channel, 'question': a.question, 'idempotency_key': a.key or f'share-{a.version}-{a.channel}'})
    elif a.cmd == 'handoff':
        os.makedirs(a.out, exist_ok=True)
        meta = json.loads(a.meta)
        files = [{'path': os.path.basename(f), 'content_type': sniff(f), 'bytes': os.path.getsize(f),
                  'sha256': hashlib.sha256(open(f, 'rb').read()).hexdigest()} for f in a.files]
        manifest = {'asset_id': meta.get('asset_id'), 'parent_version_id': meta.get('parent_version_id'), 'title': a.title, 'concept': meta.get('concept'),
                    'format': a.format, 'dimensions': meta.get('dimensions'), 'duration_seconds': meta.get('duration_seconds'), 'files': files,
                    'copy': meta.get('copy'), 'product_claims': meta.get('product_claims'), 'generation_provenance': meta.get('generation_provenance'),
                    'change_note': meta.get('change_note'), 'feedback_addressed': meta.get('feedback_addressed', []), 'saved_to_library': False}
        zp = os.path.join(a.out, 'handoff.zip')
        with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
            for f in a.files: z.write(f, os.path.basename(f))
            z.writestr('handoff.json', json.dumps(manifest, indent=2))
        r = {'bundle': zp, 'manifest': manifest, 'note': 'Not saved to the Library. Upload in Ad Studio (Library > Upload) or save later with adstudio.py save.'}
    print(json.dumps(r, indent=2))


if __name__ == '__main__':
    main()
