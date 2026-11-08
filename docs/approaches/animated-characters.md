# Making a character move

Status: mixed. What happened every time a wallpaper needed a moving character, and the order to try things next time.

## What happened

| Character | Method | Verdict |
|---|---|---|
| Moon Cat sheet ghost | Blender cloth sim, toon render, frame atlas | Very well received. [Recipe](3d-cloth-sim-to-cel-sprite.md) |
| Golden Shallows crab | Painted cut-out parts with IK legs on the rock's silhouette. [Recipe](painted-cutout-creature-rig.md) | Looked very good, and the only added character kept in that scene |
| Moon Cat witch | One drawing, parts moved by simulated chains (rig notes in [motion-separate-layers-not-warps.md](motion-separate-layers-not-warps.md)), after primitive 3D humans were rejected as crude shapes | Shipped (Moon Cat, 2026-10-29) |
| Moon Cat cat | Codex head drawings | Blink and lick patches work. Big head moves failed every way: swaps pop, RIFE morphs |
| Rigid-jointed koi | Painted koi cut into head, two body pieces, peduncle, tail and four fins following a spine path, no warping | Read as fish (unreleased idea); needed grading, see below |
| Illustrated car | Downloaded model, EEVEE toon, rigid motion | Approved |
| Summer Cycle 0.3 | One fixed rider drawing, spinning wheels, no pedalling | Kept as a coast |
| Sonic, 3D rig on a painting | Good free rig, Cycles or toon | Rejected, then reduced to a sticker |
| Sonic, image-to-video | Wan 2.2 locally | Rejected: blurry, morphing |
| Kintaro, cut-out hybrid | Generated cel with code-drawn legs and bike | Rejected, despite perfect contacts |
| Kintaro, Snow rig | Real rig dressed as him | Pedals correctly, doesn't look like him (no verdict recorded) |

The pattern: wins came from authored motion rendered into one consistent look. Losses came from a subject that didn't match the painting's quality, whether it moved correctly or not.

## The order next time

1. **Does it need to change view or deform?** If not, use painted cut-out parts on rigid joints. That is cheaper and keeps the exact painted look. The crab never turned. A parallel image-to-3D and Blender crab was tried and rejected in the same review as the other right-side experiments, so the 2D rig is the evidence, not a measured comparison.
2. **If it does, get a real model first.** Check for a ready rig. If none matches the character, try [paid image-to-3D](../tools/image-to-3d.md) in one sitting with a credit cap. Build by hand or adapt another character last. Golden Boy spent its effort on the reverse order, and the paid test never ran.
3. **Test the character first.** One still, at real size, on the real painting, reviewed before any mechanics or scenery. Both projects found out late that the character was the problem.
4. **Then motion on a plain background.** Contacts come from data (pedal and grip targets per frame), with one travel value driving everything that rolls.
5. **Scene last.** Check water before any of this: a busy painted sea sinks the project whatever the character does ([water-on-painted-scenes](water-on-painted-scenes.md)).
6. **Passing checks and agent reviews prove nothing about the look.** One step at a time, with a picture after each.

## What paid image-to-3D doesn't do

It replaces the modelling step only. It won't pin feet to pedals, give ear or quill bones, or match a painting's shading, and thin parts (quills, spokes, hair strands) are its weak spot. A rider generated together with a bike can't pedal. Nobody has run a paid generation in this project yet, so its real hit rate here is unknown.

## Koi on a spine path

Painted koi cut into head, two body pieces, peduncle, tail and four fins follow a spine path with no warping, and read as fish. Sprites sitting in dark dusk water needed grading:

- Desaturate by 0.05-0.15 (so red and orange stay saturated), tint by whiteness (midtones 0.54 / 0.44 / 0.57, highlights 0.52 / 0.60 / 0.76) and mix toward the local water colour.
- Add a thin near-black ink rim from the sprite alpha to match the pads' outlines, a 1-2 px refraction wobble and slow light bands. Soft edges without an ink line next to crisp painted outlines are a visible style mismatch at 1:1.
- A first tint was too faint, the next made grey ghosts. Settle around white bodies at p85 luminance 79, against pad highlights 50 and open water 28.
- Give each fish a home area, apply separation at every depth and add a soft personal space. Closest head distance rose from 0.05 to 0.45 body lengths.
- Rigid-jointed pieces need overlap at joints so gaps do not open when they rotate.

## Process lessons

- Split a scene into a `scene.js` core plus `parts/*.js`, each part owned by one agent, before running parallel fixes. Run two independent read-only reviews and send each finding back to the part's owner.
- A reviewer or builder must not explain away a visible flaw. Look at what surrounds a fix.
