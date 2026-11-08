"""Codex concept round: one `codex exec` image generation per concept, run in parallel and resumable.

Usage: python run_concepts.py [--concepts concepts.json] [--ref mood.png] [--out concepts] [--jobs 4] [id ...]

concepts.json (see concepts.example.json) holds a shared style block ("base"), an optional mood reference image
("reference", also settable with --ref) and a list of {"id", "scene", "use_reference"}. A concept whose
<out>/<id>.png already exists is skipped. Prompt, log and run.log are written next to the outputs.
Compose concepts with the later pipeline in mind: a large open water area for animated water, a clear foreground
that can be replaced or animated separately, and a distant background that stays a painted plate."""
import subprocess, os, sys, shutil, time, json, argparse
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
CODEX = shutil.which('codex') or 'codex'

def run(c, base, ref, outdir):
    cid, scene, use_ref = c['id'], c['scene'], bool(c.get('use_reference')) and ref
    out = f'{outdir}/{cid}.png'
    if os.path.exists(out): return cid, 'skip'
    ref_txt = ("The attached image is a MOOD and QUALITY reference only (lighting, colour, render quality). "
               "Ignore any text overlays. Do NOT copy its composition, camera angle or object placement. ") if use_ref else ""
    prompt = (f"Use your built-in image generation tool to create ONE new image. {ref_txt}{base}Scene: {scene}\n"
              f"After generating, copy the generated PNG file to {out} in the current working directory and print its pixel size.\n")
    open(f'{outdir}/{cid}-prompt.txt', 'w', encoding='utf-8').write(prompt)
    args = [CODEX, 'exec', '--skip-git-repo-check', '--sandbox', 'workspace-write'] + (['-i', ref] if use_ref else [])
    for attempt in range(2):
        t = time.time()
        with open(f'{outdir}/{cid}-prompt.txt', 'rb') as fin, open(f'{outdir}/{cid}-codex.log', 'wb') as fout:
            rc = subprocess.run(args, stdin=fin, stdout=fout, stderr=subprocess.STDOUT).returncode
        line = f"{time.strftime('%H:%M:%S')} {cid} attempt {attempt + 1} exit {rc} {time.time() - t:.0f}s output={os.path.exists(out)}"
        print(line, flush=True); open(f'{outdir}/run.log', 'a', encoding='utf-8').write(line + '\n')
        if os.path.exists(out): return cid, 'ok'
    return cid, 'FAILED'

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('ids', nargs='*'); ap.add_argument('--concepts', default='concepts.example.json')
    ap.add_argument('--ref'); ap.add_argument('--out', default='concepts'); ap.add_argument('--jobs', type=int, default=4)
    a = ap.parse_args()
    cfg = json.load(open(a.concepts, encoding='utf-8'))
    ref = a.ref or cfg.get('reference'); ref = os.path.abspath(ref) if ref else None
    os.makedirs(a.out, exist_ok=True)
    todo = [c for c in cfg['concepts'] if not a.ids or c['id'] in a.ids]
    with ThreadPoolExecutor(a.jobs) as ex:
        for cid, st in ex.map(lambda c: run(c, cfg['base'], ref, a.out), todo): print('DONE', cid, st, flush=True)
