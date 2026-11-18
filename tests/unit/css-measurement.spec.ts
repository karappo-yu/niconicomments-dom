import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CSSMeasurementRenderer } from "@/renderer/cssMeasurement";
import typeGuard from "@/typeGuard";

describe("CSS measurement surface", () => {
  const canvases: HTMLCanvasElement[] = [];
  beforeEach(() => {
    canvases.length = 0;
    vi.stubGlobal("document", {
      createElement: () => {
        const canvas = {
          width: 300,
          height: 150,
          getContext: vi.fn(() => ({
            scale() {},
            measureText: (text: string) => ({ width: text.length * 10 }),
          })),
        } as unknown as HTMLCanvasElement;
        canvases.push(canvas);
        return canvas;
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  test("logical resizing preserves a single 1x1 measurement canvas", () => {
    const renderer = new CSSMeasurementRenderer({ width: 2520, height: 1080 });
    expect(renderer.getSize()).toEqual({ width: 2520, height: 1080 });
    expect(renderer.measureText("text").width).toBe(40);
    for (const width of [1440, 1920, 2520, 1440]) {
      renderer.setSize(width, 1080);
      expect(renderer.getSize()).toEqual({ width, height: 1080 });
      expect(renderer.canvas.width).toBe(1);
      expect(renderer.canvas.height).toBe(1);
    }
    expect(canvases).toHaveLength(1);
    expect(canvases[0]?.getContext).toHaveBeenCalledWith("2d");
    renderer.destroy();
    renderer.destroy();
    expect(renderer.canvas.width).toBe(0);
    expect(renderer.canvas.height).toBe(0);
  });

  test.each([
    null,
    { width: 0, height: 1080 },
    { width: -1, height: 1080 },
    { width: 1920, height: Number.NaN },
    { width: Number.POSITIVE_INFINITY, height: 1080 },
    { width: 1920.5, height: 1080 },
    { width: 8193, height: 1080 },
    { width: 8192, height: 8192 },
  ])("rejects invalid logical viewport %j", (viewportSize) => {
    expect(typeGuard.config.initOptions({ mode: "css", viewportSize })).toBe(
      false,
    );
  });

  test("accepts normal logical viewports and the omitted option", () => {
    for (const width of [1440, 1920, 2520]) {
      expect(
        typeGuard.config.initOptions({
          mode: "css",
          viewportSize: { width, height: 1080 },
        }),
      ).toBe(true);
    }
    expect(typeGuard.config.initOptions({ mode: "css" })).toBe(true);
  });
});
