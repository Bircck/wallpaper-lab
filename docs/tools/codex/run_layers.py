"""Background layer plates for an animated painted scene. Steps run in order; each step's source is a previous output.
Variants per step run in parallel. Resumable.
  remove  : remove one element (give it with --what, e.g. "the palm fronds hanging into the top of the frame"); it becomes a separate cut-out later
  seabed  : still, glassy water with the caustic web, glitter and highlights removed (base for an animated water shader)
  clearsky: sky without clouds (for cloud un-mixing / drift), optional
Usage: python run_layers.py <step> [n] [--src path] [--what "element to remove"]"""
import subprocess, os, sys, shutil, time
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
CODEX = shutil.which('codex') or 'codex'; os.makedirs('layers', exist_ok=True)
KEEP = "Keep the exact canvas aspect, framing, camera, perspective, horizon height, rendering style and colours unchanged. "
def prompt_for(step, what):
    if step == 'remove':
        return ("REMOVE " + (what or "the named element") + " completely and continue the background naturally where it was. "
                + KEEP + "Keep everything else exactly as it is. No new objects, no text.")
    if step == 'seabed':
        return (KEEP + "Keep the sky, clouds and everything above the waterline unchanged. Change ONLY the water: make the sea perfectly still and glassy so that the seabed is seen clearly through it. "
                "REMOVE the bright white caustic light network on the sea floor, remove ALL sun glitter, sparkles, ripples and highlights on the water surface. "
                "Keep the sandy seabed and any submerged coral or reef patches in the exact same positions and shapes, and the depth gradient (pale turquoise in the near shallows, deeper blue toward the horizon). "
                "The result is a clean underwater 'seabed plate' that animated caustics and waves will be layered on top of later, so the floor should be evenly lit and soft with no light pattern. No new objects, no text.")
    if step == 'clearsky':
        return ("Remove ALL clouds from the sky, leaving only a clear cloudless sky gradient (deeper blue at the top, lighter, warmer and hazier toward the horizon). "
                + KEEP + "Keep the sea and everything below the horizon exactly as it is; change nothing except the clouds. No new objects, no text.")
    raise SystemExit('unknown step ' + step)
DEFAULT_SRC = {'remove': 'plate/sea-1.png', 'seabed': 'layers/remove-1.png', 'clearsky': 'layers/remove-1.png'}
def run(step, k, src, what):
    out = f'layers/{step}-{k}.png'
    if os.path.exists(out): return k, 'skip'
    p = (f"Use your built-in image generation tool to make a precise EDIT of the attached image ({src}). {prompt_for(step, what)}\n"
         f"After generating, copy the generated PNG file to {out} in the current working directory and print its pixel size.\n")
    open(f'layers/{step}-{k}-prompt.txt', 'w', encoding='utf-8').write(p)
    for attempt in range(2):
        with open(f'layers/{step}-{k}-prompt.txt', 'rb') as fin, open(f'layers/{step}-{k}-codex.log', 'wb') as fout:
            rc = subprocess.run([CODEX, 'exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-i', os.path.abspath(src)], stdin=fin, stdout=fout, stderr=subprocess.STDOUT).returncode
        line = f"{time.strftime('%H:%M:%S')} {step}-{k} attempt {attempt + 1} exit {rc} output={os.path.exists(out)}"
        print(line, flush=True); open('layers/run.log', 'a', encoding='utf-8').write(line + '\n')
        if os.path.exists(out): return k, 'ok'
    return k, 'FAILED'
if __name__ == '__main__':
    step = sys.argv[1]; n = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 2
    src = sys.argv[sys.argv.index('--src') + 1] if '--src' in sys.argv else DEFAULT_SRC[step]
    what = sys.argv[sys.argv.index('--what') + 1] if '--what' in sys.argv else ''
    with ThreadPoolExecutor(n) as ex:
        for k, st in ex.map(lambda k: run(step, k, src, what), range(1, n + 1)): print('DONE', step, k, st, flush=True)
