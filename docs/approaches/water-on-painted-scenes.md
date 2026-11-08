# Water on painted scenes

Status: worked for [Straw Hat Cove](../../wallpapers/published/straw-hat-cove/README.md) (and its veranda variant); failed for several earlier replacements and for the Sonic bay. The lagoon water was well received and kept as the default.

## Problem

Water in a painted scene has to move without turning the painting into a warped smear or replacing its look. Warping the painted water (crossfades, texture advection, translated layers) was rejected repeatedly. Fully replacing it with a procedural surface lost the painted style.

## What worked: layered lagoon water (Straw Hat Cove, "lagoon-layers mode 0")

The water is a perspective plane over a clean, caustic-free seabed, with the painted foreground and shore kept as the painting.

Recipe:

1. **Seabed plate.** A Codex image edit of the empty scene: "make the water perfectly still and glassy so the seabed shows", remove the painted caustic web and the surface sparkles, keep the sand, submerged rocks, reef patches and depth gradient where they are, and change nothing else. It must align with the painting at 0,0 (MAD 8 outside the water was accepted). Then a low-frequency Lab tone transfer from the painting onto the seabed (L 0.25, a/b 0.8), so it matches the painting's colour.
2. **Water mask.** SAM2.1-Tiny prior from point prompts, GrabCut at full resolution, grow boxes for far-sea gaps, bright-hole fill, colour guided-filter edge. Props are excluded through source minus empty (threshold 28 over water, 10 elsewhere). Water continues under plants only where they stood in water.
3. **Shader.** A port of the lagoon-layered fragment shader: refraction of the seabed by summed directional waves, two travelling, wave-distorted caustic passes, surface lighting and separate foam, run on a slowed clock (0.12 pace in the first prototype). The perspective plane uses `z = zk / (y - horizon)` with a horizon fitted from the image (tilted, `zk .62`). Wave and foam detail fade out toward the horizon (z 3-7.5), which removed striped aliasing.
4. **Far sea stays the painting.** Past the mid lagoon (z 1.7-3.4) the painting itself takes over and shimmers by under a pixel, because the image layers turn into haze there. Distant waves, glints and cloud shadows are added as masked detail; the horizon, islands and cliffs stay still.
5. **Painted light.** The painting's own caustic web is always on as an option layer. An optional crisp cel web was tried and left off by default.
6. **Controls.** Three sliders, Waves, Glints and Extra caustics, with 50 = the tuned look.

Cost: 2.7 ms per frame at 1080p and 5.4 ms at 3440x1440, headless on a GTX 1070 Ti (render plus synchronous readback, an upper bound, not measured inside Wallpaper Engine).

How it got there:
- A layered-lagoon prototype: three freshly generated assets (sand/bottom, caustic material, transparent foam), a displaced water plane, two intersecting caustic samples. It was liked at a greatly slowed pace.
- Veranda version: the same lagoon shader on the cohesive master with a caustic-free Codex seabed, a perspective plane, and the scene split by depth (one near layer over live water) instead of per-object cuts. Three water styles were kept side by side: Lagoon layers (default), Cel web, Painted web. Lagoon layers on the original look won.
- The main scene reused it (a faithful port of lagoon-layers mode 0) with its own seabed plate.

## What failed

| Attempt | Result |
|---|---|
| Phase-crossfaded displaced copies of the painted water (early Straw Hat Cove builds: translated residual layers, texture advection) | Static, blurry or morphing. No changing crest shapes, near caustics stayed frozen, crossfades doubled highlights. See [motion-separate-layers-not-warps.md](motion-separate-layers-not-warps.md). |
| Procedural surface replacing the painted water (a heightfield build, three replacement options, three shader experiments) | Rejected for losing the original look or for morphing. |
| Texture-only caustics | Hazy, lost the painted cell look. |
| Whole-scene Codex "empty" or "no deck" plates for hidden fill | The composition reframed and rocks and furniture moved,, so they could not be used. |
| Per-object SAM prompts for furniture on the veranda | Fragmented masks. Depth-based split replaced them. |
| Independently generated props placed over the lagoon | Style and perspective mismatch. Rejected for one cohesive scene. |
| Live caustics vs the painted web | The live caustics are softer than the painted web (known limit; "painted light" keeps the original web). |
| Sonic bay: generated seabed plus A1 caustic light, then the Straw Hat Cove water effects on the painted sea | Worse than Straw Hat Cove: yellow dots on the reef, then muddy because the painted sea already had waves and light lines. See the [Sonic Dock note](../../wallpapers/ideas/stopped-projects.md). |

## A night lake on a cel painting ([Moon Cat](../../wallpapers/published/moon-cat/README.md))

The painted lake was busy (baked orange dashes, a stroked moon path), so it was cut out and repainted instead of wobbled.

Verdict: of three options, only B was acceptable. B = a soft mirror of the lit far shore through slow waves, with soft moon glitter from the wave slopes. A and C drew the moon path as crisp, posterized cel slivers (A also put drawn dashes under every shore light). A and C passed the twinkle check and still looked bad: procedural crisp glints read as fake on a painting, a soft reflection of the real scene reads as water.

- **Semantic water mask from a Codex "magenta key" edit**: "fill ONLY the lake water with flat #FF00FF" on 3:2 crops enlarged 2.56x. Drift was under 0.25 px, so the magenta coverage (area-resized) is the mask; a colour-guided filter snaps it to the painting, and near-black ink stays painting. It separated dark roofs, chimneys and shore trees from dark water better than any colour rule had (v4's colour mask had holes and leaks).
- **Calm plate**: a Codex edit of the same crops ("perfectly calm, no reflections, soft base tones"), tone-matched at 90 px with the old reflections excluded, bled past the mask.
- **Mirror without a scene pass**: bake the lit far shore (base + lights) into a texture and give every water pixel its own mirror axis, the top of its vertical run of water, so islands and side bays mirror about their own shore. Smooth the axis along x with a 1-D bilateral filter: 1-3 px notches in the shoreline otherwise draw faint boxes in the reflection.
- **Grazing perspective**: ground x = dx/dy and z = F/dy with F about the focal length (2000 art px here). With F 20x too small, the glitter came out as a honeycomb of round blobs instead of long thin crests.
- **Twinkle comes from size, not only speed**: crisp dashes under ~3 screen px at 1080p alias between pixel rows as they drift and read as twinkle, even on a 6-13 s wave clock. Reflections of small lights mirrored far from their shore did the same. Measured with a 3-D (x, y, t) blob tracker on 30 fps frames: a glint born and dead within 0.5 s counts as a twinkle.

## A calm sunlit sea ([Summer Crossing](../../wallpapers/published/summer-crossing/README.md), rounds 3-6; round 6 kept)

- **Marks on rigid sheets, not one perspective mapping.** A shared (x/d, log d) mapping kept marks in shape but fanned them out from screen centre, so the left half drifted against the wind, and it sheared strokes up to 9 degrees at the sides. Only tracked speeds showed it. Far, middle and near sheets at constant scale, cross-faded by row, each sliding +x at its own speed: all speeds one sign, tilt under 1 degree in most blocks, and twinkle fell because marks slide along pixel rows.
- **Cap the marks near the shore.** Strokes that grow toward the viewer reach 80-160 px and read as a boomerang or a whale. Compare with the largest marks in the painting's own near water.
- **Reflections as narrow columns.** A full soft mirror of big clouds lifted the deep blue into pale lilac. A strip sharp in x and smeared in y, reading column peaks and fading with distance, keeps the blue between them and still follows the real clouds overhead.
- **Tone-match the calm plate to the painting (85%).** Codex's calm repaint came back with a teal cast that a slider can't remove.
- **Far plant pockets:** sea pixels painted inside far trees stay frozen while the sea moves. A pass after those pieces repaints them with live water, using a mask from the pieces' own atlas.

**Round 4: rigid sheets felt bad live.** Watched live, all of it looked wrong. Tracked speed showed why: +9 to +10 px/s sideways almost everywhere, a sheet sliding, which water doesn't do. Replaced by real waves on a perspective plane, each at its own speed (w^2 = g k), filtered wave by wave against the pixel's footprint, tilting the reflected ray. They comb a layer holding the painting's own reflections (painted sea minus open tone), which drifts with the clouds. Far cheaper to make than painted marks, 24 sines per sea pixel cost nothing measurable at 1080p, and with waves off the sea stays close to the painting. Two crossing wave trains give lenses; a narrow fan gives full-width lines. None of the variants looked as good as the painting. Wide soft bands read as motion blur, and the painting's fine marks were gone.

**Round 5: the painting stays, only its own marks move.** Lift the fine marks off the painting (painted minus a short vertical blur), run two copies toward the shore at perspective speed, fading in and out in turn at constant contrast, and add only differences to the painting. Any still frame is painted pixels. Measure the painted marks first (here 1-1.5 art px tall, 20-40 long, +-5 levels) and stay at that scale. Moving the soft pillars with their clouds turned them into pale blobs, so they stay and only sway. Both the newly painted marks and the near-static versions were rejected.

**Round 6, what was kept: the round 3 water plus rows of wave crests, all moving one way.** Ripples drawn over the painting, in any form, were rejected: near-still painted-scale marks read as nothing happening, and ripple layers drifting left and right looked jittery. Moving ripple fields on the calm plate didn't save them either. What was picked (not perfect, but far better, then locked as good enough) is the round 3 engine over the calm plate (marks on sliding sheets, cloud columns, gust patches) with rows of crests rolling toward the shore: spaced in log depth (about 28 art px apart at the shore, 10 mid sea, faded out where closer than a few screen px), each a thin pale line with a darker face on its shore side, broken into pieces that belong to their crest and drift right with the wind. Kept faint: Wave strength .2, gust patches 2.5, water speed .85. Lessons: replace the painted water instead of drawing over it, keep every moving layer going the same way, and judge clips made from exact frames, because a real-time recording's compression hides water detail a few levels deep.

## Moving a painting's own marks: rejected in every form ([Straw Hat Cove](../../wallpapers/published/straw-hat-cove/README.md) middle water)

The far half of the lagoon is the painting itself, so its painted ripple marks stand still. A clean lift worked technically: painting minus the seabed plate tinted to the painting's colour gave 18.6k marks (light and dark) over a calm marks-free plate, at rest identical to the painting. Exclude anything near cut-out plants: the plate's hidden fills behind them drift out as coloured leaf shapes. Then three motions: each mark drifting and fading on its own, marks swapped in passing swell bands, and the whole mark layer flowing with two copies at constant contrast. About 1 % twinkle, and the middle moved as fast as the live near water. Rejected: it looked like bubbling. With Summer Crossing's round 5 and the earlier crossfaded copies, this closes the idea: a painting's marks can't be made to move by moving the marks. The static middle was kept as good enough.

## Preconditions that decide whether this works

- The concept needs calm water: little or no baked-in wave and light-line detail. A busy painted sea cannot carry added water effects. Check this before building, and ask for or generate a calm-water concept if it is not so.
- A caustic-free seabed plate that aligns with the painting. Check the alignment numerically and visually. Drifted plates were rejected.
- A fitted horizon and a water mask that excludes props and shore. Small shallow strips outside the mask stay static (beach rocks, ledge edge). Known limit in Straw Hat Cove.
- Do not spread the effect over the far sea. Let the painting take over past mid distance.
