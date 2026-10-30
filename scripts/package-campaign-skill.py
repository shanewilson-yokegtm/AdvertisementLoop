"""Package only the maintained campaign skill; never include environment files or account data."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
source = root / 'skills' / 'campaign-operator'
target = root / 'skills' / 'campaign-operator.zip'
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for item in sorted(source.rglob('*')):
        if item.is_file() and item.suffix == '.md':
            archive.write(item, item.relative_to(source.parent))
print(target)
