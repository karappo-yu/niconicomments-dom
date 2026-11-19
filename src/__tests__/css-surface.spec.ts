import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const bundle = readFileSync(resolve("dist/bundle.js"), "utf8");

test.beforeEach(async ({ page }) => {
  await page.setContent(`<div style="position:relative;width:1000px;height:600px">
    <canvas id="comments" width="1" height="1" style="width:100%;height:100%"></canvas>
  </div>`);
  await page.addScriptTag({ content: bundle });
});

test("CSS uses its initial logical viewport without creating WebGL or a helper", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const contexts: string[] = [];
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      options?: unknown,
    ) {
      contexts.push(kind);
      return Reflect.apply(original, this, [kind, options]);
    } as typeof original;
    const global = window as typeof window & {
      NiconiComments: typeof import("@/main").default;
    };
    const canvas = document.getElementById("comments") as HTMLCanvasElement;
    const nc = new global.NiconiComments(
      canvas,
      [
        {
          id: 1,
          vpos: 100,
          content: "字幕 🌀",
          date: 1767196800,
          date_usec: 0,
          owner: false,
          premium: true,
          mail: ["ue"],
          user_id: 1,
          layer: -1,
          is_my_post: false,
        },
      ],
      {
        mode: "css",
        format: "formatted",
        viewportSize: { width: 2520, height: 1080 },
      },
    );
    const state = nc as unknown as {
      renderer: {
        rendererName: string;
        canvas: HTMLCanvasElement;
        getSize(): { width: number; height: number };
      };
      ctx: { viewport: { width: number; offsetX: number } };
      timelineExpansion: number;
    };
    try {
      const initialViewport = { ...state.ctx.viewport };
      const initialExpansion = state.timelineExpansion;
      const unchangedResize = nc.resize(2520, 1080);
      nc.drawCanvas(100, true);
      const visibleText =
        document.querySelector("[data-dm-comment]")?.textContent;
      nc.resize(1440, 1080);
      nc.drawCanvas(100, true);
      return {
        contexts,
        initialViewport,
        initialExpansion,
        unchangedResize,
        visibleText,
        rendererName: state.renderer.rendererName,
        helperAbsent: !("helper" in state.renderer),
        logicalSize: state.renderer.getSize(),
        measurementSize: {
          width: state.renderer.canvas.width,
          height: state.renderer.canvas.height,
        },
        canvasSize: { width: canvas.width, height: canvas.height },
        finalViewport: { ...state.ctx.viewport },
      };
    } finally {
      nc.destroy();
      HTMLCanvasElement.prototype.getContext = original;
    }
  });
  expect(result.contexts.every((kind) => kind === "2d")).toBe(true);
  expect(result.initialViewport).toEqual({ width: 2520, offsetX: 300 });
  expect(result.initialExpansion).toBe(300);
  expect(result.unchangedResize).toBe(false);
  expect(result.visibleText).toBe("字幕 🌀");
  expect(result.rendererName).toBe("CSSMeasurementRenderer");
  expect(result.helperAbsent).toBe(true);
  expect(result.logicalSize).toEqual({ width: 1440, height: 1080 });
  expect(result.measurementSize).toEqual({ width: 1, height: 1 });
  expect(result.canvasSize).toEqual({ width: 1, height: 1 });
  expect(result.finalViewport).toEqual({ width: 1440, offsetX: -240 });
});

test("CSS can reuse a canvas already bound to WebGL without requesting its context", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const global = window as typeof window & {
      NiconiComments: typeof import("@/main").default;
    };
    const canvas = document.getElementById("comments") as HTMLCanvasElement;
    canvas.getContext("webgl2");
    let requests = 0;
    canvas.getContext = () => {
      requests++;
      throw new Error("Display canvas must stay unused");
    };
    const nc = new global.NiconiComments(canvas, [], {
      mode: "css",
      format: "formatted",
      viewportSize: { width: 1920, height: 1080 },
    });
    nc.resize(2520, 1080);
    const visibleContainer =
      document.querySelector("[data-dm-css-container]") !== null;
    nc.destroy();
    return {
      requests,
      visibleContainer,
      width: canvas.width,
      height: canvas.height,
    };
  });
  expect(result).toEqual({
    requests: 0,
    visibleContainer: true,
    width: 1,
    height: 1,
  });
});

test("CSS preserves canvas layout and infers logical size when viewportSize is omitted", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const global = window as typeof window & {
      NiconiComments: typeof import("@/main").default;
    };
    const canvas = document.getElementById("comments") as HTMLCanvasElement;
    canvas.width = 1920;
    canvas.height = 1080;
    const nc = new global.NiconiComments(canvas, [], {
      mode: "css",
      format: "formatted",
    });
    const renderer = (
      nc as unknown as {
        renderer: { getSize(): { width: number; height: number } };
      }
    ).renderer;
    const size = renderer.getSize();
    const physical = { width: canvas.width, height: canvas.height };
    nc.destroy();
    return { size, physical };
  });
  expect(result.size).toEqual({ width: 1920, height: 1080 });
  expect(result.physical).toEqual({ width: 1920, height: 1080 });
});
