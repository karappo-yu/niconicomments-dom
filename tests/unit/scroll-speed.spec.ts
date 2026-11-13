import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
  BaseConfig,
  FormattedComment,
  IComment,
  Timeline,
} from "@/@types";
import NiconiComments from "@/main";
import { getPosX } from "@/utils/comment";
import { FakeRenderer } from "../bench/helpers";

class Surface extends FakeRenderer {
  override getCanvas() {
    return new FakeRenderer();
  }
}

const row = (
  id: number,
  mail: string[] = [],
  vpos = 100,
): FormattedComment => ({
  id,
  vpos,
  content: `comment ${id}`,
  date: 1767196800,
  date_usec: 0,
  owner: false,
  premium: true,
  mail,
  user_id: id,
  layer: -1,
  is_my_post: false,
});
const state = (nc: NiconiComments) =>
  nc as unknown as {
    comments: IComment[];
    timeline: Timeline;
    ctx: { config: BaseConfig };
  };
const range = (nc: NiconiComments, id: number) =>
  Object.entries(state(nc).timeline)
    .filter(([, rows]) => rows.some((c) => c.comment.id === id))
    .map(([vpos]) => Number(vpos))
    .sort((a, b) => a - b);
const create = (speed: number, lazy = false) =>
  new NiconiComments(
    new Surface(),
    [row(1), row(2, ["@7"], 150), row(3, ["shita"], 100)],
    {
      format: "formatted",
      mode: "html5",
      lazy,
      config: { scrollSpeed: speed },
    },
  );

describe("independent scroll speed", () => {
  beforeEach(() => {
    vi.stubGlobal("HTMLCanvasElement", class {});
    vi.stubGlobal("window", { setTimeout });
  });
  afterEach(() => vi.unstubAllGlobals());
  test("scales horizontal motion and visibility without rewriting native duration commands", () => {
    const normal = create(1),
      slow = create(0.25);
    for (let i = 0; i < 2; i++) {
      const a = state(normal).comments[i],
        b = state(slow).comments[i];
      if (!a || !b) throw new Error("Missing comment");
      expect(b.long).toBe(a.long);
      expect(b.mail).toEqual(a.mail);
      const delta = (c: IComment, nc: NiconiComments) =>
        getPosX(c.comment, 200, state(nc).ctx.config) -
        getPosX(c.comment, 100, state(nc).ctx.config);
      expect(delta(b, slow)).toBeCloseTo(delta(a, normal) / 4);
      expect(Number(range(slow, i + 1).at(-1))).toBeGreaterThan(
        Number(range(normal, i + 1).at(-1)),
      );
    }
    expect(range(normal, 3)).toEqual(range(slow, 3));
    normal.destroy();
    slow.destroy();
  });
  test.each([
    false,
    true,
  ])("runtime speed uses the same timeline and lanes as initial speed (lazy=%s)", (lazy) => {
    const nc = create(1, lazy),
      fresh = create(0.5, lazy);
    nc.drawCanvas(200, true);
    fresh.drawCanvas(200, true);
    const refs = state(nc).comments.slice();
    const geometry = refs.map((c) => [c.width, c.height, c.long]);
    expect(nc.setScrollSpeed(0.5)).toBe(true);
    nc.drawCanvas(200, true);
    expect(state(nc).comments.every((c, i) => c === refs[i])).toBe(true);
    expect(refs.map((c) => [c.width, c.height, c.long])).toEqual(geometry);
    expect(refs.map((c) => c.posY)).toEqual(
      state(fresh).comments.map((c) => c.posY),
    );
    for (const id of [1, 2, 3]) expect(range(nc, id)).toEqual(range(fresh, id));
    expect(nc.setScrollSpeed(0.5)).toBe(false);
    for (const speed of [NaN, Infinity, 0, -1, 0.1, 5])
      expect(nc.setScrollSpeed(speed)).toBe(false);
    nc.destroy();
    fresh.destroy();
  });
  test("separates overlapping trajectories at slower speed and preserves native @N", () => {
    const nc = new NiconiComments(
      new Surface(),
      [row(1, ["@10"], 0), row(2, [], 250)],
      {
        format: "formatted",
        mode: "html5",
        config: { scrollSpeed: 0.5 },
      },
    );
    const [first, second] = state(nc).comments;
    if (!first || !second) throw new Error("Missing comments");
    expect(first.long).toBe(1000);
    for (let vpos = 150; vpos < 900; vpos += 5) {
      const x1 = getPosX(first.comment, vpos, state(nc).ctx.config),
        x2 = getPosX(second.comment, vpos, state(nc).ctx.config);
      if (x1 < x2 + second.width && x2 < x1 + first.width)
        expect(first.posY).not.toBe(second.posY);
    }
    nc.destroy();
  });
});
