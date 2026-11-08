# A painted cut-out creature with IK legs

Status: worked. The Golden Shallows crab was judged to look very good and is the only added character from that scene that was kept. It is a small shore crab (about 40 px wide at 1080p) that walks over a rock, waves and walks back down behind it. The rig never turns, so the method is for a creature seen from one side that needs no change of view. For a character that must turn or has secondary motion, see [animated-characters.md](animated-characters.md) and [3d-cloth-sim-to-cel-sprite.md](3d-cloth-sim-to-cel-sprite.md).

Result: [Golden Shallows](../../wallpapers/published/golden-shallows/README.md). Related: [cutting-out-a-painted-prop.md](cutting-out-a-painted-prop.md), [clean-plates-and-edge-unmixing.md](clean-plates-and-edge-unmixing.md).

## Recipe

1. **Paint a parts sheet, not a crab.** One Codex generation with the painting and a 3x crop of the rock attached as style and light references, on a flat background colour (here the teal-grey `#6E8A8C`). The sheet holds 19 separate pieces: body, 2 claws, 8 upper and 8 lower leg segments. Because each piece is painted alone, no joint area needs inventing, and nobody has to separate overlapping legs and paint what they hide. Two whole-crab front views were generated alongside as pose and style references only. All three came out in the scene's style first time.
2. **Cut each piece on its own crop.** Finegrain on each piece, cropped and resized to 1024, next to a key on the flat background colour. The two differed by 1-2 % of alpha on average, but Finegrain faded one eye to 0.3, so alpha = max(Finegrain, key). Nothing else was missing, so SAM was not needed. Un-mix edge colours against the known flat background (see [clean-plates-and-edge-unmixing.md](clean-plates-and-edge-unmixing.md)); on a flat key there is no coloured fringe. Pack into a 512 px atlas with straight alpha and colour bled under alpha 0 so mipmaps have no dark edges.
3. **Place joint caps by geometry.** Codex painted pale socket discs at every joint, which read as a puppet. A colour search for them also caught the golden rim light on the shells. Instead, place caps from each segment's principal axis, with shoulders and body sockets placed by hand, and darken cream pixels within one cap radius to joint brown. The body keeps four dark socket rings and the legs cover them.
4. **Repaint proportions in the rig.** The painted upper segments came out stubby. Draw them 1.55x longer and 0.7x thinner, and the lower ones 1.12x longer. Do this in the rig rather than asking for another generation.
5. **Rig it.** Body and claws are rigid. Each leg is a two-segment chain solved by IK, hips behind the body's edge. The rules that removed every visible glitch:
   - **Fixed knee side.** Each knee always bends the same way, like a real joint. Choosing "the higher knee" flips sides when a leg swings near vertical (a 13 px jump at 1080p).
   - **Gait phase from distance walked.** Feet never slide. Two alternating groups of four legs, stance 60 %, lift about 1.5 px.
   - **Whole half strides.** Every scuttle covers a whole number of half strides, so all feet are down when it stops.
   - **Keep each foot at least 30 % of the leg length out from its hip.** A foot under the hip folded the leg to its minimum length and swung a knee 8 px in one frame. Set the stance spread per act so no trailing foot lands there.
   - **Walk in and out.** Entering and leaving must use the same gait. A crab that slid up and down behind the rock with still legs was the first thing rejected. Body depth is a function of distance walked, and each foot is planted at the depth the body reaches at the end of that foot's stance (reaching up and pulling on the way up, reaching down behind the rock on the way out).
   - **Lean the body** a little with each start and stop, and give the pauses something to do (a claw picking at the rock). A wave that dips first, overshoots by about 4 % and then waves twice reads as intended.
6. **Composite it with the painting's own silhouette.** The crab is a small sprite pass (about 20 quads from the atlas, drawn only during the event). The rock hides it: rock = not water in the existing water mask, inside that rock's bounding box, so no new occluder art is needed. While the crab stands on top, look the mask up 1.5 px higher so near feet and legs can sit just in front of the silhouette; while it is behind, cut exactly at the silhouette. Hide it 3 px deeper than looks necessary, because soft mask tails let 8-10 pixels through at 1/255. A faint contact shadow on the rock's top is optional (too faint to see at 1x here).
7. **Grade it to the light.** The parts came out brighter and redder than the scene. A backlit rock took a darker grade (saturation 0.65, channel multipliers 0.7 / 0.64 / 0.64); a sunlit slope took 0.85 with 1 / 0.84 / 0.74. On the sunlit slope the crab then read as orange-red against grey-green water (saturation 0.52 against 0.11 behind it).

## Choosing the spot

Test the spot at 1x before animating anything.

- A dark crab against a dark forest reflection on the big boulder's crest was a speck at 1080p. At 3x it read, which is why a zoom-only check is not enough.
- A low dome rock with pale water behind it read at 1x, and was tall enough (47 px) to hide the whole crab.
- A second act on the sunlit slope of the big boulder worked once the grade was warmer and lighter. A second act reusing the rig needed only its own spot, direction, scale, grade and foot spread, and changed the first act by 0 bits.
- On a rounded rock, a tilted body can lift an eye over the edge while it should be hidden. Hide deeper, and keep the path on the flatter top. On a rock with steep sides, legs can dangle in mid-air: lower the body and lengthen the legs.
- A wave raised 105 degrees was invisible (the claw reached face height and did not break the silhouette); 118 degrees with waves of 14 degrees worked; 140 degrees tipped back over the shell.

## Checks

Check the rig numerically instead of by eye. Sample the joints at 120 Hz through a pose hook and report:

- knee flips (target 0) and the fastest knee move per 1/30 s (under 5 art px was fine);
- the largest foot or knee step between samples (about 1-2 art px per 1/120 s means no leg pops);
- the longest reach as a fraction of leg length (up to about 1.15 where feet reach down behind the rock; otherwise stay under 1);
- planted-foot drift (0 px on a slope);
- a frame difference against a frame without the crab while it is meant to be hidden (0-1 changed pixels at the start and end);
- that the first act's frames are unchanged when a second act is added.

Then judge motion from frame strips at 15 fps (climb, darts, wave, exit) plus a real-time clip. Joint numbers do not replace watching it.

## Known limits

- No reflection of the crab and no ripple when it goes down behind the rock.
- Always the same path over the same rock; a second direction or rock makes repeats less obvious.
- One rigid front view: the legs are eight copies of two painted segments, stretched.
- It is small. The peek is only the eyes (about 2 px) and the wave is a small bump, so a viewer not looking at that rock mostly sees "something walked over the rock". A rare event tied to a rock in the painting was accepted where unrelated added characters (beach walkers, a boat) were not; see the rejected extras in [motion-separate-layers-not-warps.md](motion-separate-layers-not-warps.md).
- A parallel attempt with image-to-3D and Blender was rejected in the same review, so the 2D rig is the evidence, not a measured comparison.
