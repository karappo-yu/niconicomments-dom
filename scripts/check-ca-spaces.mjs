// Build first. Optional argument: the original V1 JSON comment file.
// Browser binaries: pnpm exec playwright install chromium webkit
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const root = new URL("../", import.meta.url);
const bundle = fileURLToPath(new URL("dist/bundle.js", root));
const output = new URL("test-results/ca-spaces/", root);
const input =
  process.argv[2] ?? new URL("tests/fixtures/worldline-ca.json", root);
const data = JSON.parse(await readFile(input, "utf8"));
const format = process.argv[2] ? "v1" : "formatted";
const results = {};
await mkdir(output, { recursive: true });

for (const [name, browserType] of Object.entries({ chromium, webkit })) {
  const executablePath = process.env[`CA_${name.toUpperCase()}_EXECUTABLE`];
  const browser = await browserType.launch({ executablePath });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    await page.setContent(
      '<style>body{margin:0;background:black}canvas{width:100vw;height:100vh}</style><canvas width="1920" height="1080"></canvas>',
    );
    await page.addScriptTag({ path: bundle });
    const modes = {};
    for (const mode of ["css", "html5"]) {
      const metrics = await page.evaluate(
        ({ data, format, mode }) => {
          window.nc?.destroy();
          const canvas = document.querySelector("canvas");
          canvas.style.opacity = mode === "css" ? "0" : "1";
          window.nc = new NiconiComments(canvas, data, {
            format,
            mode,
            keepCA: true,
            config: { contextLineWidth: { html5: 0, flash: 0 } },
          });
          nc.drawCanvas(21700, true);
          nc.pauseCSS();
          const active = nc.timeline[21700].filter((c) => !c.invisible);
          const comments = active.map((c) => ({
            id: c.comment.id,
            text: c.content,
            width: c.width,
            height: c.height,
            posY: c.posY,
            charSize: c.comment.charSize,
          }));
          const elements = [...document.querySelectorAll("[data-dm-comment]")];
          return {
            comments,
            dom: elements.map((e) => ({
              text: e.textContent,
              rect: e.getBoundingClientRect().toJSON(),
            })),
            spacerCount: document.querySelectorAll("[data-dm-spacer]").length,
          };
        },
        { data, format, mode },
      );
      assert.equal(
        metrics.comments.length,
        4,
        `${name}/${mode}: missing CA layers`,
      );
      if (mode === "css") {
        assert.deepEqual(
          metrics.dom.map((e) => e.text),
          metrics.comments.map((c) => c.text),
          "Preserve the original characters and blank lines",
        );
      }
      const shot = await page.screenshot();
      await writeFile(new URL(`${name}-${mode}.png`, output), shot);
      modes[mode] = { metrics, shot };
    }
    results[name] = { version: browser.version(), modes };

    // Exercise CSS pool reuse after a seek, including a plain fixed comment.
    const pooled = await page.evaluate(() => {
      nc.destroy();
      window.nc = new NiconiComments(
        document.querySelector("canvas"),
        [
          {
            id: 1,
            vpos: 0,
            content: "A\u2001B",
            date: 1700000000,
            mail: ["ue", "gothic"],
          },
          {
            id: 2,
            vpos: 1000,
            content: "ordinary text",
            date: 1700000000,
            mail: ["ue", "gothic"],
          },
        ],
        {
          format: "formatted",
          mode: "css",
          config: {
            compatSpacer: { flash: {}, html5: { "\u2001": { gothic: 1 } } },
          },
        },
      );
      nc.drawCanvas(0, true);
      const original = document.querySelector("[data-dm-comment]");
      nc.drawCanvas(500, true);
      nc.drawCanvas(1000, true);
      const reused = document.querySelector("[data-dm-comment]");
      return {
        reused: reused === original,
        text: reused.textContent,
        children: reused.childElementCount,
      };
    });
    assert.deepEqual(pooled, {
      reused: true,
      text: "ordinary text",
      children: 0,
    });
    const combo = await page.evaluate(() => {
      nc.destroy();
      window.nc = new NiconiComments(
        document.querySelector("canvas"),
        [
          {
            id: 1,
            vpos: 0,
            content: "A\u2001B",
            date: 1700000000,
            mail: ["ue", "gothic"],
          },
          {
            id: 2,
            vpos: 50,
            content: "A\u2001B",
            date: 1700000000,
            mail: ["ue", "gothic"],
          },
        ],
        {
          format: "formatted",
          mode: "css",
          config: {
            fixedCombo: true,
            compatSpacer: { flash: {}, html5: { "\u2001": { gothic: 1 } } },
          },
        },
      );
      nc.drawCanvas(0, true);
      nc.drawCanvas(100, true);
      const host = document.querySelector("[data-dm-comment]");
      const result = {
        text: host.textContent,
        suffix: host.lastElementChild.textContent,
        color: host.lastElementChild.style.color,
      };
      nc.drawCanvas(0, true);
      result.rewound = host.textContent;
      return result;
    });
    assert.equal(combo.text, "A\u2001Bx2");
    assert.equal(combo.suffix, "x2");
    assert.ok(combo.color);
    assert.equal(combo.rewound, "A\u2001B");
  } finally {
    await browser.close();
  }
}

for (const mode of ["css", "html5"]) {
  const chrome = results.chromium.modes[mode];
  const safari = results.webkit.modes[mode];
  for (let i = 0; i < chrome.metrics.comments.length; i++) {
    const a = chrome.metrics.comments[i];
    const b = safari.metrics.comments[i];
    assert.equal(a.text, b.text);
    for (const key of ["width", "height", "posY", "charSize"]) {
      assert.ok(
        Math.abs(a[key] - b[key]) < 0.05,
        `${mode} #${a.id} ${key}: Chromium ${a[key]}, WebKit ${b[key]}`,
      );
    }
  }
  if (mode === "css") {
    chrome.metrics.dom.forEach((a, i) => {
      const b = safari.metrics.dom[i];
      for (const key of ["x", "y", "width", "height"]) {
        assert.ok(
          Math.abs(a.rect[key] - b.rect[key]) < 1,
          `CSS #${i} ${key}: a blank line or space shifted`,
        );
      }
    });
  }
  const a = PNG.sync.read(chrome.shot);
  const b = PNG.sync.read(safari.shot);
  const diff = new PNG({ width: a.width, height: a.height });
  const ratio =
    pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
      threshold: 0.1,
    }) /
    (a.width * a.height);
  await writeFile(new URL(`diff-${mode}.png`, output), PNG.sync.write(diff));
  assert.ok(
    ratio < 0.01,
    `${mode}: browser pixel difference ${(ratio * 100).toFixed(3)}%`,
  );
  console.log(
    `${mode}: matching CA geometry; ${(ratio * 100).toFixed(3)}% pixels differ`,
  );
}

const report = Object.fromEntries(
  Object.entries(results).map(([name, value]) => [
    name,
    {
      version: value.version,
      modes: Object.fromEntries(
        Object.entries(value.modes).map(([mode, run]) => [mode, run.metrics]),
      ),
    },
  ]),
);
await writeFile(
  new URL("metrics.json", output),
  JSON.stringify(report, null, 2),
);
console.log(`Screenshots and metrics: ${fileURLToPath(output)}`);
