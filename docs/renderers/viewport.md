# Video aspect ratios and resizing

The comment layout keeps its configured coordinate system (normally 1920×1080). The output is scaled uniformly by height, centered horizontally, and clipped to the visible surface. This preserves glyph shapes, native font sizes and CA line spacing when showing a 4:3 video. A 4:3 surface exposes the central 1440×1080 logical area; it no longer shrinks the whole comment stage into a 16:9 box inside the video. Content deliberately authored across the full 16:9 width can therefore be clipped on a 4:3 video, rather than distorted or automatically reduced.

Canvas and CSS mode share `ctx.viewport.width` and `offsetX`. Fixed comments remain centered. Scrolling comments keep their existing speed and trajectory, including `@逆`; wide surfaces extend timeline visibility on both sides without changing collision lanes. The largest visited width is retained in the timeline so narrowing and widening does not duplicate comments. Extra timeline ranges are bounded to 120 seconds per side, including extreme host sizes.

```js
const canvas = document.querySelector('canvas');
canvas.width = 1440;
canvas.height = 1080;
const comments = new NiconiComments(canvas, data, { format: 'v1', mode: 'css' });

// Reuses parsed comments and their positions. Redraw at the current media time.
comments.resize(2520, 1080);
comments.drawCanvas(currentTime * 100, true);
```

`resize(width, height)` returns whether the surface changed. Nonfinite/zero dimensions are ignored, and canvas allocation is bounded. Renderers supplied by callers can also change their reported size; the next `drawCanvas()` synchronizes it. A temporarily invalid surface skips painting while continuing NicoScript events, then repaints when it recovers. `HTML5CSSRenderer` retains its transform through `setSize()`, whereas Canvas/WebGL reset it; resize handles these contracts separately.

The CSS container follows the canvas within its parent, rather than using the browser window as a hardcoded 16:9 stage. `ResizeObserver` and window resize keep its display bounds and pixel mapping up to date. Changing aspect clears active animation elements so they restart at the current media time; pause state and playback speed survive. Resizing only the display size does not reparse comments.

The IINA plugin should fit an output element to the video's display aspect within its overlay, set the canvas size to that aspect with a stable logical height, and call `resize()` when the aspect changes. Use mpv display dimensions/aspect (including pixel aspect and filters), with rotation applied. Browser window resize must be observed even during pause. Video zoom/pan or sidebar-specific placement needs the host's actual video rectangle; the engine does not infer a video's position from a window.

This change preserves this fork's owner scale protection, minimum-font-size policy, custom command defaults, fixedCombo and nakaDedupe behavior. It does not adopt upstream's separate ignoreScale model.

## Validation

- Unit coverage: 4:3/16:9/21:9/portrait positioning, uniform scaling, stable CA objects and lanes, wide timeline expansion and repeated resize, lazy/dynamic comments, invalid surfaces and continued events.
- `scripts/check-viewport.mjs`: Chromium/WebKit CSS and Canvas bounds, parent offsets, stable font size, reverse scrolling, playback speed, cleanup, and 16:9/4:3 CA screenshots.
- `scripts/check-ca-spaces.mjs`: existing worldline CA and WebKit spacer compatibility.

Build with `pnpm run build:ts`; run browser checks with `node scripts/check-viewport.mjs`. Existing browser paths can be supplied as `CA_CHROMIUM_EXECUTABLE` and `CA_WEBKIT_EXECUTABLE`.
