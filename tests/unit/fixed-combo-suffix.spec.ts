import { beforeEach, describe, expect, test, vi } from "vitest";

import type { FormattedComment, IComment, IRenderer } from "@/@types";
import { initConfig } from "@/definition/initConfig";
import NiconiComments from "@/main";
import { applyNakaDedupe, buildFixedComboChains } from "@/utils/fixedCombo";

const textMetrics = (width: number): TextMetrics =>
  ({
    width,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: width,
    actualBoundingBoxAscent: 0,
    actualBoundingBoxDescent: 0,
    alphabeticBaseline: 0,
    hangingBaseline: 0,
    emHeightAscent: 0,
    emHeightDescent: 0,
    fontBoundingBoxAscent: 0,
    fontBoundingBoxDescent: 0,
    ideographicBaseline: 0,
  }) as TextMetrics;

class FakeRenderer implements IRenderer {
  public readonly rendererName = "FakeRenderer";
  public readonly canvas = {} as HTMLCanvasElement;
  private font = "";
  private size = { width: 1920, height: 1080 };

  destroy() {}
  drawVideo() {}
  getFont() {
    return this.font;
  }
  getFillStyle() {
    return "#000000";
  }
  setScale() {}
  fillRect() {}
  strokeRect() {}
  fillText() {}
  strokeText() {}
  quadraticCurveTo() {}
  clearRect() {}
  setFont(font: string) {
    this.font = font;
  }
  setFillStyle() {}
  setStrokeStyle() {}
  setLineWidth() {}
  setGlobalAlpha() {}
  setSize(width: number, height: number) {
    this.size = { width, height };
  }
  getSize() {
    return this.size;
  }
  measureText() {
    return textMetrics(120);
  }
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  stroke() {}
  save() {}
  restore() {}
  getCanvas() {
    return this;
  }
  drawImage() {}
  flush() {}
  invalidateImage() {}
}

const ensureCanvasElement = () => {
  if (!("HTMLCanvasElement" in globalThis)) {
    Object.defineProperty(globalThis, "HTMLCanvasElement", {
      configurable: true,
      value: class HTMLCanvasElement {},
    });
  }
};

const createComment = (
  overrides: Partial<FormattedComment> = {},
): FormattedComment => ({
  id: overrides.id ?? 1,
  vpos: overrides.vpos ?? 0,
  content: overrides.content ?? "combo",
  date: overrides.date ?? 1,
  date_usec: overrides.date_usec ?? 0,
  owner: overrides.owner ?? false,
  premium: overrides.premium ?? false,
  mail: overrides.mail ?? ["ue"],
  user_id: overrides.user_id ?? 1,
  layer: overrides.layer ?? -1,
  is_my_post: overrides.is_my_post ?? false,
});

describe("fixedCombo suffix random color", () => {
  beforeEach(() => {
    ensureCanvasElement();
    initConfig();
    let timeoutId = 0;
    vi.stubGlobal("window", {
      setTimeout: vi.fn(() => ++timeoutId),
    });
    vi.stubGlobal("clearTimeout", vi.fn());
  });

  test("chain assigns one fixed random suffix color for the whole chain", () => {
    const comments = [100, 200, 300].map((vpos, i) => ({
      ...createComment({ id: i + 1, vpos, mail: ["ue", "@10"] }),
      comment: { size: "medium" },
      long: 1000,
    }));
    const chains = buildFixedComboChains(comments as unknown as IComment[]);

    expect(chains).toHaveLength(1);
    const chain = chains[0];
    expect(chain).toBeDefined();
    expect(chain?.suffixColor).toMatch(/^#[0-9A-F]{6}$/i);
  });

  test("host keeps native body color while suffix fields are written", () => {
    const renderer = new FakeRenderer();
    const instance = new NiconiComments(
      renderer,
      [100, 200, 300].map((vpos, i) =>
        createComment({ id: i + 1, vpos, mail: ["ue", "@10"] }),
      ),
      {
        format: "formatted",
        mode: "html5",
        config: { fixedCombo: true },
      },
    );
    const state = instance as unknown as { comments: IComment[] };
    const host = () => state.comments[0];

    instance.drawCanvas(150, true);
    expect(host()?.comment.comboSuffix).toBeUndefined();
    expect(host()?.comment.color).toBe("#FFFFFF");

    instance.drawCanvas(250, true);
    expect(host()?.comment.comboSuffix).toBe("x2");
    const suffixColor = host()?.comment.comboSuffixColor;
    expect(suffixColor).toMatch(/^#[0-9A-F]{6}$/i);
    expect(host()?.comment.color).toBe("#FFFFFF");

    instance.drawCanvas(350, true);
    expect(host()?.comment.comboSuffix).toBe("x3");
    expect(host()?.comment.comboSuffixColor).toBe(suffixColor);
    expect(host()?.comment.color).toBe("#FFFFFF");
  });

  test("overlapping chains sort shared slots once and restore order on backward seek", () => {
    const instance = new NiconiComments(
      new FakeRenderer(),
      [
        createComment({ id: 1, vpos: 100, content: "A" }),
        createComment({ id: 2, vpos: 100, content: "B" }),
        createComment({ id: 3, vpos: 150, content: "between" }),
        createComment({ id: 4, vpos: 200, content: "B" }),
        createComment({ id: 5, vpos: 200, content: "A" }),
        createComment({ id: 6, vpos: 100, content: "owner", owner: true }),
      ],
      { format: "formatted", mode: "html5", config: { fixedCombo: true } },
    );
    const { timeline } = instance as unknown as {
      timeline: Record<number, IComment[]>;
    };
    // The hosts overlap here even when a seek lands on another slot.
    const slot = timeline[250]!;
    const sort = vi.spyOn(slot, "sort");
    const order = () => slot.map((comment) => comment.content);
    instance.drawCanvas(175, true);
    expect(order()).toEqual(["A", "B", "between", "owner"]);
    sort.mockClear();
    instance.drawCanvas(200, true);
    expect(sort).toHaveBeenCalledTimes(1);
    expect(order()).toEqual(["between", "Bx2", "Ax2", "owner"]);
    instance.drawCanvas(201, true);
    expect(sort).toHaveBeenCalledTimes(1);
    instance.drawCanvas(175, true);
    expect(sort).toHaveBeenCalledTimes(2);
    expect(order()).toEqual(["A", "B", "between", "owner"]);
    sort.mockRestore();
    instance.destroy();
  });

  test("count falling back to 1 clears the suffix fields", () => {
    const renderer = new FakeRenderer();
    const instance = new NiconiComments(
      renderer,
      [100, 200].map((vpos, i) =>
        createComment({ id: i + 1, vpos, mail: ["ue", "@10"] }),
      ),
      {
        format: "formatted",
        mode: "html5",
        config: { fixedCombo: true },
      },
    );
    const state = instance as unknown as { comments: IComment[] };
    const host = () => state.comments[0];

    instance.drawCanvas(250, true);
    expect(host()?.comment.comboSuffix).toBe("x2");

    instance.drawCanvas(1250, true);
    expect(host()?.comment.comboSuffix).toBeUndefined();
    expect(host()?.comment.comboSuffixColor).toBeUndefined();
    expect(host()?.comment.color).toBe("#FFFFFF");
  });
});

describe("applyNakaDedupe scroll danmaku window dedupe", () => {
  beforeEach(() => {
    ensureCanvasElement();
    initConfig();
    let timeoutId = 0;
    vi.stubGlobal("window", {
      setTimeout: vi.fn(() => ++timeoutId),
    });
    vi.stubGlobal("clearTimeout", vi.fn());
  });

  const stateComments = (instance: NiconiComments): IComment[] =>
    (instance as unknown as { comments: IComment[] }).comments;

  test("same-text naka comments inside window merge into host xN + random suffix color", () => {
    const renderer = new FakeRenderer();
    const instance = new NiconiComments(
      renderer,
      [100, 200, 250, 300].map((vpos, i) =>
        createComment({ id: i + 1, vpos, content: "dupe", mail: ["naka"] }),
      ),
      {
        format: "formatted",
        mode: "html5",
        config: { nakaDedupeWindow: 500 },
      },
    );
    instance.drawCanvas(0, true);

    const comments = stateComments(instance);
    expect(comments[0]?.content).toBe("dupex4");
    expect(comments[0]?.comment.comboSuffix).toBe("x4");
    expect(comments[0]?.comment.comboSuffixColor).toMatch(/^#[0-9A-F]{6}$/i);
    expect(comments[0]?.comment.color).toBe("#FFFFFF");
    expect(comments[1]?.comment.invisible).toBe(true);
    expect(comments[2]?.comment.invisible).toBe(true);
    expect(comments[3]?.comment.invisible).toBe(true);
  });

  test("owner comments are excluded from dedupe (fork owner ignored)", () => {
    const renderer = new FakeRenderer();
    const instance = new NiconiComments(
      renderer,
      [
        createComment({ id: 1, vpos: 100, content: "dupe", mail: ["naka"] }),
        createComment({ id: 2, vpos: 200, content: "dupe", mail: ["naka"] }),
        createComment({
          id: 3,
          vpos: 300,
          content: "dupe",
          mail: ["naka"],
          owner: true,
        }),
      ],
      {
        format: "formatted",
        mode: "html5",
        config: { nakaDedupeWindow: 500 },
      },
    );
    instance.drawCanvas(0, true);

    const comments = stateComments(instance);
    expect(comments[0]?.content).toBe("dupex2");
    expect(comments[1]?.comment.invisible).toBe(true);
    expect(comments[2]?.comment.invisible).toBe(false);
    expect(comments[2]?.content).toBe("dupe");
  });

  test("fixed (ue/shita) comments never participate in naka dedupe", () => {
    const renderer = new FakeRenderer();
    const instance = new NiconiComments(
      renderer,
      [100, 200, 300].map((vpos, i) =>
        createComment({ id: i + 1, vpos, content: "dupe", mail: ["ue"] }),
      ),
      {
        format: "formatted",
        mode: "html5",
        config: { nakaDedupeWindow: 500 },
      },
    );
    instance.drawCanvas(0, true);

    const comments = stateComments(instance);
    expect(comments[0]?.content).toBe("dupe");
    expect(comments.every((c) => !c.comment.invisible)).toBe(true);
  });

  test("groups restart after window boundary, each with own count", () => {
    const renderer = new FakeRenderer();
    const instance = new NiconiComments(
      renderer,
      [100, 200, 300, 700, 800, 850].map((vpos, i) =>
        createComment({ id: i + 1, vpos, content: "dupe", mail: ["naka"] }),
      ),
      {
        format: "formatted",
        mode: "html5",
        config: { nakaDedupeWindow: 500 },
      },
    );
    instance.drawCanvas(0, true);

    const comments = stateComments(instance);
    expect(comments[0]?.content).toBe("dupex3");
    expect(comments[0]?.comment.comboSuffix).toBe("x3");
    expect(comments[3]?.content).toBe("dupex3");
    expect(comments[3]?.comment.comboSuffix).toBe("x3");
  });

  test("window 0 (off) merges nothing", () => {
    const renderer = new FakeRenderer();
    const instance = new NiconiComments(
      renderer,
      [100, 200].map((vpos, i) =>
        createComment({ id: i + 1, vpos, content: "dupe", mail: ["naka"] }),
      ),
      {
        format: "formatted",
        mode: "html5",
        config: { nakaDedupeWindow: 0 },
      },
    );
    instance.drawCanvas(0, true);

    const comments = stateComments(instance);
    expect(comments[0]?.content).toBe("dupe");
    expect(comments.every((c) => !c.comment.invisible)).toBe(true);
  });

  test("applyNakaDedupe direct call merges by exact text only (no size grouping)", () => {
    const comments: IComment[] = [100, 200].map((vpos, i) => ({
      ...createComment({ id: i + 1, vpos, content: "dupe", mail: ["naka"] }),
      comment: { size: "small" },
      loc: "naka",
      long: 1000,
    }));
    applyNakaDedupe(comments, 500);

    expect(comments[0]?.content).toBe("dupex2");
    expect(comments[0]?.comment.comboSuffix).toBe("x2");
    expect(comments[0]?.comment.comboSuffixColor).toMatch(/^#[0-9A-F]{6}$/i);
    expect(comments[1]?.comment.invisible).toBe(true);
  });
});
