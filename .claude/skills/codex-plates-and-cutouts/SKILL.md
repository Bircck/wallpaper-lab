---
name: codex-plates-and-cutouts
description: Use when a painted scene in this repo needs a clean plate, a prop removed or added, a background layer (sky, seabed), or an object cut out for animation. Points to the tested recipes and scripts; pick per object, don't treat it as a fixed pipeline.
---

# Codex plates and cut-outs

Read before starting:
- [Codex image generation](../../../docs/tools/codex-image-generation.md): prompt shapes that worked, `codex exec` gotchas, compositing only the changed region.
- [Clean plates and edge un-mixing](../../../docs/approaches/clean-plates-and-edge-unmixing.md): the exact plate behind a moving prop, un-mixing edge colours.
- [Cutting out a painted prop](../../../docs/approaches/cutting-out-a-painted-prop.md) and [cut-out segmenters](../../../docs/tools/cutout-segmenters.md): segment an upscaled crop, never the full scene; Finegrain first, SAM 2.1 where it drops a part; what was tested and worse.
- [Sky matte at a fitted horizon](../../../docs/approaches/sky-matte-at-a-fitted-horizon.md) for partial mattes.
- Scripts: `docs/tools/cutout/` and `docs/tools/codex/`. Environments and model downloads: [python-environments](../../../docs/tools/python-environments.md).

## Always
- Check every cut at 4x on a checkerboard and on magenta, including each attached part, against what a careful 10-second manual cut would give.
- Moving cut-outs need a filled plate behind them, and fixed roots or contact points.
- Show the person the cut on a checkerboard plus a before/after composite.
