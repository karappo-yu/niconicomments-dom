import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CanvasRenderer } from "@/renderer/canvas";
import { canvasPool } from "@/renderer/canvasPool";

const canvasWithPixels = (width = 1920, height = 1080) => {
  const widthWrites: number[] = [];
  const heightWrites: number[] = [];
  let currentWidth = width;
  let currentHeight = height;
  const canvas = {
    get width() {
      return currentWidth;
    },
    set width(value: number) {
      widthWrites.push(value);
      currentWidth = value;
    },
    get height() {
      return currentHeight;
    },
    set height(value: number) {
      heightWrites.push(value);
      currentHeight = value;
    },
    getContext: vi.fn(() => ({})),
  } as unknown as HTMLCanvasElement;
  return { canvas, widthWrites, heightWrites };
};

describe("CanvasPool buffer release", () => {
  beforeEach(() => canvasPool.clear());
  afterEach(() => {
    canvasPool.clear();
    vi.unstubAllGlobals();
  });

  test("destroys the buffers of overflow renderer canvases while keeping reuse bounded", () => {
    const created: HTMLCanvasElement[] = [];
    vi.stubGlobal("document", {
      createElement: vi.fn(() => {
        const { canvas } = canvasWithPixels();
        created.push(canvas);
        return canvas;
      }),
    });
    const renderers = Array.from({ length: 20 }, () => new CanvasRenderer());
    const releasedCanvases = renderers.map((renderer) => renderer.canvas);

    for (const renderer of renderers) renderer.destroy();

    for (const canvas of releasedCanvases) {
      expect({ width: canvas.width, height: canvas.height }).toEqual({
        width: 0,
        height: 0,
      });
    }
    const reused = Array.from({ length: 16 }, () => canvasPool.acquire());
    expect(new Set(reused).size).toBe(16);
    expect(new Set(reused)).toEqual(new Set(releasedCanvases.slice(0, 16)));
    const overflowReplacement = canvasPool.acquire();
    expect(releasedCanvases).not.toContain(overflowReplacement);
    expect(created).toHaveLength(21);
  });

  test("ignores duplicate releases but resets a resized canvas after reacquisition", () => {
    const { canvas, widthWrites, heightWrites } = canvasWithPixels();

    canvasPool.release(canvas);
    canvasPool.release(canvas);

    expect(widthWrites).toEqual([0]);
    expect(heightWrites).toEqual([0]);
    expect(canvasPool.acquire()).toBe(canvas);
    canvas.width = 640;
    canvas.height = 360;
    canvasPool.release(canvas);
    expect(widthWrites).toEqual([0, 640, 0]);
    expect(heightWrites).toEqual([0, 360, 0]);
    expect(canvasPool.acquire()).toBe(canvas);
  });

  test("accepts zero-sized canvas releases without inserting duplicates", () => {
    const { canvas } = canvasWithPixels(0, 0);
    const replacement = canvasWithPixels().canvas;
    const createElement = vi.fn(() => replacement);
    vi.stubGlobal("document", { createElement });

    canvasPool.release(canvas);
    canvasPool.release(canvas);

    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(canvasPool.acquire()).toBe(canvas);
    expect(canvasPool.acquire()).toBe(replacement);
    expect(createElement).toHaveBeenCalledTimes(1);
  });
});
