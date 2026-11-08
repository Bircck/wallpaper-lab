# A genuinely fast vehicle on a painted scene

Status: built for the [Summer Crossing](../../wallpapers/published/summer-crossing/README.md) express, with a painted version that melted the slats in the fast strip only (horizontal lines along the blur stay sharp and read as a comb). The express and its wake were accepted. The slow local with the same blur was too blurry, so this recipe is for fast vehicles only: a slow painted train should stay crisp. A code-drawn freight at 65 km/h was rejected, because at that speed you can see it is flat.

## Problem

Earlier speed attempts read as slow: Cloudsea's sliding sprites failed because the perceived road speed was too low. A painted vehicle at a realistic speed crosses the frame in well under a second, which leaves 15-20 frames at 30 fps and jumps of about 90 px per frame.

## What worked

1. **Work out real speed from the painting's scale.** A 20 m car spans 1270 art px, so about 63 px/m. 147 km/h is 2600 art px/s, and the nose crosses the frame in 0.64 s.
2. **Blur over one whole frame of travel, measured from the real frame time.** 14 taps along the direction of travel. With a full-frame shutter there's no strobing or wagon-wheel effect from the windows, at 30 or 60 fps. Pre-blurring the sprite by a few px and storing it at 1 texel per art px in x makes it small: 10 MB for a head car and a middle car.
3. **Bold, horizontal design.** Stripes survive the blur and windows melt into a band. Doors and car ends become soft dark blocks that step along, and that step is what you read as speed. Fine detail doesn't matter, so a code-drawn train is enough until someone slows it down.
4. **Tile from a head car and a middle car,** indexed from the nose backward, mirroring the head for the tail. Direction of travel comes free.
5. **Anticipation and aftermath carry as much as the pass.** Lamps, then the gate comes down, then a beat, then the train. Afterwards the grass whips and recovers, wires ring, dust hangs. Drive it all from one wake function of x and time, so the reaction runs along the frame with the train.

## See-through windows

Making the glass of a painted train partly transparent lets the real scene pass behind it (sea, headland, pole), which costs nothing and removes the "painted sea travelling with the train" flaw. It only works when the windows were painted see-through at the true horizon height, as Codex did here. Seats and frames stay opaque, and a Codex ghost inside one window had to be removed by hand.

## Seat it on the rail

A side-on sprite that floats a few px off the near rail reads as pasted. Measure the rail rows from the painting. Also darken what's visible between the bogies: the sun can't reach under a train.
