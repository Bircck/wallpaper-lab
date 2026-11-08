"""Clean plate: ask Codex to remove ONE thing from a painted image and leave everything else identical.

Usage: python run_plate.py --src scene.png --remove "the character in the foreground" [--keep "the pier and its props"]
                           [--prefix plate] [--n 3] [--outdir plate]
Writes <outdir>/<prefix>-<k>.png for k = 1..n (variants run in parallel; resumable), with prompt and log beside them.
Generate several variants and pick one; check alignment against the source before building on it."""
import subprocess, os, sys, shutil, time, argparse
from concurrent.futures import ThreadPoolExecutor
CODEX = shutil.which('codex') or 'codex'
PROMPT = ("Use your built-in image generation tool to make a precise EDIT of the attached image ({src}). "
          "REMOVE {remove} completely and show what is behind it, continuing naturally. "
          "Keep EVERYTHING else exactly identical: the same canvas size and framing{keep}, the water, sky and lighting. No new objects, no text.\n"
          "After generating, copy the generated PNG file to {out} in the current working directory and print its pixel size.\n")

def run(k, src, remove, keep, prefix, outdir):
    out = f'{outdir}/{prefix}-{k}.png'
    if os.path.exists(out): return k, 'skip'
    p = PROMPT.format(src=src, remove=remove, keep=(', ' + keep) if keep else '', out=out)
    open(f'{outdir}/{prefix}-{k}-prompt.txt', 'w', encoding='utf-8').write(p)
    for attempt in range(2):
        with open(f'{outdir}/{prefix}-{k}-prompt.txt', 'rb') as fin, open(f'{outdir}/{prefix}-{k}-codex.log', 'wb') as fout:
            rc = subprocess.run([CODEX, 'exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-i', src], stdin=fin, stdout=fout, stderr=subprocess.STDOUT).returncode
        line = f"{time.strftime('%H:%M:%S')} {prefix}-{k} attempt {attempt + 1} exit {rc} output={os.path.exists(out)}"
        print(line, flush=True); open(f'{outdir}/run.log', 'a', encoding='utf-8').write(line + '\n')
        if os.path.exists(out): return k, 'ok'
    return k, 'FAILED'

def main(argv=None, defaults=None):
    ap = argparse.ArgumentParser(); ap.set_defaults(**(defaults or {}))
    ap.add_argument('--src', required=True); ap.add_argument('--remove', required=True); ap.add_argument('--keep', default='')
    ap.add_argument('--prefix', default='plate'); ap.add_argument('--n', type=int, default=3); ap.add_argument('--outdir', default='plate')
    a = ap.parse_args(argv); src = os.path.abspath(a.src); os.makedirs(a.outdir, exist_ok=True)
    with ThreadPoolExecutor(a.n) as ex:
        for k, st in ex.map(lambda k: run(k, src, a.remove, a.keep, a.prefix, a.outdir), range(1, a.n + 1)): print('DONE', k, st, flush=True)

if __name__ == '__main__':
    main()
