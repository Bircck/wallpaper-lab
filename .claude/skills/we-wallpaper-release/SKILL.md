---
name: we-wallpaper-release
description: Use when turning a web/WebGL scene in this repo into an installable Wallpaper Engine wallpaper, or when installing, verifying or preparing one for release. Points to the runtime rules, checks and release steps; adapt them, don't follow them blindly.
---

# Packaging and releasing a Wallpaper Engine web wallpaper

Read these first; they hold the details and the numbers:
- [Kit TEMPLATE.md](../../../docs/tools/web-wallpaper-kit/TEMPLATE.md): Wallpaper Engine runtime rules (property listener, FPS limiter, pause, sliders, plain image files, startup).
- [Releasing a wallpaper](../../../docs/approaches/releasing-a-wallpaper.md): finish pass, approval targets, checks, preview GIF, media, listing, publishing.
- [Headless and host verification](../../../docs/tools/headless-and-host-verification.md) and [shrinking a finished WebGL wallpaper](../../../docs/approaches/shrinking-a-finished-webgl-wallpaper.md).
- `./wl verify | gif | media | package | install | probe` ([tools/README.md](../../../tools/README.md)).

Smallest complete examples to copy from: `wallpapers/published/sunroom/package/` and `wallpapers/published/opaline/package/`.

## Agent rules
- Install into the local Wallpaper Engine only when the person asks. Keep the existing install folder name (`tools/wl-defaults.json`) so saved slider values survive.
- Never publish to the Workshop or touch a Workshop item. The person publishes from the Wallpaper Engine editor.
- Don't pop windows on the person's desktop to test auto-pause; ask them instead.
- Show frames and clips, not descriptions. The person signs off after viewing it in Wallpaper Engine.
