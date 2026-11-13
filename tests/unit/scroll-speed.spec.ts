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
  test.each([
    0.25, 0.5, 2,
  ])("owner motion and visibility stay native at speed %s", (speed) => {
    const rows = [
      { ...row(1), owner: true },
      { ...row(2, ["@7"]), owner: true },
      row(3),
    ];
    const make = (scrollSpeed: number) =>
      new NiconiComments(new Surface(), rows, {
        format: "formatted",
        mode: "html5",
        config: { scrollSpeed },
      });
    const normal = make(1),
      changed = make(speed);
    for (const index of [0, 1]) {
      const a = state(normal).comments[index],
        b = state(changed).comments[index];
      if (!a || !b) throw new Error("Missing owner");
      expect(range(changed, index + 1)).toEqual(range(normal, index + 1));
      for (const vpos of [50, 100, 200, 400]) {
        expect(getPosX(b.comment, vpos, state(changed).ctx.config)).toBeCloseTo(
          getPosX(a.comment, vpos, state(normal).ctx.config),
        );
      }
    }
    expect(range(changed, 3)).not.toEqual(range(normal, 3));
    changed.setScrollSpeed(1);
    changed.drawCanvas(200);
    expect(range(changed, 1)).toEqual(range(normal, 1));
    normal.destroy();
    changed.destroy();
  });

  test("multiple speed setters coalesce into one relayout at the next draw", () => {
    const nc = create(1);
    nc.drawCanvas(200);
    const initial = state(nc).timeline;
    const reflow = vi.spyOn(
      nc as unknown as { reflowMotion(vpos: number): void },
      "reflowMotion",
    );
    nc.setScrollSpeed(0.75);
    nc.setScrollSpeed(0.5);
    nc.setScrollSpeed(0.25);
    expect(state(nc).timeline).toBe(initial);
    expect(reflow).not.toHaveBeenCalled();
    nc.drawCanvas(200);
    expect(reflow).toHaveBeenCalledTimes(1);
    nc.drawCanvas(200, true);
    expect(reflow).toHaveBeenCalledTimes(1);
    nc.destroy();
  });
  test("lazy lookahead retains native owner lead-in when viewers run faster", () => {
    const make = (scrollSpeed: number) =>
      new NiconiComments(
        new Surface(),
        [{ ...row(1, ["@120"], 10000), owner: true }],
        {
          format: "formatted",
          mode: "html5",
          lazy: true,
          config: { scrollSpeed },
        },
      );
    const normal = make(1),
      fast = make(4);
    normal.drawCanvas(8400);
    fast.drawCanvas(8400);
    expect(range(normal, 1).length).toBeGreaterThan(0);
    expect(range(fast, 1)).toEqual(range(normal, 1));
    normal.destroy();
    fast.destroy();
  });
});
