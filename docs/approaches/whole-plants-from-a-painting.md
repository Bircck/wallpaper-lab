# Moving plants in a finished painting

Status: built for [Summer Crossing](../../wallpapers/published/summer-crossing/README.md). At rest it flips almost identically with the painting, and tips sway 8-10 px with bases still. This version has not been judged yet.

## Problem

Cutting a finished painting gives only what's visible, so a blade behind a leaf ends at the leaf and fragments have no foot. Pieces rotating around their own centre read as not rooted to the ground, and hard cuts look obviously cut out. No amount of code fixes that, because the hidden parts don't exist in the source.

## What worked

1. **Codex repaints whole plants on flat #FF00FF, in depth layers.** 3:2 crops enlarged to 1536 wide. Ask for each plant whole, from tip to ground, including what the painting hides. Back, middle and front layers are separate edits, each with the layer in front removed.
2. **The repaint decides shape and hidden parts. The painting decides every pixel visible at rest.** This is the step that matters. Snap each layer's edge to the painted edge with a guided filter. Where a piece is visible and agrees with the painting, take the painting's own pixels. Where it's visible and disagrees (an invented stem across a leaf), take it out, and the painting stays there, still. Only what's hidden keeps the repaint's colours.
3. **Mesh bent from a ground line, one wind.** Bend grows with height above the root. Phase comes from position only, so neighbours stay in step. Gust fronts roll through with calm between them, and there's no fast term at all.
4. **Ground under what moves comes from Codex too,** with its low frequencies locked to the still painting around it. The reveal must be textured undergrowth lit like its neighbours. A smooth fill shows as pale ghost bands the moment a plant leans.
5. **Everything that lights the ground lights the plants.** Gust light and cloud shadow have to reach the pieces as well, per pixel or per mesh point. Light on the lawn alone makes dark plants pop forward, and one shade per piece leaves a straight step where wide pieces meet.

## What failed

| Tried | Result |
|---|---|
| 431 rigid pieces cut by SAM, rotating about a computed pivot | Cut-offs and mid-air pivots. Rejected: pieces appear to spin in mid-air. |
| Repaint used as is, composited over the plate | Rooted, but soft and dark in the corners, with invented stems and stencil-like clumps. Rest error against the painting 10-14 levels, down to 1-2 after step 2. |
| Trusting the repaint's outline in front of gravel and rail | Chunks and rims of stone moved with the plant (bad cuts where leaves overlapped track and rocks). Where the background isn't lawn, keep only what looks like plant in the painting, grow no rim there, and fill behind with the same background rather than undergrowth. |
| Small fast sway | Rejected as fidgeting. A fast term needs a reason, such as a train's wake, and its own slider. |
| Separate procedural grass blades over the lawn at rest | A pale haze that softened the lawn. Now only in an express wake, rising with the wake's front. Even there they read as hatch unless few, wide and coloured from the lawn at their root. |

## Check before calling it done

- Flip the frame at wind 0 with the painting. Measure the error by region, with untouched rails as the yardstick for what's only render sampling.
- Sample a long run at gust peaks and look at the worst lean. An automatic streak counter missed the ghost bands that the eye found.
- Track a few plant tips over seconds and count direction reversals: 0-1 in a gust means smooth.
