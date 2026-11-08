# A genuinely fast vehicle on a painted scene

Status: shipped in [Summer Crossing](../../wallpapers/published/summer-crossing/README.md). The express uses this recipe, with a painted version that melted the slats in the fast strip only (horizontal lines along the blur stay sharp and read as a comb). The same full blur made the slow local too blurry, so the local shipped with a tiny blur, a soft bob and turning wheels: see [A slower painted train](#a-slower-painted-train-the-local) below. A code-drawn freight at 65 km/h was rejected, because at that speed you can see it is flat.

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

## A slower painted train (the local)

- Keep the blur tiny: shutter 0.08 of a frame's travel plus a 0.3 sharpness mix. A shutter of 0.35 read as too blurry. A slow local at 360-520 art px/s was accepted at 440.
- Side-on bob should be slow and soft. A 1 px jittery bob read as wrong.
- **Turning wheels.** Painted discs are plain, so rotating their own paint shows nothing. What worked: a Codex edit with the wheels magenta (a mask of where a wheel shows between frame and axle boxes, aligned to 0.2 px), then a second edit with the frame removed and whole wheels painted with uneven rust and brake dust. Fit the painted wheels as ellipses (under 1 px off), keep only the marks of the clean wheels (difference from the light ring, web only), add them to the painted disc and turn them at the rolling speed (about 2 turns/s), blurred over one frame's turn (about 25 degrees at 30 fps). Use marks at 4x Codex's contrast but less colour (full colour tinted the discs blue). A kymograph (angle across, one row per frame) verifies steady streaks, no reversals and the right direction.

## Lighting and scheduling

- Shade a train pixel with the cloud shadow of the ground at its foot, not at its own screen height. Otherwise a body just below the horizon samples the far sea's shadow and shows thin squashed bands sliding sideways ("water on the train"). Whole-column shadows are the accepted limit.
- Schedule trains as per-kind forward chains with at least 6 s quiet between events. A speed change mid-pass keeps the position.
- In a frame-driven rig, a slider drag that calls a "reschedule" restarting the loop with a zero time step freezes the scene (0.02x real time while dragging). Leave a running loop alone and rescale only the wait still to come.
- Shipped in Summer Crossing: the painted six-car express at 2600 px/s with shutter 1, and the slow local above.
