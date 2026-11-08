"""Zip a wallpaper's package/ folder and record checksums. Called by `wl package`; same output format as the per-wallpaper package.py files.

usage: python -I tools/wl_package.py <package-dir> <zip-path> <release-json-path> <version> <zip-name-for-json>
Only package/ goes in. Sub-folders are included (the old scripts only handled flat folders). Entries are sorted by name.
"""
import hashlib
import json
import os
import sys
import zipfile

src, z, out, version, zname = sys.argv[1:6]
files = sorted(os.path.relpath(os.path.join(d, f), src).replace(os.sep, '/')
               for d, _, fs in os.walk(src) for f in fs)
os.makedirs(os.path.dirname(os.path.abspath(z)), exist_ok=True)
with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
    for f in files:
        zf.write(os.path.join(src, f), f)
h = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
rel = json.load(open(out)) if os.path.exists(out) else {}
rel.update(version=version, zip=zname, zipSha256=h(z), zipBytes=os.path.getsize(z),
           files={f: {'bytes': os.path.getsize(os.path.join(src, f)), 'sha256': h(os.path.join(src, f))} for f in files})
open(out, 'w').write(json.dumps(rel, indent=1))
print(zname, rel['zipBytes'], rel['zipSha256'][:16])
