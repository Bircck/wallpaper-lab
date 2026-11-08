# Local preview server and the texture cache problem

## Run it

From the repo root, either:

```
./wl serve                                          # port 8861, no caching, also serves directory listings
python -m http.server 8861 --bind 127.0.0.1         # plain alternative
```

Then open `http://127.0.0.1:8861/wallpapers/<stage>/<slug>/package/index.html`, or the gallery at `http://127.0.0.1:8861/docs/tools/gallery/`.

Serve from the repo root: many pages use relative paths that climb out of their folder. Pages that `fetch()` local JSON need a server or Wallpaper Engine; `file://` fails. The verification scripts default to `ORIGIN=http://localhost:8861/` (override with the `ORIGIN` env var).

If a port is already taken, `wl serve` stops and says so; pick another port (`./wl serve 8862`). Stop servers you started when you are done.

## The caching problem

`python -m http.server` sends `Last-Modified` but no `Cache-Control`. Browsers then reuse textures from cache heuristically, so after a rebuild a normal refresh can show old `.png`/`.webp` files while the new `scene.js` runs (mismatched, or "the fix did not work"). Quick fixes: use `./wl serve` (it sends `Cache-Control: no-store`), Ctrl+Shift+R, DevTools "Disable cache", or the pattern below. (The exact cause is inferred from the symptom and the fix, not from a header capture.)

## Pattern in the repo: `?v=<time>` on localhost only

In `wallpapers/published/straw-hat-cove/package/index.html`:

```js
window.BUST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '?v=' + Date.now() : '';
document.write('<script src="scene.js' + window.BUST + '"><\/script>');
```

and `scene.js` appends `BUST` to every image and JSON load (`const BUST = window.BUST || ''`, `i.src = src + BUST`, `fetch('scene/scene.json' + BUST)`). Inside Wallpaper Engine the hostname is not localhost, so the plain paths are used and nothing changes in the shipped runtime.

To reuse: copy those two lines and add `BUST` to each load call, or just develop against `./wl serve`.

## Other notes

- Headless Playwright runs start a fresh context, so they are not affected by the cache.
- `?clean` hides a tuning panel on some wallpapers; others show a panel only with `?preview=1`. For screenshots use the clean mode.
- Pages that make many requests can be much slower on `localhost` than on `127.0.0.1` (the gallery took 2.4 s against 0.08 s). The cause wasn't confirmed; probably a failed IPv6 try on each new connection.

See also [approaches/local-preview-caching.md](../approaches/local-preview-caching.md) and [headless-and-host-verification](headless-and-host-verification.md).
