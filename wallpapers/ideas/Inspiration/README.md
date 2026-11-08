# Workshop study (2026-10-25)

What a set of well-liked Wallpaper Engine wallpapers actually do, and how ours differ.

Sources: 24 favourites from Wallpaper Engine's Cool folder plus 3 more Workshop items (1179162837, 833227004, 1583820008). For each one `project.json` and `scene.pkg` were read to list the objects, effects, particles, puppet models, sounds and text layers.

## What the liked wallpapers have in common

| | Count (of 27) | Examples |
|---|---|---|
| Built in WE's **scene editor** | 24 | everything except the 3 Abi Toads videos |
| **Video** (hand-animated loop) | 3 | Cozy Campfire, Star Ride, Mushling Dance |
| **Web** wallpaper, like ours | **0** | |
| One strong **subject or character** in focus | ~18 | Bloodborne, Hollow Knight, Fallen Paladin, last astronaut, relaxing robot, Moon Cat, The Lamb, Empress |
| Dark, moody, **one glowing accent** | ~14 | blue sword (Paladin), red Lamb, candles (Lady Maria), cyan tree (cosmic spring) |
| **Particles** (fog, embers, candles, fireflies, rain, leaves, birds) | 20 of 24 scenes | Lady Maria uses 43 candle systems and 6 fog layers |
| **Mouse parallax** (camera parallax or depth parallax) | 9 | Hollow Knight, Silent Fields, relaxing robot, Empress |
| **Puppet warp** (rigged character parts: breathing, arms, head) | 8 | Hollow Knight, Moon Cat, relaxing robot, Empress (7 rigs) |
| Local **masked sway/ripple** on painted parts (`waterwaves`, `foliagesway`, `waterripple`) | ~16 | Hollow Knight uses 25 small `waterwaves` regions |
| **Clock / date / day** on screen | ~10 | Silent Fields, Lost Landscape 2, relaxing robot, Misty Sea, Dystopic City Port |
| **Media info, audio bars, app dock** (utility overlays) | 5 | the two Seyul ones, Lost Landscape 2, Mordekaiser |
| **Ambient sound** option | ~12 | rain, wind, lofi |

### What this means for us

1. **We've been making scenery; the liked ones are subjects.** Almost all of our batch are wide, empty landscapes. The liked ones are mostly *one* figure or creature, lit by one glowing accent. That is the biggest lesson, and it costs nothing technically.
2. **Their motion is the cheap kind, done everywhere at once.** It's fog drifting, flames flickering, embers rising, a cape swaying, the character breathing and slight mouse parallax. Nothing is clever, but every part of the picture has a small life of its own. The local masked warps (`waterwaves` on a cloak, `foliagesway` on leaves) are fine there because they are small and confined to one part. Our rejected warps were global warps of the whole painting.
3. **Mouse parallax and a clock are common extras, but not wanted.** Neither is wanted here, so leave them out.
4. **Hand animation wins hearts.** The three video wallpapers have no effects at all, just charming frame-by-frame animation. We tried rigged cels for Summer Cycle and it never looked right. Not our strength; skip it.
5. **Scene editor vs web.** Everything above is built into the WE scene editor. We stay on web for now because the build, verify, media and release pipeline already works and it can be driven end to end from the command line. A scene-editor spike is worth an hour: prepare the layers (cut-outs, depth map, masks) and assemble them in the editor.

## What carries over

More particle and creature life (bats, ghosts, embers, small events) and one subject with one glowing accent, rather than wide empty landscapes.
