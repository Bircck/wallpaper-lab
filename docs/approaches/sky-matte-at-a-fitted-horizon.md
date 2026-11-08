# Sky matte at a fitted horizon

Status: worked (one bug found and fixed in review). Used in [Straw Hat Cove](../../wallpapers/published/straw-hat-cove/README.md) (`package/scene.js`).

## Problem

The clouds drift over a clean sky plate, and the foreground (jungle, leaves) is drawn over them through a matte. The matte is stored only above the fitted horizon line. Below the line the same channel (`fx-c.r`) holds another mask (the cloth water weight, which is 0 behind the jungle).

The fitted horizon is tilted and runs behind the jungle on the right. A plain bilinear tap near the line mixed in the 0 texels below it. The matte then read as "background" for the bottom of the cloud strip, so clouds showed through along that row as white dashes about 100 px below the top on the right.

## What worked

In `skyMatte` (`mtTexel` and `skyMatte` in `wallpapers/published/straw-hat-cove/package/scene.js`):

- Sample the matte by hand with four `texelFetch` taps and the same bilinear weights.
- For each tap, compute the horizon row at that texel's x (`uHorA + uHorB * x`). If the texel is on or below the line, or in the last row above it, return 1 (foreground) instead of reading the texture.
- Everything below the horizon is foreground by definition, so no stored value is needed there.

Edge colours of the foreground over the cloud are un-mixed in the shader as `F = (I - (1-m)*B0) / m`, where B0 is the sky as painted behind the foreground, baked into `fx-a` rows 0-139. At zero cloud drift this reproduces the source exactly.

Result: 0 dash pixels at 5 test times. The frame changed only within 2 px of the horizon (left sea horizon at most 25/255 on 21 px).

## What failed

- Plain bilinear filtering of a matte that is stored only on one side of a boundary, where the other side holds unrelated data. The same bug appears for any packed channel: a filter across a region edge mixes in the neighbour's meaning.
- The matte itself was fine above the line. Only the lookup at the boundary was wrong.

## Rule of thumb

If a mask is stored on only part of the image, the filtered lookup must substitute the known value for texels outside that part (here, foreground = 1) before filtering. Check the lookup at the boundary at several times with the clouds moving.

## Related

Clouds are a long RGBA strip drifting one way over the clean sky plate (Codex-painted real RGBA clouds with soft alpha, no segmentation). The sine-sway clouds of the first build and the "behind foliage" variant were replaced by it.

Code: [scene.js](../../wallpapers/published/straw-hat-cove/package/scene.js) (search `skyMatte`).
