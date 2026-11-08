# Codex image generation and edits

Concept art, clean plates, prop-by-prop scene building, seabed and sky layers were all made by driving the Codex CLI's built-in image tool from Python scripts. No other image generator was used for these.

## Where it lives

- CLI: the OpenAI Codex CLI, on PATH (`codex-cli 0.160.0` when checked). Scripts find it with `shutil.which('codex')`.
- Raw outputs land in a per-session folder under Codex's own `generated_images` directory in your home folder. The prompt tells Codex to copy the PNG to a given path inside the working directory; the script checks that file exists.
- Each run's log is the CLI's stdout. Its header records workdir, model, sandbox and session id. Lines about `rmcp::transport::worker ... AuthRequired` (an unrelated MCP bridge) appear in the logs of runs that still produced images.

## The command

Run from the folder that should receive the output (the sandbox is `workspace-write` on that workdir):

```
codex exec --skip-git-repo-check --sandbox workspace-write -i <image.png> [-i <ref.png> ...] < prompt.txt
```

Generating from scratch: leave out `-i` (or attach a mood reference only). Editing: first `-i` is the image to edit, further `-i` are design references.

- Feed the prompt on stdin from a UTF-8 file. Do **not** add a trailing `-` after `-i <img>`: it was read as another image.
- Create log folders before redirecting into them. A `python run.py > steps/run.log` failed because the shell opened a missing `steps/` first, not because of Codex.
- A CP1252 "e acute" in a prompt broke a run. Write prompts as UTF-8.
- One call takes on the order of a minute (about 60-80 s for a generation; edit steps 1-2 min). Independent variants can run in parallel; dependent steps cannot.

## Prompt shape that worked

Generation (from `docs/tools/codex/run_concepts.py`, concepts read from a JSON file, parallel with `ThreadPoolExecutor`, retry once):

> Use your built-in image generation tool to create ONE new image. [mood-reference sentence] [BASE style block with composition rules] Scene: ... After generating, copy the generated PNG file to `<out>` in the current working directory and print its pixel size.

Edit (from `docs/tools/codex/run_plate.py` and `run_layers.py`):

> Use your built-in image generation tool to make a precise EDIT of the attached image (`<path>`). [what to ADD / REMOVE / change ONLY X]. Change NOTHING else: keep every other pixel, the canvas size, framing, ... identical. No other new objects, no text. After generating, copy the generated PNG file to `<out>` ...

Save the prompt next to the output (`<id>-prompt.txt`) and the log (`<id>-codex.log`), so a result can be repeated and judged later.

## Gotchas

- **Every edit re-renders the whole frame.** Median Lab drift outside the target was about 3.4-5. Composite only the changed region back onto the source and feed that composite, never the raw "after", into the next step (a per-prop edit script should do this).
- **16:9 output is 1672x941, even when you ask for 3840x2160**. For a sharper master, upscale afterwards ([upscalers](upscalers.md)).
- **Output can be 1 px off in size.** Resize it to the source and keep the raw file (`*-after-raw.png`).
- **Check alignment against the source before building on a plate.** Some clean plates drifted and were rejected. Plates are generated in several variants and one is chosen (in one project, plate 3 of 3).
- **Small props:** edit an enlarged close-up crop (about 3:2, Lanczos to 1536 wide) and shrink it back into the frame; outside the crop the frame stays exactly the source .
- **References:** attach design references after the scene image and say they are design references only (do not copy background or layout).
- **Add one object per edit.** Compositing independently generated props was rejected (style and perspective mismatch). The scene-by-edit method gives an exact clean plate for each prop: the step before it.
- **Verify the change landed where intended:** compare the changed bounding box against the intended search box and stop with a warning otherwise; keep rejected steps' files for comparison.
- **Seabed / calm water plate:** the A1 seabed prompt asks for perfectly still, glassy water, no caustics or sparkles, same depth gradient. It worked for the cove scene (aligned at 0,0; MAD 8 outside water; tone-matched in Lab). The same recipe gave a seabed that looked worse than the painted sea on another project, which is one reason that project stopped. Check for calm water before building.
- **Sky:** a cloudless sky edit is only trusted for true-sky pixels, colour-matched at low frequency to the painting.
- **Do not regenerate a chosen base.** Keep the approved empty scene and edit from it.

## Scripts

All in `docs/tools/codex/`; they are generic and take their inputs as arguments.

| What | Script |
|---|---|
| Concept rounds, parallel, resumable. Concepts, a shared style block and an optional mood reference come from a JSON file | `run_concepts.py --concepts concepts.example.json [--ref mood.png]` |
| Clean plate: remove one thing and keep everything else | `run_plate.py --src scene.png --remove "..." [--keep "..."] [--n 3]` |
| Second removal pass (for example a whole structure and its props) | `run_seaplate.py --remove "..."` |
| Background layers: remove an element, still seabed, cloudless sky | `run_layers.py remove\|seabed\|clearsky [n] [--src path] [--what "..."]` |

For prop-by-prop scene building, the same prompt shape applies with one object per edit; composite only the changed region back before the next step. After a prop edit, a difference matte against the previous step plus a SAM refinement gives the cut-out ([cutout-segmenters](cutout-segmenters.md)).

See also: [cutout-segmenters](cutout-segmenters.md) for cutting out what Codex adds, and [approaches/](../approaches/README.md) for the techniques.
