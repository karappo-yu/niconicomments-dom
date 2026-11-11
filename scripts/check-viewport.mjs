// Build first. Set CA_CHROMIUM_EXECUTABLE / CA_WEBKIT_EXECUTABLE to reuse local browsers.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "@playwright/test";

const root = new URL("../", import.meta.url);
const out = new URL("test-results/aspect-ratio/", root);
await mkdir(out, { recursive: true });
const fixture = JSON.parse(
  await readFile(new URL("tests/fixtures/worldline-ca.json", root), "utf8"),
);
const report = {};
for (const [name, type] of Object.entries({ chromium, webkit })) {
  const browser = await type.launch({
    executablePath: process.env[`CA_${name.toUpperCase()}_EXECUTABLE`],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1400 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setContent(
      '<style>body{margin:0;background:#333}#host{position:absolute;left:48px;top:64px;width:1280px;height:720px;background:black}canvas{width:100%;height:100%}</style><div id="host"><canvas width="1920" height="1080"></canvas></div>',
    );
    await page.addScriptTag({
      path: fileURLToPath(new URL("dist/bundle.js", root)),
    });
    report[name] = [];
    for (const mode of ["css", "canvas"]) {
      const data = [
        {
          id: 1,
          vpos: 0,
          content: "FIXED\nSECOND",
          date: 1700000000,
          owner: true,
          premium: true,
          mail: ["ue", "gothic", "ender"],
          layer: -1,
          user_id: 0,
          is_my_post: false,
          date_usec: 0,
        },
        {
          id: 2,
          vpos: 0,
          content: "SCROLL",
          date: 1700000000,
          owner: true,
          premium: true,
          mail: ["naka", "gothic"],
          layer: -1,
          user_id: 0,
          is_my_post: false,
          date_usec: 0,
        },
      ];
      await page.evaluate(
        ({ mode, data }) => {
          window.nc?.destroy();
          const canvas = document.querySelector("canvas");
          canvas.width = 1920;
          canvas.height = 1080;
          canvas.style.opacity = mode === "css" ? "0" : "1";
          const renderer =
            mode === "css"
              ? canvas
              : new NiconiComments.internal.renderer.CanvasRenderer(canvas);
          window.nc = new NiconiComments(renderer, data, {
            format: "formatted",
            mode: mode === "css" ? "css" : "html5",
            config: { contextLineWidth: { html5: 0, flash: 0 } },
          });
        },
        { mode, data },
      );
      let original;
      for (const [width, height] of [
        [1280, 720],
        [960, 720],
        [1680, 720],
        [540, 960],
        [960, 720],
        [1280, 720],
      ]) {
        const state = await page.evaluate(
          ({ mode, width, height }) => {
            const host = document.querySelector("#host");
            host.style.width = width + "px";
            host.style.height = height + "px";
            nc.resize(Math.round((width / height) * 1080), 1080);
            nc.drawCanvas(50, true);
            nc.pauseCSS();
            const c = nc.comments.find((c) => c.comment.id === 1);
            const el = [...document.querySelectorAll("[data-dm-comment]")].find(
              (el) => el.__dmComment.comment.id === 1,
            );
            const container = document.querySelector("[data-dm-css-container]");
            return {
              width,
              height,
              mode,
              comment: [c.width, c.height, c.posY, c.comment.charSize],
              position: c.pos,
              viewport: nc.ctx.viewport,
              rect: container?.getBoundingClientRect().toJSON(),
              fontSize: el ? parseFloat(getComputedStyle(el).fontSize) : null,
              elementRect: el?.getBoundingClientRect().toJSON(),
            };
          },
          { mode, width, height },
        );
        original ??= state.comment;
        assert.deepEqual(
          state.comment,
          original,
          "Resizing must not remeasure or reposition the CA",
        );
        assert.ok(
          Math.abs(state.viewport.width - (width / height) * 1080) <= 0.5,
        );
        if (mode === "css") {
          assert.ok(
            Math.abs(state.rect.height - height) < 1,
            `Output must use the full height: ${JSON.stringify(state)}`,
          );
          assert.ok(Math.abs(state.rect.width - width) < 0.5);
          assert.ok(Math.abs(state.rect.x - 48) < 0.5);
          assert.ok(Math.abs(state.rect.y - 64) < 0.5);
          assert.ok(
            Math.abs(
              state.elementRect.x +
                state.elementRect.width / 2 -
                (48 + width / 2),
            ) < 1,
            "Fixed text must stay centered",
          );
        } else
          assert.ok(
            Math.abs(
              state.position.x +
                state.comment[0] / 2 -
                state.viewport.width / 2,
            ) < 0.1,
          );
        report[name].push(state);
      }
      const rows = report[name].filter(
        (x) => x.mode === "css" && x.height === 720,
      );
      if (mode === "css")
        assert.ok(
          rows.every((x) => Math.abs(x.fontSize - rows[0].fontSize) < 0.01),
          "same height means same font size at 4:3 and 21:9",
        );
      // Existing CA at 16:9 and 4:3. The latter crops the native horizontal stage,
      // without shrinking glyphs/line height to fit a 16:9 box inside the video.
      for (const width of [1280, 960]) {
        await page.evaluate(
          ({ mode, width, fixture }) => {
            nc.destroy();
            const canvas = document.querySelector("canvas");
            document.querySelector("#host").style.width = width + "px";
            document.querySelector("#host").style.height = "720px";
            canvas.width = (width / 720) * 1080;
            canvas.height = 1080;
            const renderer =
              mode === "css"
                ? canvas
                : new NiconiComments.internal.renderer.CanvasRenderer(canvas);
            window.nc = new NiconiComments(renderer, fixture, {
              format: "formatted",
              mode: mode === "css" ? "css" : "html5",
              keepCA: true,
              config: { contextLineWidth: { html5: 0, flash: 0 } },
            });
            nc.drawCanvas(21700, true);
            nc.pauseCSS();
          },
          { mode, width, fixture },
        );
        await page.screenshot({
          path: fileURLToPath(
            new URL(
              `${name}-${mode}-${width === 960 ? "4x3" : "16x9"}.png`,
              out,
            ),
          ),
          clip: { x: 48, y: 64, width, height: 720 },
        });
      }
    }
    // Scroll trajectories must share the same centered coordinate system,
    // including reverse mode, playback-speed changes, and an aspect-ratio seek.
    const trajectories = await page.evaluate(() => {
      nc.destroy();
      const canvas = document.querySelector("canvas");
      canvas.width = 1440;
      canvas.height = 1080;
      const host = document.querySelector("#host");
      host.style.width = "960px";
      host.style.height = "720px";
      window.nc = new NiconiComments(
        canvas,
        [
          {
            id: 1,
            vpos: 0,
            content: "@逆 全",
            owner: true,
            mail: ["@2"],
            date: 1700000000,
          },
          {
            id: 2,
            vpos: 0,
            content: "SCROLL",
            mail: ["naka", "gothic"],
            date: 1700000000,
          },
        ],
        { format: "formatted", mode: "css" },
      );
      nc.pauseCSS();
      const samples = [];
      for (const [width, vpos, reverse] of [
        [1440, 50, true],
        [2520, 50, true],
        [1440, 250, false],
      ]) {
        host.style.width = `${(width * 2) / 3}px`;
        nc.resize(width, 1080);
        nc.drawCanvas(vpos, true);
        const el = [...document.querySelectorAll("[data-dm-comment]")].find(
          (el) => el.__dmComment.comment.id === 2,
        );
        const c = el.__dmComment;
        const expected =
          NiconiComments.internal.utils.getPosX(
            c.comment,
            vpos,
            nc.ctx.config,
            reverse,
          ) + nc.ctx.viewport.offsetX;
        const actual = Number(el.style.getPropertyValue("--dm-from"));
        const before = parseFloat(el.style.animationDuration);
        nc.setPlaybackSpeed(2);
        const after = parseFloat(el.style.animationDuration);
        samples.push({ expected, actual, before, after });
        nc.setPlaybackSpeed(1);
      }
      return samples;
    });
    for (const sample of trajectories) {
      assert.ok(
        Math.abs(sample.expected - sample.actual) < 0.01,
        "CSS and Canvas scroll positions differ",
      );
      assert.ok(
        Math.abs(sample.before / 2 - sample.after) < 0.001,
        "Playback speed changes the duration, not the position",
      );
    }
    await page.evaluate(() => nc.destroy());
    assert.equal(await page.locator("[data-dm-css-container]").count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `${name}: CSS/Canvas 4:3, 16:9, 21:9, portrait, repeated resize, and CA screenshots passed`,
    );
  } finally {
    await browser.close();
  }
}
await writeFile(
  new URL("viewport-metrics.json", out),
  JSON.stringify(report, null, 2),
);
