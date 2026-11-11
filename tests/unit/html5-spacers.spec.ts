import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { CommentContentItem } from "@/@types";
import { defaultConfig } from "@/definition/config";
import { initConfig } from "@/definition/initConfig";
import { getHTML5SpacerWidths } from "@/utils/html5Spacers";
import { addHTML5PartToResult } from "@/utils/niconico";

const mockMetrics = (collapsed: boolean) => {
  const native: Record<string, number> = {
    "\u2000": 50,
    "\u2001": 100,
    "\u2002": 50,
    "\u2003": 100,
    "\u2004": 100 / 3,
    "\u2005": 25,
    "\u2006": 100 / 6,
  };
  const measureText = vi.fn((text: string) => ({
    width:
      collapsed && text !== "\u2002" && text !== "\u2003"
        ? 27.783203125
        : native[text],
  }));
  const createElement = vi.fn(() => ({
    getContext: () => ({ font: "", measureText }),
  }));
  vi.stubGlobal("document", { createElement });
  return { measureText, createElement };
};

describe("HTML5 em-space fallback compatibility", () => {
  beforeEach(() => initConfig());
  afterEach(() => vi.unstubAllGlobals());

  test("leaves working browser/font metrics on the native text path", () => {
    mockMetrics(false);
    expect(getHTML5SpacerWidths(defaultConfig, "gothic")).toEqual({});
    const content: CommentContentItem[] = [];
    addHTML5PartToResult(content, "A\u2001\u2004B\n", defaultConfig, "gothic");
    expect(content).toEqual([
      {
        type: "text",
        content: "A\u2001\u2004B\n",
        slicedContent: ["A\u2001\u2004B", ""],
      },
    ]);
  });

  test("repairs only collapsed em-relative spaces, once per instance/font", () => {
    const { createElement } = mockMetrics(true);
    const widths = getHTML5SpacerWidths(defaultConfig, "gothic");
    expect(widths).toEqual({
      "\u2000": 1 / 2,
      "\u2001": 1,
      "\u2004": 1 / 3,
      "\u2005": 1 / 4,
      "\u2006": 1 / 6,
    });
    expect(getHTML5SpacerWidths(defaultConfig, "gothic")).toBe(widths);
    expect(createElement).toHaveBeenCalledTimes(1);
    getHTML5SpacerWidths(defaultConfig, "mincho");
    expect(createElement).toHaveBeenCalledTimes(2);
    initConfig();
    getHTML5SpacerWidths(defaultConfig, "gothic");
    expect(createElement).toHaveBeenCalledTimes(3);
  });

  test("preserves explicit overrides and works without a DOM", () => {
    defaultConfig.compatSpacer.html5 = { "\u2001": { gothic: 0.8 } };
    vi.stubGlobal("document", undefined);
    expect(getHTML5SpacerWidths(defaultConfig, "gothic")).toEqual({
      "\u2001": 0.8,
    });
    initConfig();
    mockMetrics(true);
    defaultConfig.compatSpacer.html5 = { "\u2001": { gothic: 0.8 } };
    expect(getHTML5SpacerWidths(defaultConfig, "gothic")["\u2001"]).toBe(0.8);
  });

  test("preserves empty lines and raw characters without recursive splitting", () => {
    mockMetrics(true);
    const input = `\u2000\n\n${"A\u2001".repeat(8000)}\n\u2004\u2004\n`;
    const parts: CommentContentItem[] = [];
    addHTML5PartToResult(parts, input, defaultConfig, "gothic");
    expect(
      parts
        .map((part) =>
          part.type === "spacer"
            ? part.char.repeat(part.count)
            : part.type === "text"
              ? part.content
              : "",
        )
        .join(""),
    ).toBe(input);
    expect(parts).toContainEqual({
      type: "spacer",
      char: "\u2004",
      charWidth: 1 / 3,
      count: 2,
    });
  });
});
