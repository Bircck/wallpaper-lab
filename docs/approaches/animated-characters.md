# Making a character move

Status: mixed. What happened every time a wallpaper needed a moving character, and the order to try things next time. Short notes: [stopped projects](../../wallpapers/ideas/stopped-projects.md).

## What happened

| Character | Method | Verdict |
|---|---|---|
| Moon Cat sheet ghost | Blender cloth sim, toon render, frame atlas | Very well received. [Recipe](3d-cloth-sim-to-cel-sprite.md) |
| Golden Shallows crab | Painted cut-out parts with IK legs on the rock's silhouette | Looked very good |
| Moon Cat witch | Drawn shapes and chain-bent parts, after primitive 3D humans were rejected as crude shapes | Shipped |
| Moon Cat cat | Codex head drawings | Blink and lick patches work. Big head moves failed every way: swaps pop, RIFE morphs |
| Illustrated car | Downloaded model, EEVEE toon, rigid motion | Approved |
| Summer Cycle 0.3 | One fixed rider drawing, spinning wheels, no pedalling | Kept as a coast |
| Sonic, 3D rig on a painting | Good free rig, Cycles or toon | Rejected, then reduced to a sticker |
| Sonic, image-to-video | Wan 2.2 locally | Rejected: blurry, morphing |
| Kintaro, cut-out hybrid | Generated cel with code-drawn legs and bike | Rejected, despite perfect contacts |
| Kintaro, Snow rig | Real rig dressed as him | Pedals correctly, doesn't look like him (no verdict recorded) |

The pattern: wins came from authored motion rendered into one consistent look. Losses came from a subject that didn't match the painting's quality, whether it moved correctly or not.

## The order next time

1. **Does it need to change view or deform?** If not, use painted cut-out parts on rigid joints. That is cheaper and keeps the exact painted look. The crab never turned, and 3D added nothing there.
2. **If it does, get a real model first.** Check for a ready rig. If none matches the character, try [paid image-to-3D](../tools/image-to-3d.md) in one sitting with a credit cap. Build by hand or adapt another character last. Golden Boy spent its effort on the reverse order, and the paid test never ran.
3. **Test the character first.** One still, at real size, on the real painting, reviewed before any mechanics or scenery. Both projects found out late that the character was the problem.
4. **Then motion on a plain background.** Contacts come from data (pedal and grip targets per frame), with one travel value driving everything that rolls.
5. **Scene last.** Check water before any of this: a busy painted sea sinks the project whatever the character does ([water-on-painted-scenes](water-on-painted-scenes.md)).
6. **Passing checks and agent reviews prove nothing about the look.** One step at a time, with a picture after each.

## What paid image-to-3D doesn't do

It replaces the modelling step only. It won't pin feet to pedals, give ear or quill bones, or match a painting's shading, and thin parts (quills, spokes, hair strands) are its weak spot. A rider generated together with a bike can't pedal. Nobody has run a paid generation in this project yet, so its real hit rate here is unknown.
