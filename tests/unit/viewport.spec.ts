import { beforeAll, describe, expect, test, vi } from "vitest";
import type { FormattedComment, IComment } from "@/@types";
import NiconiComments from "@/main";
import { FakeRenderer } from "../bench/helpers";

class Surface extends FakeRenderer {
  scales: number[][] = [];
  draws: number[][] = [];
  override setScale(x = 1, y = x) {
    this.scales.push([x, y]);
  }
  override getCanvas() {
    return new Surface();
  }
  override drawImage(_image?: unknown, x = 0, y = 0) {
    this.draws.push([x, y]);
  }
}

const comment = (
  overrides: Partial<FormattedComment> = {},
): FormattedComment => ({
  id: 1,
  vpos: 0,
  content: "test",
  date: 1700000000,
  date_usec: 0,
  owner: false,
  premium: true,
  mail: ["ue"],
  user_id: 1,
  layer: -1,
  is_my_post: false,
  ...overrides,
});
const stateOf = (instance: NiconiComments) =>
  instance as unknown as {
    comments: IComment[];
    timeline: Record<number, IComment[]>;
    ctx: { viewport: { width: number; offsetX: number } };
  };
const rangeOf = (instance: NiconiComments, id: number) =>
  Object.entries(stateOf(instance).timeline)
    .filter(([, comments]) => comments.some((c) => c.comment.id === id))
    .map(([time]) => Number(time))
    .sort((a, b) => a - b);

describe("aspect ratio and surface resize", () => {
  beforeAll(() => {
    vi.stubGlobal("HTMLCanvasElement", class {});
    vi.stubGlobal("window", { setTimeout });
  });

  test.each([
    [1440, -240],
    [1920, 0],
    [2520, 300],
    [608, -656],
  ])("keeps height-based scale and centers fixed comments at width %s", (width, offsetX) => {
    const surface = new Surface();
    surface.setSize(width, 1080);
    const nc = new NiconiComments(surface, [comment()], {
      format: "formatted",
      mode: "html5",
    });
    expect(surface.scales).toEqual([[1, 1]]);
    expect(stateOf(nc).ctx.viewport).toEqual({ width, offsetX });
    nc.drawCanvas(0, true);
    const c = stateOf(nc).comments[0];
    if (!c) throw new Error("Missing fixed comment");
    expect(c.pos.x + c.width / 2).toBeCloseTo(width / 2);
    nc.destroy();
  });

  test("resize keeps comment objects, owner scale protection, and positions", () => {
    const surface = new Surface();
    const nc = new NiconiComments(surface, [comment({ owner: true })], {
      format: "formatted",
      mode: "html5",
      scale: 0.5,
    });
    const c = stateOf(nc).comments[0];
    if (!c) throw new Error("Missing owner comment");
    const geometry = [c.width, c.height, c.posY];
    expect(nc.resize(960, 720)).toBe(true);
    nc.drawCanvas(0, true);
    expect(stateOf(nc).comments[0]).toBe(c);
    expect([c.width, c.height, c.posY]).toEqual(geometry);
    expect(surface.scales.at(-1)).toEqual([2 / 3, 2 / 3]);
    expect(c.pos.x + c.width / 2).toBeCloseTo(720);
    expect(nc.resize(960, 720)).toBe(false);
    nc.destroy();
    expect(nc.resize(1920, 1080)).toBe(false);
  });

  test("wide viewport extends scrolling visibility without moving collision lanes", () => {
    const nc = new NiconiComments(
      new Surface(),
      [comment({ mail: [], vpos: 1000 })],
      { format: "formatted", mode: "html5" },
    );
    const original = rangeOf(nc, 1);
    const lane = stateOf(nc).comments[0]?.posY;
    nc.resize(2520, 1080);
    const expanded = rangeOf(nc, 1);
    expect(expanded[0]).toBeLessThan(original[0] ?? 0);
    expect(expanded.at(-1)).toBeGreaterThan(original.at(-1) ?? 0);
    expect(stateOf(nc).comments[0]?.posY).toBe(lane);
    nc.resize(1440, 1080);
    nc.resize(2520, 1080);
    expect(rangeOf(nc, 1)).toEqual(expanded);
    for (const comments of Object.values(stateOf(nc).timeline)) {
      expect(new Set(comments).size).toBe(comments.length);
    }
    nc.addComments(comment({ id: 2, vpos: 2000, mail: [] }));
    expect(rangeOf(nc, 2).length).toBe(expanded.length);
    nc.destroy();
  });

  test("lazy comments and wide-to-narrow-to-wide additions retain expanded visibility", () => {
    const nc = new NiconiComments(
      new Surface(),
      [comment({ mail: [], vpos: 5000 })],
      { format: "formatted", mode: "html5", lazy: true },
    );
    nc.resize(2520, 1080);
    nc.drawCanvas(5000, true);
    const expanded = rangeOf(nc, 1);
    nc.resize(1440, 1080);
    nc.addComments(comment({ id: 2, vpos: 6000, mail: [] }));
    nc.resize(2520, 1080);
    nc.drawCanvas(6000, true);
    expect(rangeOf(nc, 2).length).toBe(expanded.length);
    nc.destroy();
  });

  test("zero-size surfaces still deliver events and repaint when restored", () => {
    const surface = new Surface();
    surface.setSize(0, 0);
    const nc = new NiconiComments(
      surface,
      [
        comment({ content: "@ジャンプ sm9 test", owner: true, vpos: 100 }),
        comment({ id: 2, vpos: 100 }),
      ],
      { format: "formatted", mode: "html5" },
    );
    const jump = vi.fn();
    nc.addEventListener("jump", jump);
    expect(nc.drawCanvas(100)).toBe(false);
    expect(jump).toHaveBeenCalledTimes(1);
    expect(nc.resize(NaN, 100)).toBe(false);
    expect(nc.resize(1280, 720)).toBe(true);
    expect(nc.drawCanvas(100)).toBe(true);
    expect(surface.draws.length).toBeGreaterThan(0);
    expect(jump).toHaveBeenCalledTimes(1);
    nc.destroy();
  });

  test("an externally hidden surface restores its transform at the same size", () => {
    const surface = new Surface();
    surface.setSize(1280, 720);
    const nc = new NiconiComments(surface, [comment()], {
      format: "formatted",
      mode: "html5",
    });
    nc.drawCanvas(0, true);
    surface.setSize(0, 0);
    nc.drawCanvas(0, true);
    surface.setSize(1280, 720);
    expect(nc.drawCanvas(0)).toBe(true);
    expect(surface.scales).toEqual([
      [2 / 3, 2 / 3],
      [2 / 3, 2 / 3],
    ]);
    nc.destroy();
  });
});
