# 3D -> 2D: a cloth-simulated character rendered as a cel sprite

Status: worked. On the Moon Cat sheet ghost the result was rated far above Codex-drawn frame cycles (a ghost cat, a drawn pumpkin ghost, a rowing ferry), which looked weak next to it. It shipped in [Moon Cat](../../wallpapers/published/moon-cat/README.md) and is installed in Wallpaper Engine.

Implementation, in short: a Blender script (`sheetghost.py`) simulates and renders the act, and the runtime side is the creatures block of the wallpaper's `main.js` (`crSheetGhost`, `cr5Sprite` and `CR_HIDE`). The result ships as a single atlas image.

## Problem

A small character has to do a little act on a painted cel-anime scene: peek out from behind a chimney, look round, zip back, pop up, wave, giggle, drop away. Every move should have physically right secondary motion (a trailing hem, a sleeve, a turn), it should match the painting's line and flat colour, and it should be smooth at 30 fps. Codex-drawn cycles give good single drawings but poor motion between them. v4's Blender ghost (a procedural lathe surface with travelling waves, no cloth) read as a "toon blob".

## What worked

1. **Build it from cloth, not from a shaped surface.** A polar-grid disc of about 4.5k vertices with a scalloped hem and one longer flap that trails like a tail. It is pinned over a head sphere from the crown to just under the eyes; the pin weights fall off over about 25 degrees. The rest is a cloth simulation. The face (eyes, highlights, blush, smile) is separate flat objects on the head sphere, just outside the cloth, kept in place because the face area is pinned.
2. **Simulate the whole act in one run along the real screen path.** Use the same Hermite path, bob, sway and lean that the runtime would use, in art px (1 Blender unit = 100 art px). Start the simulation 2 s early, hidden, so the sheet settles. Then the hem trails when the ghost zips sideways and billows up when it drops, which no loop of clips gives. Head turns are a real yaw of the whole ghost: the far eye goes round the head and the sheet lags. Keyframe every frame (root position, roll, yaw, arm pivots) and step `frame_set` through every frame in order, rendering every second one.
3. **Arms that hold the cloth.** Each arm is a hidden collider plus a hand empty at its tip, with a Hook modifier (before the Cloth modifier) on a pinned patch of the sheet where the hand rests. Bind the hook with `matrix_inverse = hand.matrix_world.inverted() @ sheet.matrix_world` at the rest pose. A raised arm then lifts a real sleeve.
4. **Weight matters.** The first try used gravity at 0.32, mass 0.12 and strong turbulence. It looked like silk and read as too light. The approved heavy setting: gravity weight 1.0, mass 0.32, air damping 0.9, turbulence 0.5, bending 0.8, tension 16 (`CLOTHS` in the script).
5. **Render flat.**
   - Shading: Diffuse -> ShaderToRGB -> RGBToBW -> a constant ramp with three tones of the painted character's palette -> Emission. A Backfacing mix gives the inside of the sheet one darker tone (it reads as the hem's lining).
   - Ink: Freestyle, external contour and border only, constant thickness, the painting's deep indigo. About 5 px at 512, which lands near the painting's line weight after packing.
   - Camera: orthographic on the smooth path (without the bob). Each frame is centred where the runtime will place it, and the bob, sway and lean are in the frames. Transparent film, 512 px, 12 fps.
6. **Into the wallpaper as an atlas.**
   - Crop every frame to the same square: the union of what the character covers, plus a halo margin.
   - Downscale to 128 px cells and pack 16 x 16 cells into one 2048 atlas, about 1.2 MB for 145 frames. Bleed colour under alpha 0 so the mipmaps have no dark fringes. Blender writes straight-alpha PNGs.
   - Play the frames along the same path with neighbouring frames blended, which is smooth at 30 fps.
   - Hide it behind scenery with an occluder mask in the sprite shader (here the chimney: not-sky in the sky layer's alpha).
   - Add a soft halo pass and a tinted relight of the painting around it. Drive the light by how much of the character shows, so it dims while hidden and fades out at the end instead of stopping.
   - Cost: under 0.1 ms per frame at 1080p.

## What failed on the way (each fixed by changing the approach, not by tuning)

- **Inner Freestyle contours** (silhouette and contour edge types) drew broken lines across the face whenever the arms pushed folds forward. Fix: external contour plus border only; the tones show the folds.
- **Arm colliders alone punch through cloth** when they swing up fast; the sleeve never rose. Fix: hooks on pinned patches (point 3).
- **A raised far-side arm ends behind the head** on a three-quarter view. Fix: raise it sideways and a little forward, and turn the character half to camera while it waves.
- **The glow cut off at the end of the act**, because the sprite's frame range ended before the light faded. Fix: compute the light before the early return, and fade it with the character's visibility.
- **The first placement put the head 48 art px lower than the drawn character's**, because the sim's head sat on the path point. Its eyes never cleared the pumpkin rim. Decide what the path point means (head or body centre) before rendering.

## Practical notes (Blender 5.2.2, headless)

- Freestyle works with EEVEE headless. In a factory-empty file the default lineset has no linestyle: `ls.linestyle = bpy.data.linestyles.new('ink')`.
- Parent the cloth object to the moving empty: pinned vertices follow the object transform, and the rest simulates in world space.
- The simulation plus 145 renders at 512 px took about 4 minutes on the 1070 Ti; 234 frames took 7.5 minutes. Run it under `docs/tools/gpu_lock.py`.
- Keep the act's path in one place and copy it exactly into the runtime (`CR_HIDE` = the script's `ACTS_DEF['chimney']['PTS']`). If the runtime moves the path, shift both.
- Do quick still tests (6-9 frames at chosen times, about 1 minute) before every full render.
- Run Python edits of these scripts from files, not Bash heredocs (heredocs collapse backslashes), and check with grep that an edit really applied. One round re-rendered with an edit that had silently failed.

## When to use it

Use it for a character or object whose charm is in physical secondary motion: cloth, a tail, a hem, a cape, a lantern swinging. It also fits anything that needs a true turn, or a path-driven act with stops and starts. Drawn frames still win when the charm is in the face and the pose (expressions, hands). The hybrid not tried yet: render the cloth as guide frames for Codex paint-overs, to get drawn faces over simulated cloth.

Related: [motion-separate-layers-not-warps.md](motion-separate-layers-not-warps.md), [other-recorded-approaches.md](other-recorded-approaches.md) (illustrated driving), [../tools/blender.md](../tools/blender.md).
