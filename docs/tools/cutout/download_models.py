"""Download the ONNX cut-out models from Hugging Face, pinned to the current revision, with a SHA-256 record per file.

  python docs/tools/cutout/download_models.py [<out dir>]     (default: docs/tools/models)

Writes <out>/<name>/<name>.onnx plus <name>.json (repo, revision, bytes, sha256). finegrain.onnx lands in
<out>/finegrain/, which is what segment.py reads (WL_FINEGRAIN). BiRefNet and anime-seg were tested and were worse
(see docs/tools/cutout-segmenters.md); they are optional: pass --all to fetch them too.
"""
import urllib.request, json, pathlib, hashlib, sys

args = [a for a in sys.argv[1:] if not a.startswith('--')]
OUT = pathlib.Path(args[0] if args else pathlib.Path(__file__).resolve().parents[1] / 'models')
models = [('finegrain', 'MarcinEU/finegrain-box-segmenter-ONNX', 'onnx/model.onnx')]
if '--all' in sys.argv:
    models += [('birefnet', 'onnx-community/BiRefNet-ONNX', 'onnx/model.onnx'), ('anime', 'skytnt/anime-seg', 'isnetis.onnx')]

for name, repo, file in models:
    rev = json.load(urllib.request.urlopen('https://huggingface.co/api/models/' + repo))['sha']
    d = OUT / name; d.mkdir(parents=True, exist_ok=True)
    dest = d / (name + '.onnx')
    if not dest.exists():
        print('downloading', name, flush=True)
        urllib.request.urlretrieve(f'https://huggingface.co/{repo}/resolve/{rev}/{file}', dest)
    with open(dest, 'rb') as f:
        sha = hashlib.file_digest(f, 'sha256').hexdigest()
    rec = dict(name=name, repo=repo, revision=rev, file=file, bytes=dest.stat().st_size, sha256=sha)
    (d / (name + '.json')).write_text(json.dumps(rec, indent=2))
    print('ready', name, rec['bytes'], sha, flush=True)
