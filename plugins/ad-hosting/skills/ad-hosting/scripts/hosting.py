#!/usr/bin/env python3
"""Personal HTTP transport for hosting operations. Naming/validation/compilation stay on the server."""
import argparse
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    sub.add_parser('guide'); sub.add_parser('list')
    create = sub.add_parser('create'); create.add_argument('--title', required=True); create.add_argument('--request-key', required=True)
    for command in ('get', 'prepare', 'save', 'export'):
        s = sub.add_parser(command); s.add_argument('campaign_id')
        if command == 'save':
            s.add_argument('--file', type=Path, required=True); s.add_argument('--expected-revision', type=int, required=True); s.add_argument('--request-key', required=True)
        if command == 'export': s.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    base = os.environ.get('AD_STUDIO_API', '').rstrip('/')
    token = os.environ.get('AD_STUDIO_TOKEN', '')
    u = urlparse(base)
    if u.scheme != 'https' or not u.netloc or u.username or u.password or u.query or u.fragment or not u.path.endswith('/api/v1'):
        p.error('Set AD_STUDIO_API to the chosen HTTPS environment /api/v1 URL (no credentials, query or fragment).')
    if not re.fullmatch(r'yas_[a-f0-9]{64}', token): p.error('Set AD_STUDIO_TOKEN to your own personal token in the environment; never paste it into a prompt.')
    if hasattr(a,'campaign_id') and not re.fullmatch(r'yc_[a-f0-9]{24}',a.campaign_id): p.error('Invalid campaign ID')
    edge = '/campaigns'; body = None
    if a.command == 'guide': edge += '/hosting-guide'
    if a.command == 'create': body = {'title':a.title,'requestKey':a.request_key}
    if hasattr(a, 'campaign_id'): edge += '/' + a.campaign_id
    if a.command in ('prepare','export'): edge += '/preparation'
    if a.command == 'save':
        edge += '/commands'
        body = {'expectedRevision':a.expected_revision,'requestKey':a.request_key,'command':{'type':'save_preparation','preparation':json.loads(a.file.read_text())}}
    req = Request(base+edge,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    try:
        with build_opener(NoRedirect).open(req,timeout=60) as response: result=json.load(response)
    except HTTPError as e:
        detail={'error':'http_error','status':e.code,'action':'Reload on 409. On a lost save response, retry the same file, revision and request key.'}
        try:
            error=json.loads(e.read(12000))
            if error.get('error') in ('invalid','conflict','identity_conflict','preparation_locked','preparation_missing','forbidden'):
                message=str(error.get('message',''))[:4000]
                if not re.search(r'yas_|Bearer |sk-|access_token|secret',message,re.I):
                    detail.update(error=error['error'],message=message)
        except (ValueError,UnicodeError): pass
        print(json.dumps(detail),file=sys.stderr); return 1
    except (URLError,TimeoutError):
        print('Connection failed. Save outcome may be unknown; preserve the same request key and body.',file=sys.stderr); return 1
    if a.command == 'export':
        a.out.mkdir(parents=True,exist_ok=True)
        (a.out/'manifest.json').write_text(json.dumps(result['manifest'],indent=2)+'\n')
        (a.out/'analysis.csv').write_text(result['csv'],newline='')
        (a.out/'handoff.md').write_text(result['markdown'])
        print(json.dumps({'directory':str(a.out.resolve()),'manifestHash':result['manifest']['manifestHash']}))
    else: print(json.dumps(result,indent=2))
    return 0

if __name__ == '__main__':
    sys.exit(main())
