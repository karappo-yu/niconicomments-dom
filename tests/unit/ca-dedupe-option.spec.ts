import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { FormattedComment, IComment, Options } from "@/@types";
import { InvalidOptionError } from "@/errors";
import NiconiComments from "@/main";
import { FakeRenderer } from "../bench/helpers";

const rows = (): FormattedComment[] =>
  [
    {
      id: 1,
      owner: false,
      content: "same CA",
      date: 1700000000,
      vpos: 100,
      mail: ["ca"],
      user_id: 1,
    },
    {
      id: 2,
      owner: false,
      content: "same CA",
      date: 1700003600,
      vpos: 150,
      mail: ["ca"],
      user_id: 1,
    },
    {
      id: 3,
      owner: true,
      content: "owner",
      date: 1700000000,
      vpos: 200,
      mail: [],
      user_id: 2,
    },
    {
      id: 4,
      owner: true,
      content: "owner",
      date: 1700003600,
      vpos: 250,
      mail: [],
      user_id: 2,
    },
  ].map((row) => ({
    date_usec: 0,
    premium: true,
    layer: -1,
    is_my_post: false,
    ...row,
  }));
const comments = (instance: NiconiComments) =>
  (instance as unknown as { comments: IComment[] }).comments;
const create = (options: Options = {}) =>
  new NiconiComments(new FakeRenderer(), rows(), {
    format: "formatted",
    keepCA: true,
    ...options,
  });

describe("CA layer and duplicate policies", () => {
  beforeEach(() => {
    vi.stubGlobal("HTMLCanvasElement", class {});
    vi.stubGlobal("window", { setTimeout });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  test("the default retains the existing keepCA dedupe behavior", () => {
    const instance = create();
    expect(comments(instance).map((c) => c.comment.id)).toEqual([1, 3]);
    instance.destroy();
  });
  test.each([
    "css",
    "default",
  ] as const)("dedupeCA=false keeps viewer and owner records while assigning CA layers (%s)", (mode) => {
    const instance = create({ mode, dedupeCA: false });
    expect(comments(instance).map((c) => c.comment.id)).toEqual([1, 2, 3, 4]);
    expect(comments(instance).map((c) => c.layer)).toEqual([0, 1, -1, -1]);
    instance.destroy();
  });
  test("keepCA=false still disables layering independently", () => {
    const instance = create({ keepCA: false, dedupeCA: false });
    expect(comments(instance).map((c) => c.layer)).toEqual([-1, -1, -1, -1]);
    instance.destroy();
  });
  test("the new option rejects non-boolean values at the public constructor", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => create({ dedupeCA: "false" as unknown as boolean })).toThrow(
      InvalidOptionError,
    );
  });
});
