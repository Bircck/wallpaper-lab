# Other recorded approaches (short entries)

Short entries. Statuses: worked, failed, mixed.

## Parity snapshot before tweaking an approved look (worked)

Snapshot the approved build, then compare against it after every change. Changes that "only add" something can still shift the baseline.

- Straw Hat Cove: the approved build and the final build were each snapshotted, with checksums and the config used.
- `config.json` has a `baseline` lock: the build keeps the approved texture pixels wherever the new source equals the old one. With all new options off, the render stayed pixel-identical (0 px) to the snapshot at several times.
- Expect small noise: about 200 scattered pixels differing by 1/255 appeared after a larger shader was compiled. They were stable across runs and not visible. One run showed GPU run-to-run noise that a re-run did not repeat.
- Luminous used the same idea: exact no-gas parity checks at several times and aspect ratios, and "exact unchanged pixels outside cloud bounds" for each reveal study.

## [Living Print](../../wallpapers/published/living-print/README.md): cut-outs of original pixels (worked)

Hokusai's Lake Suwa (public domain) is cut into pines, reeds, bushes and a boat from the original pixels, then animated as separate layers. This followed the finding that dense generated art looked strongly AI-generated, which a layer tool cannot fix.

- Worked: OpenCV edge filtering and seeded GrabCut for the boat, region-constrained ink colour thresholds and manual silhouette review for pines, clean sky and lake donor patches for hidden areas. Water and sky are shader regions driven by masks, not extra cut-outs. An independent critique corrected ghost silhouettes, moving sky strokes, boat remnants and renderer alpha halos.
- Failed: rembg u2netp (whole-image foreground only, not a usable depth stack), GrabCut on pines (captured sky patches), broad Telea fills of pines (smeared navy into the sky).
- Limit: hidden fills are approximate, so keep canopy motion small (roughly 10 original px at most) and inspect motion extrema.
- Later detail: polygons plus ink-colour thresholds and donor patches from the print's own pixels cut the flat woodblock print. Pines bend on one shared gust clock (travelling waves looked wrong). A generated crane only fit after being recoloured to the print's ink and paper tones. A 2x upscale was skipped for the release.

## [Luminous Streams](../../wallpapers/published/luminous-streams/README.md): keep the original pixels, reveal and fog around them (mixed, shipped)

The wallpaper animates one generated nebula image in a shader and keeps the source pixels.

- Worked: a user-painted cloud coverage mask embedded as is; layering one cloud bank over a hidden background with exact still recomposition before adding atmosphere; "edge reveal" where bank edges retreat to show a generated hidden nebula plate (only inside marked regions, with inward feathering to remove harsh seams); fog that is occluded behind the dark cloud silhouette through the shared coverage mask (191445 masked pixels stayed exactly unchanged at fog 0.8); lighting as light and shadow on original pixels; dust picked from five particle directions at 40%.
- Failed: generated replacement clouds and drifting cut-outs (0.4), nearly invisible effects (0.5), global UV warp "jelly" (0.8), stretched adjacent-pixel backing for the reveals (replaced by a generated plate), and a fog that felt separate from the clouds.
- Contract that kept it honest: front layer = original minus plate x (1 - alpha), so zero effect reproduces the source exactly. Every round compared "effect off" against the approved render and measured that nothing changed outside the marked regions.
- Large shader time shows TV-like scanlines when a blend happens before a sine and accumulates spatial frequency, so test renders at time 1000 and 10000 too.
- Open: approximate bank contours; no whole-bank hidden-plate reconstruction was claimed.

## Variants in the lab, a few sliders in the release (worked)

For visual judgement calls, build two or three selectable versions in the lab with wide slider ranges and keep the baseline. After a version is picked, collapse to a few 0-100 sliders where 50 is the tuned look and 0 is off, and remove the variant buttons. Straw Hat Cove went from 41 properties to 12 this way. Wallpaper Engine's embedded browser crashed on `<select>` elements, so variants were cycling buttons in the lab panel. Slider design rules are in [look-and-motion-rules.md](look-and-motion-rules.md).


## Blender block-out, Codex paint-over, ID-guided SAM (mixed)

Idea: build a rough Blender layout, let the image model paint it, and use the Blender object IDs as SAM prompts.

- Worked: paint-over without a style reference follows the layout well. ID-guided SAM gave clean single-prompt cut-outs for 7 of 16 groups (straw hat, Chopper hat, compass, orange glasses, ashtray, green cloth, palm).
- Failed: with a style reference the paint drifted (larger props, moved table and swords). IoU of SAM vs the Blender ID was about 0.5 because the painter redraws shapes. Thin or shifted props, the vest, the bush and leaf blobs failed (the painter turned leaf blobs into rock islands).
- Next steps recorded there: leaf cards, local re-registration for thin props, then matting and footprint fills.

## Split by depth instead of per object (worked on the Straw Hat Cove veranda)

One near layer (veranda and every belonging) over live water over a far layer, using Depth Anything V2 Small, GrabCut on a depth trimap and a colour guided filter. Each cut then lies between wood and water, which separate cleanly by colour. Per-object SAM prompts on the same furniture gave fragmented masks.

## Illustrated driving: designed geometry, toon materials, authored motion (worked)

A neural redraw of a Blender render was not established, and a fixed-palette pixel filter made the render worse. What was strongly approved was a Blender car with native cel (toon) materials, a lower camera, scenery passing at 32 m/s, and a rotational shutter on the wheels. The front wheel's stuttering was fixed by true rotational exposure with body and road holdouts. The rejected predecessors (sliding sprites, frozen car on a scrolling road, plain procedural car) are listed in [motion-separate-layers-not-warps.md](motion-separate-layers-not-warps.md).

## Cut-out survey for the Straw Hat Cove props (worked, mixed per object)

Covered in [cutting-out-a-painted-prop.md](cutting-out-a-painted-prop.md). Short version: Finegrain first for small props, SAM2 for attached parts and corrections, matting only for real edge uncertainty, and check every attached part. Foliage and glass (the cola bottle) stayed unsolved by a single pass.
