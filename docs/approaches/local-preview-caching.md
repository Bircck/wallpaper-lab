# Local preview caching (stale textures)

Status: worked (small fix, used in Straw Hat Cove only so far).

## Problem

Previews are served with `python -m http.server <port>` from the repo root. That server sends no cache-control headers, so the browser may reuse cached copies of `scene.js` and the texture files across a normal refresh. After rebuilding textures (`build.py`, `fix_chopper_cut.py` and so on) the preview then shows the old art or the old shader, and checks of "the fix" look at stale files. This cost time during the Straw Hat Cove hat work.

## What worked

[Straw Hat Cove's `package/index.html`](../../wallpapers/published/straw-hat-cove/package/index.html) sets a cache-busting query on localhost only:

```js
window.BUST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '?v=' + Date.now() : '';
document.write('<script src="scene.js' + window.BUST + '"><\/script>');
```

`scene.js` appends `BUST` to every texture URL (`i.src = src + BUST`) and to the `scene.json` fetch. Wallpaper Engine loads from a file path, not localhost, so `BUST` is empty there and the plain paths are used. A normal refresh in the local preview now always loads fresh files.

Other ways that also work:
- Hard refresh (Ctrl+Shift+R) after every change. Easy to forget.
- A tiny dev server that sends `Cache-Control: no-store` instead of `python -m http.server`.

## What to do for new wallpapers

Copy the snippet above into the new `index.html` and apply `BUST` to every loaded asset. Only [Straw Hat Cove](../../wallpapers/published/straw-hat-cove/README.md) has it today. This is a suggested shared pattern, not yet a shared file.

When a "fix" does not show in the browser, check this first, before debugging the code.

Code: [index.html](../../wallpapers/published/straw-hat-cove/package/index.html), [scene.js](../../wallpapers/published/straw-hat-cove/package/scene.js) (search `BUST`).
