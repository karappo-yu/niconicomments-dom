// Build first. Exercises actual DOM layout in Chromium and WebKit.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "@playwright/test";
import { PNG } from "pngjs";

const root = new URL("../", import.meta.url);
const output = new URL("test-results/css-auto/", root);
await mkdir(output, { recursive: true });
const fonts = {
  flash: {
    gulim: "normal 600 [size]px Arial",
    simsun: 'normal 400 [size]px "Times New Roman"',
  },
  html5: {
    defont: { font: "Arial", weight: 400, offset: 0 },
    gothic: { font: "Arial", weight: 600, offset: 0 },
    mincho: { font: '"Times New Roman"', weight: 400, offset: 0 },
  },
};
const old = {
  id: 1,
  vpos: 100,
  date: 1499871599,
  mail: ["ue"],
  content: "Flash ABC",
};
const scenarios = {
  mixed: [
    old,
    { ...old, id: 2, date: 1499871600, content: "HTML5 ABC" },
    { ...old, id: 3, mail: ["ue", "gothic"], content: "Old with gothic" },
    {
      ...old,
      id: 4,
      date: 1767196800,
      mail: ["ue", "nico:flash"],
      content: "New with nico:flash",
    },
    { ...old, id: 5, mail: ["shita", "small"], content: "Bottom old" },
    { ...old, id: 6, mail: ["naka", "@7"], content: "Scrolling old" },
  ],
  flash: [old],
  flashCA: [
    { ...old, content: "ABC\u2665\u2001DEF\u25a0\n\nsecond\n\u3000last" },
  ],
  resized: [{ ...old, mail: ["ue", "big"], content: "ABC ".repeat(70) }],
  multiline: [
    { ...old, mail: ["ue", "big"], content: "ABC\n".repeat(12) + "END" },
  ],
  owner: [{ ...old, owner: true }],
  emoji: [{ ...old, content: "\u{1f300}".repeat(12) }],
};

function inkBounds(buffer) {
  const png = PNG.sync.read(buffer);
  let left = png.width,
    top = png.height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      if (Math.max(png.data[i], png.data[i + 1], png.data[i + 2]) < 80)
        continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  assert.ok(right >= left, "comment paints visible glyphs");
  return { left, top, right, bottom };
}

const report = {};
for (const [browserName, browserType] of Object.entries({ chromium, webkit })) {
  const browser = await browserType.launch({
    executablePath: process.env[`CA_${browserName.toUpperCase()}_EXECUTABLE`],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    report[browserName] = {};
    for (const [name, data] of Object.entries(scenarios)) {
      for (const scale of [1, 0.35]) {
        const modes = {};
        for (const mode of ["default", "css"]) {
          await page.setContent(
            '<style>body{margin:0;background:black}canvas{width:100vw;height:100vh}</style><canvas width="1920" height="1080"></canvas>',
          );
          await page.addScriptTag({
            path: fileURLToPath(new URL("dist/bundle.js", root)),
          });
          const metrics = await page.evaluate(
            ({ data, mode, scale, fonts }) => {
              const canvas = document.querySelector("canvas");
              canvas.style.opacity = mode === "css" ? "0" : "1";
              window.nc = new NiconiComments(canvas, data, {
                format: "formatted",
                mode,
                scale,
                config: { fonts, contextLineWidth: { html5: 0, flash: 0 } },
              });
              nc.drawCanvas(100, true);
              nc.pauseCSS();
              const comments = nc.comments
                .map((c) => ({
                  id: c.comment.id,
                  flash: c.flash,
                  width: c.width,
                  height: c.height,
                  posY: c.posY,
                  loc: c.loc,
                  long: c.long,
                  scale: c.comment.scale,
                  scaleX: c.comment.scaleX,
                  content: c.content,
                }))
                .sort((a, b) => a.id - b.id);
              const dom = [
                ...document.querySelectorAll("[data-dm-comment]"),
              ].map((e) => {
                const c = e.__dmComment;
                return {
                  id: c.comment.id,
                  text: e.textContent,
                  fontSize: parseFloat(getComputedStyle(e).fontSize),
                  rect: e.getBoundingClientRect().toJSON(),
                  flash: !!e.querySelector("[data-dm-flash]"),
                  runs: [...e.querySelectorAll("[data-dm-flash] > span")].map(
                    (s) => ({
                      text: s.textContent,
                      font: getComputedStyle(s).fontFamily,
                      top: s.style.top,
                    }),
                  ),
                };
              });
              return {
                comments,
                dom,
                spacers: document.querySelectorAll("[data-dm-spacer]").length,
              };
            },
            { data, mode, scale, fonts },
          );
          const shot = await page.screenshot();
          await writeFile(
            new URL(`${browserName}-${name}-${scale}-${mode}.png`, output),
            shot,
          );
          modes[mode] = { metrics, bounds: inkBounds(shot) };
          await page.evaluate(() => nc.destroy());
        }
        assert.deepEqual(
          modes.css.metrics.comments,
          modes.default.metrics.comments,
          `${browserName}/${name}: Auto geometry`,
        );
        for (const c of modes.css.metrics.comments) {
          const e = modes.css.metrics.dom.find((e) => e.id === c.id);
          assert.ok(e, `visible DOM comment ${c.id}`);
          assert.equal(e.text, c.content);
          assert.ok(
            e.fontSize > 0,
            "old Flash comments have a nonzero font size",
          );
          assert.equal(e.flash, c.flash);
          if (c.flash) {
            assert.ok(
              Math.abs(e.rect.width - (c.width * 2) / 3) < 0.05,
              "Flash box follows measured width",
            );
            assert.ok(
              Math.abs(e.rect.height - (c.height * 2) / 3) < 0.05,
              "Flash box follows measured height",
            );
            if (c.loc !== "naka")
              assert.ok(
                Math.abs(e.rect.x + e.rect.width / 2 - 640) < 0.5,
                `${browserName}/${name}/${scale}: fixed Flash comment is centered ${JSON.stringify({ c, e })}`,
              );
          }
        }
        if (name === "mixed") {
          assert.deepEqual(
            modes.css.metrics.comments.map((c) => c.flash),
            [true, false, false, true, true, true],
          );
        } else {
          for (const edge of ["left", "top", "right", "bottom"]) {
            assert.ok(
              Math.abs(modes.css.bounds[edge] - modes.default.bounds[edge]) <=
                3,
              `${browserName}/${name}/${scale}: ${edge} bounds ${JSON.stringify(modes)}`,
            );
          }
        }
        report[browserName][`${name}-${scale}`] = modes;
      }
    }

    // Fixed-combo updates, seeks and pooled Flash -> HTML5 -> Flash reuse.
    const lifecycle = await page.evaluate(
      ({ old, fonts }) => {
        window.nc = new NiconiComments(
          document.querySelector("canvas"),
          [
            old,
            { ...old, id: 2, vpos: 150 },
            {
              ...old,
              id: 3,
              vpos: 1000,
              date: 1767196800,
              content: "HTML5 reuse",
            },
            { ...old, id: 4, vpos: 2000, content: "Flash reuse" },
          ],
          {
            format: "formatted",
            mode: "css",
            config: { fonts, fixedCombo: true },
          },
        );
        nc.drawCanvas(100, true);
        const first = document.querySelector("[data-dm-comment]");
        nc.drawCanvas(150, true);
        const combo = first.textContent;
        const suffixColor = first.querySelector("[data-dm-flash] span span")
          ?.style.color;
        nc.drawCanvas(100, true);
        const rewind = first.textContent;
        nc.drawCanvas(600, true);
        nc.drawCanvas(1000, true);
        const next = document.querySelector("[data-dm-comment]");
        const reuse = {
          same: first === next,
          text: next.textContent,
          flash: !!next.querySelector("[data-dm-flash]"),
          width: next.style.width,
        };
        nc.drawCanvas(1600, true);
        nc.drawCanvas(2000, true);
        const last = document.querySelector("[data-dm-comment]");
        const result = {
          combo,
          suffixColor,
          rewind,
          reuse,
          flashAgain: !!last.querySelector("[data-dm-flash]"),
        };
        nc.destroy();
        return result;
      },
      { old, fonts },
    );
    assert.equal(lifecycle.combo, "Flash ABCx2");
    assert.ok(lifecycle.suffixColor);
    assert.equal(lifecycle.rewind, "Flash ABC");
    assert.deepEqual(lifecycle.reuse, {
      same: true,
      text: "HTML5 reuse",
      flash: false,
      width: "",
    });
    assert.equal(lifecycle.flashAgain, true);
    assert.deepEqual(errors, []);
    report[browserName].lifecycle = lifecycle;
  } finally {
    await browser.close();
  }
}
await writeFile(
  new URL("report.json", output),
  JSON.stringify(report, null, 2),
);
console.log(
  "CSS Auto selection, Flash layout and lifecycle passed in Chromium and WebKit.",
);
