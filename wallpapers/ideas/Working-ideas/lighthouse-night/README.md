# Lighthouse Night

**Shelved 2026-11-03.** It was shelved before a finish pass. It was not reworked after the 2026-10-22 batch, where a review put it among the weakest three. The moon glitter dashes and beam glints are also close to the crisp water glints rejected on Moon Cat, so check those first. `package/` still runs.


A white lighthouse and a small keeper's cottage on a rocky headland under a full moon, painted in an anime-background style from a low camera in a calm cove. The lighthouse beam sweeps slowly through faint sea air and is mirrored in the still water. Clouds drift past the moon with their reflections, the moon path glitters, a thin sea mist drifts along the horizon, and now and then a far boat light crosses the open sea.

## Controls

| Slider | 0 | 50 (default) | 100 |
|---|---|---|---|
| Beam | off (lamp, glare, beam, reflection, cloud glint) | soft cone, one turn every 34 s; the lamp flashes and the sky around it lights up as the beam faces you | twice as bright |
| Beam speed | beam stands still | one turn in 34 s | one turn in 17 s |
| Sea shimmer and boat | off (moon glitter, beam glints, boat event, window breathing) | gentle glitter dashes in the moon path; a boat light about every 2-4 min | stronger glitter |
| Mist | off | two thin painted mist strips drifting along the horizon and the headland base, lit by the beam | denser |
| Cloud speed | still | about 4 art px/s, with the painted cloud reflections drifting along | double |
| Render scale (%) | 35 to 100 | 100 | |

When Beam, Sea shimmer, Mist and Cloud speed are all 0, the wallpaper stops requesting frames. It honours Wallpaper Engine's FPS limit and pause.

## How it was built

- **Painting.** Codex generated concept C of three, with the batch STYLE and LAYER-FRIENDLY COMPOSITION blocks and a scene paragraph that insists on a perfectly calm, glassy sea and no painted beam. Upscaled with 4x-UltraSharp to a 3344x1882 master.
- **Moon plate.** A cloud overlapped the moon. One Codex crop edit removed the clouds around the moon (aligned to 1 px, colour-matched at low frequency). It is used only for the part of the moon the cloud hid; the visible moon keeps the painting's pixels.
- **Clouds.** A script estimates the clear sky by normalised convolution over sky pixels that are not cloud, and splits the sky into a cloud-free plate (`base.jpg`) and a premultiplied RGBA cloud layer (`clouds.png`, opaque core with the painted soft rim), so `plate·(1−a) + layer = painting`. The layer drifts as a mirrored tile, so a cloud passing the moon really covers it. The painted cloud reflections on the water are a signed delta strip (`reflections.png`) that drifts with the same phase.
- **Masks.** Land and the foreground rocks come from column scans on colour (blue water and sky against grey rock and white tower), with a measured waterline; the beam uses them as depth (headland at the lamp's distance, rocks near the camera). Lamp and window glow, the moon column and the water are further channels (`masks.png`, `masks2.png`).
- **Beam.** A pinhole camera is fitted to the painting (horizon 533, lamp and its painted reflection agree). The beam is a soft cone, about 8.5° half-angle. Each pixel computes the closest approach of its view ray to the beam axis and a Gaussian line integral there, so the cone foreshortens correctly as it turns. Land and the sea surface occlude it by depth. Low-contrast drifting noise breaks it into soft painterly bands. On the water the same beam is mirrored (sea plane under the camera), shimmered by slow ripples, and breaks into glints in the middle distance. As the beam turns toward the viewer the cone fades into a glare: the lamp flashes, a broad bloom lights the sky around it and its reflection. Cloud undersides catch the beam passing below them.
- **Moon glitter.** Horizontal dashes in perspective (smaller and denser toward the horizon), confined to the painted moon column, slowly travelling toward the viewer.
- **Mist.** Codex painted a thin mist band on a plain canvas (SOFT LAYER block). A script un-mixed it into straight RGBA.
- **Boat.** A tiny warm masthead light with a short reflection crosses the open sea left of the headland in 80 s, in about 65 % of 150 s slots.
- **Ultrawide wings.** One Codex edit outpainted 120 art px on each side of the cloud-free base (only the outer bands kept, colour-matched at the seam, upscaled). The art is cover-fitted as 1912x941, so 16:9 shows exactly the painting and 3440x1440 keeps the moon and the lamp's reflection.
- **Rendering.** One full-screen fragment pass, everything a function of scene time. 1.0 ms per synced frame at 1080p on a GTX 1070 Ti (headless). Folder 2.8 MB.


## Run it

- In Wallpaper Engine, open `project.json` from this folder.
- In a browser, open `index.html` (Chrome needs `--allow-file-access-from-files` for WebGL textures over file://).
- Check: `node docs/tools/web-wallpaper-kit/verify.cjs wallpapers/ideas/Working-ideas/lighthouse-night/package` passes with 0 warnings.

## Credits

- Painting, moon plate and mist strip: generated with the Codex CLI's built-in image tool for this project.
- Upscaler: 4x-UltraSharp by Kim2091 (CC BY-NC-SA 4.0), so this wallpaper is non-commercial.
- Cloud-delta and mist-extraction approach adapted from an earlier, deleted experiment. Code: original.

## Known flaws

- The moon is drawn as an opaque disc in front of the clouds (stylised), also at rest, where the painting had a cloud over its lower left. This replaced torn cloud scraps and a see-through veil (review 2026-10-22).
- Where a cloud has drifted away, the sky is the smooth estimated gradient, a little flatter than the painted sky.
- The clouds wrap as a mirrored tile, so after a few minutes a mirrored copy of a cloud shape drifts in.
- At the moment the beam looks straight at the viewer the volumetric model is replaced by a glare (about 2 s hand-over).
- The 120 px side wings (Codex outpaint, only shown on screens wider than 16:9) carry no clouds of their own, only the drifting layer; masks there repeat the painting's edge column.
- The moon is a little photographic next to the painted rest (it came that way from the concept).
