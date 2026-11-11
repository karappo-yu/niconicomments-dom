import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BaseOptions, FormattedComment, IComment } from "@/@types";
import { defaultConfig, defaultOptions } from "@/definition/config";
import { initConfig } from "@/definition/initConfig";
import NiconiComments from "@/main";
import { isFlashComment } from "@/utils/comment";
import { FakeRenderer } from "../bench/helpers";

const comment = (
  overrides: Partial<FormattedComment> = {},
): FormattedComment => ({
  id: 1,
  vpos: 100,
  content: "ABC\n\u2001\u25a0\u2665",
  date: 1_499_871_599,
  date_usec: 0,
  owner: false,
  premium: true,
  mail: [],
  user_id: 1,
  layer: -1,
  is_my_post: false,
  ...overrides,
});

const commentsOf = (nc: NiconiComments) =>
  (nc as unknown as { comments: IComment[] }).comments;

describe("CSS Auto comment selection", () => {
  beforeEach(() => {
    vi.stubGlobal("HTMLCanvasElement", class {});
    vi.stubGlobal("window", { setTimeout });
    initConfig();
  });
  afterEach(() => vi.unstubAllGlobals());

  test.each([
    [1_499_871_599, [], true],
    [1_499_871_600, [], false],
    [1_767_196_800, [], false],
    [0, [], true],
    [1_499_871_599, ["gothic"], false],
    [1_499_871_599, ["mincho"], false],
    [1_499_871_599, ["defont"], false],
    [1_767_196_800, ["nico:flash"], true],
    [1_767_196_800, ["nico:flash", "gothic"], false],
    [1_767_196_800, [...Array(64).fill("184"), "nico:flash"], false],
  ])("date %s and commands %j use the same selection as Canvas Auto", (date, mail, expected) => {
    const data = comment({ date, mail });
    for (const mode of ["default", "css"] as const) {
      const options = { ...defaultOptions, mode };
      expect(isFlashComment(data, defaultConfig, options)).toBe(expected);
    }
  });

  test("CSS shares Auto geometry and command parsing for mixed old and new comments", () => {
    const data = [
      comment(),
      comment({ id: 2, date: 1_767_196_800 }),
      comment({ id: 3, mail: ["ue", "big", "@7"] }),
      comment({ id: 4, mail: ["shita", "small", "full"] }),
      comment({ id: 5, owner: true }),
      comment({ id: 6, mail: ["gothic"] }),
    ];
    const instances = ["default", "css"].map(
      (mode) =>
        new NiconiComments(new FakeRenderer(), data, {
          format: "formatted",
          mode: mode as BaseOptions["mode"],
          scale: 0.35,
        }),
    );
    try {
      const snapshots = instances.map((nc) =>
        commentsOf(nc).map((c) => ({
          flash: c.flash,
          width: c.width,
          height: c.height,
          posY: c.posY,
          long: c.long,
          layout: c.comment,
        })),
      );
      expect(snapshots[1]).toEqual(snapshots[0]);
      expect(
        commentsOf(instances[1] as NiconiComments)
          .sort((a, b) => a.comment.id - b.comment.id)
          .map((c) => c.flash),
      ).toEqual([true, false, true, true, true, false]);
    } finally {
      for (const nc of instances) nc.destroy();
    }
  });

  test("custom thresholds, lazy additions and explicit modes keep their semantics", () => {
    const nc = new NiconiComments(new FakeRenderer(), [comment({ date: 99 })], {
      format: "formatted",
      mode: "css",
      lazy: true,
      config: { flashThreshold: 100 },
    });
    try {
      nc.addComments(comment({ id: 2, date: 100 }));
      nc.drawCanvas(100, true);
      expect(commentsOf(nc).map((c) => c.flash)).toEqual([true, false]);
      expect(
        isFlashComment(comment(), defaultConfig, {
          ...defaultOptions,
          mode: "html5",
        }),
      ).toBe(false);
      expect(
        isFlashComment(comment({ mail: ["gothic"] }), defaultConfig, {
          ...defaultOptions,
          mode: "flash",
        }),
      ).toBe(true);
    } finally {
      nc.destroy();
    }
  });
});
