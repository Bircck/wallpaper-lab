# Blender (brief)

Blender is an offline authoring tool here. No wallpaper renders 3D live. What it was used for, and how far each use got:

| Use | Result |
|---|---|
| Rough blockout of a scene: sketch, object-ID, depth and manifest renders, then a Codex paint-over | Worked as a layout aid. The painter follows the blockout when no style reference is attached; with one it drifts. ID-guided SAM gave clean single-prompt cut-outs for 7 of 16 groups; thin props, the vest, the bush and leaf blobs failed. |
| Toon-shaded car loop (EEVEE, ShaderToRGB ramps, inverted-hull ink, wheel refinement) | An exploration of an "illustrated driving" look, not a released wallpaper. |
| Blender Ocean modifier baked to a normal atlas | Used for a water study; not confirmed to be what the shipped water uses. |
| Cloth-simulated sheet ghost, the whole act simulated along the screen path, toon render (ShaderToRGB ramp, Freestyle ink) packed into a frame atlas | Shipped in the Moon Cat wallpaper. Recipe, failures and settings: [3d-cloth-sim-to-cel-sprite.md](../approaches/3d-cloth-sim-to-cel-sprite.md). |
| 3D character and pier rendered to match a painted plate | Rejected twice (glossy-vinyl look, odd foot, blocky pier); the project was stopped. See [animated-characters](../approaches/animated-characters.md). |
| Real rigged bicycle plus a pedalling rider on a Blender Studio rig | Contacts under 1 mm and an exact geared loop, but the character never looked like the intended likeness. Project stopped. See [animated-characters](../approaches/animated-characters.md). |

Rule of thumb: if 2D cut-outs stay unconvincing for an element, model it in 3D, render it to match the painting (toon/painted shading, same camera) and composite. The first wallpaper shipped that way is the Moon Cat sheet ghost.

## Where it lives

- Tested with Blender 5.2.2. Point the commands below at your own install (on Windows typically `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`, or put `blender` on PATH).
- `.blend` files are gitignored (`*.blend`, `*.blend1`).

## How to run

Always headless, from the repo root:

```
blender -b --disable-autoexec <file.blend> --python <script.py> -- <args>
CAM="0,-1.0,5.0,60,0,15" blender -b --factory-startup -P blockout.py -- <abs outdir>
```

The second form is a blockout script that reads the camera from an env var `CAM="x,y,z,pitch,yaw,lens"`. Outputs: `beauty.png`, `ids.png` (Workbench flat colour, no AA), `depth.png`, `manifest.json`, `blockout.blend`. A follow-up script then writes a box, interior positives and ring negatives per object group from `ids.png` and `manifest.json`; SAM2.1-Tiny was run on those prompts (see [cutout-segmenters.md](cutout-segmenters.md)).

## Gotchas

- Ignore the harmless shutdown traceback from an installed "amplitude" extension ("cannot schedule new futures after shutdown"). Cycles may print "Driver version is too old" and still render on the GPU.
- Enable the GPU in the script: `prefs = bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type='CUDA'; prefs.get_devices(); [setattr(d,'use',d.type=='CUDA') for d in prefs.devices]; scene.cycles.device='GPU'`.
- Wrap GPU renders in the lock when several jobs share the GPU: `python docs/tools/gpu_lock.py -- <command>`; render loops in chunks.
- No ffmpeg on PATH. Blender can encode video (`scene.render.image_settings.file_format='FFMPEG'`), or write animated WebP with PIL.
- Freestyle works with EEVEE headless; in a factory-empty file the lineset has no linestyle yet (`ls.linestyle = bpy.data.linestyles.new(...)`). For a moving cloth character, use external contour + border only: inner contours scribble across faces.
- Cloth on a moving character: parent the cloth object to the moving empty (pins follow it), keyframe every frame, step `frame_set` in order. Arm colliders alone punch through cloth; hook a pinned patch to the hand instead. Blender writes straight-alpha PNGs.
- Add the frame suffix deliberately: a `-o` still render once produced `toon-still.png0001.png`.
- Imported rigs: `matrix_basis` transforms are not evaluated after append; arms of a downloaded rig can default to FK; rotate IK foot targets as well as moving them.
- Attribute downloaded models (for example CC-BY assets) and keep source, hash and licence.
