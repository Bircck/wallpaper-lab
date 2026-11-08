# Look and motion rules

Taste rules distilled from about 30 builds, published and rejected. Each rule has the evidence so it can be re-checked. For technique see the other pages in this folder; for wind, steam and other ambient effects see [wind-weather-and-ambient-life.md](wind-weather-and-ambient-life.md).

## 1. Choosing the base art

- **Finished art beats procedural geometry.** About 15 procedural or realtime-3D builds were rejected (abstract materials, metal, hexagons, a 3D drive, a 3D character). The one procedural success, Sunroom, is flat, graphic and uses a small palette. Opaline works because a painting does the heavy lifting.
- **If you must go procedural,** plan values first (3-value thumbnail, one focal point), use a named 5-7 swatch palette, authored silhouettes (SDF with analytic AA, not a noise threshold), surface grain or dither, and baked static layers. Scenes without these read as demos. Domain-warp noise was never accepted as the main element.
- **Base art that reads as generated gets rejected:** saturated reds, stippled stone, stock subjects (lo-fi desk, lighthouse postcard), near-monochrome palettes with a 15 px focal object, busy intricate detail. Flat limited-palette print or cel styles (a shin-hanga village scored top) and public-domain art (Living Print) avoid it.
- **Realtime 3D is out; offline 3D rendered into the painting's style is in** (the Blender toon car, the cloth ghost in Moon Cat).
- **Judge the still before building motion.** A weak core visual is cheaper to flag early. Passing technical checks does not mean it looks good (Collection 01: concepts were stronger than every implementation).
- **Concept ranking that held up:** cleanest value structure, least busy detail. Rejected for effect work: glossy specular speckle over wet paving, many tiles and foliage near the movers, crisp intricate foreground grass, a hero prop overlapping clouds, a symmetric pad ring (reads as generated). Look for a swinging prop hung against plain sky (easiest matte) and an open stage for the effect (calm mirror puddle, open sea).
- **Concept prompts** for later steps: keep the main subject in the central 70% of the width, sky a smooth gradient with clouds separate, water calm and glassy, no painted rain, mist, beams or fireflies, light sources with a contained halo. See [codex-image-generation.md](../tools/codex-image-generation.md).
- **Calm water is a precondition** for any water effect. Busy painted water reads as either too much or invisible ([water-on-painted-scenes.md](water-on-painted-scenes.md)).

## 2. Motion

- **Never warp a painting that has solid objects.** Displacement is accepted only on matter without edges (nebula gas, a water surface over a seabed), and even there twisting or jelly motion was rejected (Luminous Streams 0.8). Use separate layers with their own motion, anchored at roots or pivots, one shared gust signal, smaller amplitude with distance ([motion-separate-layers-not-warps.md](motion-separate-layers-not-warps.md)).
- **Clearly visible but calm.** "Nearly invisible" and "too much" were both rejected. In a 12-build review a scene where 0.7% of pixels changed in 2 s (only star twinkle) scored 5.4; one where 38% changed (caustics, rays, sway at once) scored 7.2 but had no calm layer. Aim for one mid-size mover visible at a glance and one calm region.
- **Check amplitudes against what a viewer can see** at 1080p: 0.4-0.7 px motion (leaf stir, curtain breath, pad bob) counted as no motion. Tree tips at 1.5-4.5 px were reported as barely moving; 4-8 px in a gust was accepted. A tiny lift in painted light (0.4 of 255 levels) was invisible.
- **Living things move in events, not loops.** Crane: two beats then a glide. Dragonfly: a six-second visit. Train: every 60-90 s. Constant flapping was rejected. Characters and vehicles are small accents; the scenery is the hero.
- **Motion must not fidget.** Plants rotating in mid-air or shaking fast and small read as wrong. Keep pivots on the ground and neighbours in step.
- **Judge motion over seconds,** tracking flow over 1-2 s, not frame differences. Water glints should be slow and steady, never twinkling (see the twinkle metric in the water page). Clips made from exact frames beat a real-time recording, whose compression hides detail a few levels deep.
- **If a look keeps missing,** stop tuning. After one honest try, change the approach (Summer Crossing's sea went through six rounds before a different engine was kept). Putting live sliders on the whole scene for the tester to tune works better than more guessed versions.

## 3. Matching the medium

- **Everything added must match the art.** Crisp procedural glints on a cel painting read as fake; a soft mirror of the real scene read as water (Moon Cat lake). A procedural crane on an ink print failed; a crane recoloured to the print's ink and paper tones fit (Living Print). Soft CG overlays (large glowing firefly orbs of about 50 px, round beads on glass, glowing aurora) drew the same objection. Clamp firefly size and glow to about half and keep cores crisp.
- **Soft edges beside crisp painted outlines** are a visible style mismatch at 1:1. Koi sprites needed a thin near-black ink rim to match the pads.
- **One cohesive scene.** Independently generated props pasted onto a scene did not share light or perspective and were rejected (Sonic dock).
- **Sparkle in moderation and tied to the source.** Dust and twinkles helped (Luminous Streams dust at 40%); frequent or strong glints were rejected.
- **Keep a parity baseline.** Snapshot the approved build and diff against it after every change ([other-recorded-approaches.md](other-recorded-approaches.md)).

## 4. Rejected extras (do not repeat)

Added life that read as noise on a finished painting:

- Extra characters nobody asked for (beach walkers, a distant boat, small people).
- Light beams or shore light drawn above the horizon (read as wavy lines); rock effects that are too strong (read as melting); swell sets over rocks.
- Floating or sky lanterns, shrine glow, incense, egrets, gust leaves, a gust-light band through a canopy (all Golden Shallows).
- Moon Cat ghost ideas: a ghost cat on the chimney (Codex frames plus RIFE), a ghost in the pumpkin, a ghost ferry. Ghosts blowing out 10 px windows did not read; ghost geese looked like clones.
- Living Print: hovering insect, a procedural crane, continual bird flapping, far bank moving too much.

Kept: one rare crab tied to a rock (Golden Shallows), the cloth-sim sheet ghost, a lantern procession and wisps on the lake (Moon Cat).

**Rule of thumb:** a rare event tied to something already in the painting beats a new gag.

## 5. Sliders

- **A few 0-100 sliders named for what the user sees.** 50 = the tuned look, 0 = off (events: only a manual hook; speed: still), 100 clearly stronger. Straw Hat Cove went from 41 properties to 12. Five or six can be justified when each controls a distinct effect (Rain Lantern Alley: Rain, Wind, Mist, Lights, Lightning, Render scale).
- **Variants stay in the lab.** Build two or three selectable versions for visual judgement calls with wide ranges, keep the baseline, then collapse to sliders. Use cycling buttons, never `<select>` (crashes Wallpaper Engine's renderer).
- **Do not duplicate Wallpaper Engine's colour options** (Brightness, Contrast, Saturation, Hue). Bake a fixed look into the shader instead.
- **A master slider must scale every motion path.** In Golden Shallows, swell bands and gust patches kept moving at Waves 0 and a user noticed. Verify the extremes by measuring mean frame change per second (there: 1.2 at 0, 7.0 at 50, 14.1 at 100).
- **Frequency sliders** (how often events happen): 0 = manual only, 50 = a 4.6-10.4 s pause between events, 100 = 1-2.6 s, 25 about 40 s, measured over 10 minutes of scene time.
- **Nothing may jump when a slider moves.** Keep piecewise clocks per slider-driven motion (clouds, bats, leaf gusts) so the integral of speed stays continuous; visits already begun finish when the setting changes; `seek(t)` resets the clocks. Integrate phases per frame (the lighthouse beam).
- **Wind must not drive water,** and sea speed must be speed only, not a fade to the painting (Summer Crossing; measured pixel-identical across Wind 0/50/100).
- **A slider at 0 that stops all motion should stop requesting frames.** The check must include every slider that still moves anything (swaying trees once kept a scene drawing at 30 FPS).

## 6. Rare events

- **Schedule by slots.** Moon Cat: one event per 105 s slot at the default, at least 15 s from slot edges, nothing in the first 40 s, 4 s clear of a cat event. Simulate 60 minutes of scene time before shipping (32 events, smallest gap 36 s, 0 overlaps).
- **Take turns with a low-discrepancy sequence** so the mix of event kinds stays even.
- **Let events yield to the aspect ratio.** A visit that does not fit the screen gives way (at 32:9 only the witch and the veil fit in Moon Cat).
- **Lab buttons** for rare events must start the event at once and replace the running one. Judge rare events by looping them in a lab (`?loop=8`), not by waiting in the wallpaper.
- **Keep background events apart** from other small effects (lake wisps away from chimney smoke) and mask them with an occluder map built from the existing water mask, so lights do not change when the water mask does.
- **Per-event pacing:** a lantern procession of nine ghosts on a hand-traced path with step bob and reflections cost almost nothing and was liked.

## 7. Framing for other aspect ratios

- Put the focal point in a 16:9 safe core and design what the wings show. Check 1920x1080 and 3440x1440 (2.4x the pixels).
- For a tall painting on a wider screen, put the window as low as it can go with the subject's top still in. Moon Cat at 21:9 keeps cat, lake and town and cuts the moon top; at 32:9 only 940 art px height fits and the lake and town drop out. Golden Shallows at 4:3 loses the shrine and the boulder act's rock. Decide which events need which area and let them yield.
- A prop high in the frame needs a top-biased crop at 21:9.

## 8. Review habits

- **Compositing errors cost more than weak art** (ghost silhouette, halo box, upright reflection). Find them with 3x brightness-boosted 1:1 crops at chosen times: gust peak, flash, loop seam.
- **Compare full frames,** not crops, on a swap page (with a live switch in the host when possible).
- **Do not explain away a visible flaw** (a colour step called a debug artefact, a broken headland beside a checked pole). Look at what surrounds a fix.
- **Independent review agrees with self-review** within about 0.5 points on a 10-point scale (12 builds), so a second read is cheap insurance, not a substitute for looking.
- **Split a scene into a core plus parts,** one owner per part, before running parallel fixes; send each review finding back to its part's owner.
