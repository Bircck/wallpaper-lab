# Wind, weather and ambient life on painted scenes

What worked and failed for gusts, cloth, steam, mist, lightning, a lighthouse beam and fish, mostly from three night scenes (Rain Lantern Alley, Lighthouse Night, Koi Garden; all shelved but well tested) plus Golden Shallows and Summer Crossing. Taste rules are in [look-and-motion-rules.md](look-and-motion-rules.md); plant and tree rigs in [motion-separate-layers-not-warps.md](motion-separate-layers-not-warps.md) and [whole-plants-from-a-painting.md](whole-plants-from-a-painting.md).

## One cause for everything: a gust schedule

- Drive rain slant, lantern swing, curtain, leaves, steam, mist and cloud speed from one gust schedule. Rain Lantern Alley: one gust per 60 s window, 9-12.5 s long, plus a breeze at one third strength halfway between.
- Without a visible event between gusts the scene felt as still as its first version. Raising the lantern's always-on sway from about 2.5 to 4 degrees helped.
- A lantern as a damped pendulum (period 3.9 s) reads naturally after a gust.
- **Branches:** two fixed sines are a metronome that never rests. Use a deterministic gust schedule (rise 1.5-3 s, hold 0.4-1.6 s, fall 1.6-3.6 s, one every 15-37 s) driving three damped modes, read with a lag that grows from the root plus per-x phase. Calm then stays calm (tip within 0.6 px of rest 71% of the time).
- **Tree crowns (Golden Shallows):** a damped spring per crown (0.38-0.85 Hz, damping 0.22), gusts about every 17 s arriving from the sea side with a 2-4 s travel delay. Bend grows as height^1.5 and is soft-capped with tanh at 0.4 rad (past about 20 degrees a bend smears a crown into streaks). Heavier masses use 0.2-0.32 Hz. Integrate at 240 Hz, with `seek(t)` re-integrating the last 25 s so frames stay deterministic.

## Amplitudes that count as no motion

At 1080p these were invisible: leaf stir 0.5 px, curtain breath 0.6 px, pad bob 0.7 px (98 s period), a 1.5 px firefly core, lamp-light drift 0.4 levels.

What worked instead:

- Curtain hem travel 2-3 px with a different phase per panel.
- A koi pushing a pad up to 6.5 px, with a critically damped return over about 5 s and one ring.
- Fireflies 1.7x larger with 8-20 s glow cycles, up to 14 of 20 paths.

## Cloth

Cloth cut from a flat image and sheared from the rod moves as parallelograms with a straight hem. What read as cloth at wallpaper distance: a different phase per panel, a wave running down the cloth, a rippling hem (sample row shifted by a lift) and a 0.3 s trail between neighbouring panels. For heavy cloth see [3d-cloth-sim-to-cel-sprite.md](3d-cloth-sim-to-cel-sprite.md).

## Steam and mist

- Noise-threshold steam looked like chalk dust. A Codex strip in front of a curtain looked like a grey smudge. Four constant-width strands read as drawn ribbons, and as scratch lines in a gust.
- **Worked:** wisps that widen from about 2.6 to 13 px and dissolve over about 70 art px, lean capped near 11 degrees. Keep steam wide and soft; thin plumes looked like smoke from a cigarette (Luminous Streams).
- Paint soft layers on a plain canvas instead of segmenting them: see [clean-plates-and-edge-unmixing.md](clean-plates-and-edge-unmixing.md).
- Mist belongs only behind the far wall (x 585-745 there) and thinned over foliage; otherwise it smears nearer walls.
- Ask for dark space above a steam source when generating the concept.

## Lightning

An additive flash to the sky tripled it and made it look like day. A multiplicative lift of the sky mask at about half strength, very rare (about every two minutes), kept clouds and mountains as dark shapes. In a painted puddle apply the flash once at the end by sky colour test times the puddle mask so painted and mirrored reflections are lit alike ([water-on-painted-scenes.md](water-on-painted-scenes.md)).

## Lighthouse beam

- A thin laser looked wrong; a facing beam blew out the tower.
- **Worked:** a wide soft cone (radius 0.018 + 0.15 s, fade exp(-0.55 s)/(1 + 1.2 s)) that fades into a glare between facing 0.90 and 0.98, with water glints only at mid distance.
- Integrate the beam phase per frame so a slider change never makes it jump.
- A boat slot every 150 s with 65% chance (80 s crossing) gave the scene a second event.

## Koi and swimming creatures

- Rigid pieces on a spine path (head, two body pieces, peduncle, tail, four fins) read as fish without warping; see [animated-characters.md](animated-characters.md). Overlap pieces at joints so gaps do not open when they rotate.
- **Behaviour:** give each fish a home area, apply separation at every depth and add a soft personal space. Closest head distance rose from 0.05 to 0.45 body lengths, and fish spread over both halves of the pond instead of clustering.
- **Grading in dark water:** desaturate 0.05-0.15 (so red and orange stay saturated), tint by whiteness, mix toward the local water colour, add a thin near-black ink rim from the sprite alpha, a 1-2 px refraction wobble and slow light bands. A faint first tint was followed by a tint that made grey ghosts; the settled target was white bodies at p85 luminance about 79 against pad highlights 50 and open water 28.
- Koi on a flat colour background need no segmenter: see [clean-plates-and-edge-unmixing.md](clean-plates-and-edge-unmixing.md).

## Falling leaves

Rotational circulation (CR = 2 pi) is what made a falling plate flutter; Blender rigid body and cloth have no aerodynamic lift or torque, so a leaf simulated there falls like a stone or a rag. Details for the Moon Cat leaf are in [motion-separate-layers-not-warps.md](motion-separate-layers-not-warps.md). In Golden Shallows, leaves blown by a gust were rejected as added life ([look-and-motion-rules.md](look-and-motion-rules.md), rejected extras).

## Checks

- Test the look at shader time 1000 and 10000 as well as at the start. A blend before a sine or before advection accumulates spatial frequency and shows tight scanlines after long uptime.
- Judge a gust at its peak and at the lightning flash with boosted 1:1 crops, where halos and seams show.
- Shared-GPU timing is unreliable: Koi Garden measured 1.7-3 ms on a quiet GPU and 8-18 ms while other jobs ran.
