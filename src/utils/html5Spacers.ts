import type { BaseConfig, HTML5Fonts } from "@/@types";

import { parseFont } from "./comment";

// These spaces have em-relative advances. Figure/punctuation/thin/hair spaces
// are deliberately excluded: their widths depend on the selected font.
const EM_SPACES: Record<string, number> = {
  "\u2000": 1 / 2,
  "\u2001": 1,
  "\u2002": 1 / 2,
  "\u2003": 1,
  "\u2004": 1 / 3,
  "\u2005": 1 / 4,
  "\u2006": 1 / 6,
};

const widthsByConfig = new WeakMap<
  BaseConfig,
  Map<HTML5Fonts, Record<string, number>>
>();

/** Keep WebKit's missing-space fallback out of both layout and painting. */
const getHTML5SpacerWidths = (config: BaseConfig, font: HTML5Fonts) => {
  let cached = widthsByConfig.get(config);
  if (!cached) {
    cached = new Map();
    widthsByConfig.set(config, cached);
  }
  const previous = cached.get(font);
  if (previous) return previous;

  const widths: Record<string, number> = {};
  if (typeof document !== "undefined") {
    const context = document.createElement("canvas").getContext("2d");
    if (context) {
      context.font = parseFont(font, 100, config);
      const en = context.measureText("\u2000").width;
      const em = context.measureText("\u2001").width;
      // A missing-glyph fallback in WebKit/Hiragino collapses both quads
      // to the same space advance. Do not override working fonts/browsers.
      if (en > 0 && Math.abs(en - em) < 0.01) {
        for (const [char, width] of Object.entries(EM_SPACES)) {
          const actual = context.measureText(char).width;
          if (Math.abs(actual - width * 100) > 0.5) widths[char] = width;
        }
      }
    }
  }
  // Explicit compatibility settings continue to take precedence.
  for (const [char, setting] of Object.entries(config.compatSpacer.html5)) {
    const width = setting[font];
    if (width !== undefined) widths[char] = width;
  }
  cached.set(font, widths);
  return widths;
};

export { getHTML5SpacerWidths };
