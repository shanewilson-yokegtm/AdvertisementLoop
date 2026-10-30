#!/usr/bin/env python3
"""Build self-contained Claude skills and the single-entry ad-builder plugin.

skills/yoke-ad-maker is the maintained source. The ad-builder alias, plugin files,
and ZIP archives are generated from it so an installed entry point needs no sibling skill.
"""
from pathlib import Path
import json
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'skills/yoke-ad-maker'
ALIAS = ROOT / 'skills/ad-builder'
PLUGIN = ROOT / 'plugins/ad-builder'


def archive(folder, destination, relative_to):
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as out:
        for file in sorted(folder.rglob('*')):
            if file.is_file() and '__pycache__' not in file.parts:
                info = zipfile.ZipInfo(file.relative_to(relative_to).as_posix(), (2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                out.writestr(info, file.read_bytes())


def main():
    shutil.copytree(SOURCE, ALIAS, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__'))
    text = (ALIAS / 'SKILL.md').read_text()
    old_description = next(line for line in text.splitlines() if line.startswith('description: '))
    text = text.replace('name: yoke-ad-maker\n', 'name: ad-builder\n', 1).replace(
        old_description,
        'description: Create branded Yoke ads from Claude, generate Higgsfield video through Ad Studio, save to the shared library, share to Slack, and process feedback. Use for /ad-builder.',
        1,
    ).replace('# Yoke ad maker', '# Ad builder', 1)
    (ALIAS / 'SKILL.md').write_text(text)
    for folder in (SOURCE, ALIAS):
        archive(folder, ROOT / 'skills' / (folder.name + '.zip'), ROOT / 'skills')

    # The plugin has one complete entry point, rather than two interdependent skills.
    old_sibling = PLUGIN / 'skills/yoke-ad-maker'
    if old_sibling.exists():
        shutil.rmtree(old_sibling)
    shutil.copytree(ALIAS, PLUGIN / 'skills/ad-builder', dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__'))
    manifest_path = PLUGIN / '.claude-plugin/plugin.json'
    manifest = json.loads(manifest_path.read_text())
    manifest['version'] = '0.4.0'
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    archive(PLUGIN, ROOT / 'plugins/ad-builder-plugin.zip', PLUGIN)

    with zipfile.ZipFile(ROOT / 'skills/ad-builder.zip') as built:
        assert built.testzip() is None
        for required in ('SKILL.md', 'scripts/adstudio.py', 'references/yoke-brand.md', 'assets/yoke-lockup.svg'):
            assert 'ad-builder/' + required in built.namelist(), required
    print('Built self-contained ad-builder, compatibility yoke-ad-maker, and plugin 0.4.0.')


if __name__ == '__main__':
    main()
