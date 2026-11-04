#!/usr/bin/env python3
"""Reproducible, self-contained ad-hosting skill/plugin; no credentials or account evidence."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import zipfile

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'skills/ad-hosting'
PLUGIN=ROOT/'plugins/ad-hosting'
guide=json.loads(subprocess.run(['node',str(ROOT/'scripts/campaign-hosting.mjs'),'guide'],cwd=ROOT,check=True,capture_output=True,text=True).stdout)
for name,data in [('template.json',guide['template']),('schema.json',guide['schema'])]:
    (SOURCE/'references'/name).write_text(json.dumps(data,indent=2)+'\n')
shutil.copytree(SOURCE,PLUGIN/'skills/ad-hosting',dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__'))
(PLUGIN/'.claude-plugin').mkdir(parents=True,exist_ok=True)
(PLUGIN/'.claude-plugin/plugin.json').write_text(json.dumps({'name':'ad-hosting','version':guide['version'],
    'description':'Prepare Yoke campaign memos, exact asset assignments, analysis labels and review packets in the shared Ad Studio. No platform execution or media generation.',
    'author':{'name':'Yoke GTM'}},indent=2)+'\n')

def archive(folder,target,parent):
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as out:
        for f in sorted(folder.rglob('*')):
            if f.is_file() and '__pycache__' not in f.parts and f.suffix in ('.md','.py','.json'):
                info=zipfile.ZipInfo(f.relative_to(parent).as_posix(),(2026,1,1,0,0,0))
                info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
                out.writestr(info,f.read_bytes())
    with zipfile.ZipFile(target) as built:
        assert built.testzip() is None
        assert all(not any(s in n for s in ('.env','node_modules','__pycache__')) for n in built.namelist())
    return hashlib.sha256(target.read_bytes()).hexdigest()

receipts={}
for folder,target,parent in [(SOURCE,ROOT/'skills/ad-hosting.zip',SOURCE.parent),(PLUGIN,ROOT/'plugins/ad-hosting-plugin.zip',PLUGIN)]:
    receipts[target.relative_to(ROOT).as_posix()]=archive(folder,target,parent)
print(json.dumps({'version':guide['version'],'sha256':receipts},indent=2))
