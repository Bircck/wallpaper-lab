# Moving plants in a finished painting

Status: worked. The build that shipped in [Summer Crossing](../../wallpapers/published/summer-crossing/README.md) and was approved ("simple and clean") is the **clean-plate** one: a Codex ground plate with the plants removed, whole Codex plants drawn on top, and no painting pixels left in the ground. An earlier build that kept the painting's own pixels wherever a plant was visible at rest is described below as the first attempt; it is superseded.

## Problem

Cutting a finished painting gives only what's visible, so a blade behind a leaf ends at the leaf and fragments have no foot. Pieces rotating around their own centre read as not rooted to the ground, and hard cuts look obviously cut out. Painting pixels left in the ground double up under a moving plant. No amount of code fixes that, because the hidden parts don't exist in the source.

## What shipped: clean ground plus whole plants

1. **Codex repaints the ground without plants, and the plants whole on flat #FF00FF, in depth layers.** 3:2 crops enlarged to 1536 wide. Ask for each plant whole, from tip to ground, including what the painting hides. Back, middle and front layers are separate edits, each with the layer in front removed. For the ground ask for "dense lit meadow at its painted height". Some attempts came back as a mown lawn or all in shade; discard those that drift.
2. **Accept differences from the painting at rest.** Each Codex edit re-renders the frame. A repaint that agrees with the painting on only 84-93 % of visible plant pixels leaves painted plants standing still beside moving neighbours, so forcing every visible pixel to be the painting's was the wrong goal. Keep painting pixels only where Codex got something clearly wrong.
3. **Match Codex colour to the painting per material.** Lawn and gravel/dirt need their own curves; one shared curve turned gravel yellow. Match lightness by quantiles and only shift/scale colour: per-channel quantiles turned near-black teal maroon.
4. **Clean up the Codex drawing.**
   - Zebra bands (light and dark stripes across blades) are smoothed along each blade.
   - Blades traced in two layers get the same ground line, so a pair never parts.
   - Leaf tops that came detached from their stems became their own pieces, rooted in mid air at their own bottom edge. Give every such floating piece the ground line and seed of the plant under it (30 of 88 far weeds), so it moves exactly with that plant.
   - Flowers: a sheet of twelve identical clean heads set on stems looked too perfect. Redraw each head individually from a zoomed crop plus the painting at the same spot, in the painted pose (tilted, not facing straight out). Key on flat magenta only (alpha from the green channel over a 4 px edge, 1 px left pink); a looser key read lavender petal shading and tan rings as magenta and opened holes.
5. **Mesh bent from a ground line, one wind.** Bend grows with height above the root. Phase comes from position only, so neighbours stay in step. Gust fronts roll through with calm between them. One slow sway plus a slower drift (about 12 turns a minute at the tuned level) read well; a fast second sway frequency made plants stand still a quarter of the time and read as "right, left, still".
6. **Far elements move less than near ones.** Far weeds at 0.75-0.9 of the near amplitude. A lean from the root for a train's wake, not a sideways push of the upper half.
7. **Everything that lights the ground lights the plants.** Gust light and cloud shadow have to reach the pieces as well, per pixel or per mesh point. Light on the lawn alone makes dark plants pop forward, and one shade per piece leaves a straight step where wide pieces meet.

## Far trees and bushes

Moving the painting's own cut, or a Codex piece, as one warped mesh looked janky. What worked is the foliage method from Straw Hat Cove:

- About 197 leaf clumps (SLIC superpixels), each a rigid piece turning a little about its base. All follow one slow travelling sway weighted by height above the ground, with a faster rustle only in gusts, over an underlay of the plants' opaque inside moved by the same sway. No warping.
- Thin flowering weeds and tall tufts are a separate layer, whole to the root (88 pieces), on the near plants' bend code with a smaller amplitude so they don't move with the trees.
- Foliage moved by per-texel displacement in the shader (Straw Hat Cove, earlier) showed doubled edges and a glow. The shipped plants there are rigid pieces with a tip bend, in a separate pass with a root map pinning ground contact.
- For crowns over a painted sea, see [water-on-painted-scenes.md](water-on-painted-scenes.md): anything painted into the sea at the crowns' rest spots stays behind as specks.

## What failed

| Tried | Result |
|---|---|
| 431 rigid pieces cut by SAM, rotating about a computed pivot | Cut-offs and mid-air pivots. Rejected: pieces appear to spin in mid-air. |
| First build: repaint decides shape and hidden parts, the painting decides every pixel visible at rest (guided-filter edge snap, painting pixels kept wherever they agree) | Rest error against the painting 1-2 levels, but painting pixels left in the ground doubled under moving plants and some plants read as not rooted. Replaced by the clean-plate build. |
| Repaint used as is, composited over the old plate | Rooted, but soft and dark in the corners, with invented stems and stencil-like clumps. |
| Trusting the repaint's outline in front of gravel and rail | Chunks and rims of stone moved with the plant. Where the background isn't lawn, keep only what looks like plant in the painting, grow no rim there, and fill behind with the same background rather than undergrowth. |
| A smooth fill under the moving plants | Pale ghost bands the moment a plant leans. The reveal must be textured undergrowth lit like its neighbours, with low frequencies locked to the painting around it. |
| Small fast sway | Rejected as fidgeting. A fast term needs a reason, such as a train's wake, and its own slider. |
| Separate procedural grass blades over the lawn at rest | A pale haze that softened the lawn. Now only in an express wake, rising with the wake's front; even there they read as hatch unless few, wide and coloured from the lawn at their root. |

## Check before calling it done

- Flip the frame at wind 0 with the painting. Measure the error by region, with untouched rails as the yardstick for what's only render sampling. Expect the clean-plate build to differ from the painting at rest; judge it by eye on the full frame, not by forcing the error to zero.
- Sample a long run at gust peaks and look at the worst lean. An automatic streak counter missed the ghost bands that the eye found.
- Track a few plant tips over seconds and count direction reversals: 0-1 in a gust means smooth.
- Look at what surrounds a fix. A reviewer who calls a visible colour step a debug artefact, or misses a broken headland beside a checked pole, costs a round.
