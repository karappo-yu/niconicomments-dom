import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { FrameActiveState, IComment } from "@/@types";
import { defaultConfig, defaultOptions } from "@/definition/config";
import { initConfig } from "@/definition/initConfig";
import { CSSRenderer } from "@/renderer/css";

class FakeStyle {
  [key: string]: unknown;
  private props = new Map<string, string>();
  cssText = "";
  animation = "";
  animationName = "";
  top = "";
  left = "";
  width = "";
  height = "";
  paddingTop = "";
  fontSize = "";
  lineHeight = "";
  color = "";
  zIndex = "";
  webkitTextStroke = "";
  textShadow = "";
  opacity = "";
  boxSizing = "";
  backgroundColor = "";
  border = "";
  outline = "";
  outlineOffset = "";
  font = "";
  fontFamily = "";
  fontWeight = "";
  position = "";
  overflow = "";
  transformOrigin = "";
  transform = "";
  visibility = "";
  display = "";

  setProperty(name: string, value: string) {
    this.props.set(name, value);
  }
  getPropertyValue(name: string) {
    return this.props.get(name) ?? "";
  }
}

class FakeElement {
  tagName: string;
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  children: Array<FakeElement | FakeTextNode> = [];
  parentElement: FakeElement | null = null;
  style = new FakeStyle();
  classList = {
    add: (_name: string) => {},
    remove: (_name: string) => {},
  };
  private _textContent = "";

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this.children
      .map((child) =>
        child instanceof FakeTextNode ? child.textContent : child.textContent,
      )
      .join("");
  }

  set textContent(value: string) {
    this.children = [];
    this._textContent = value;
  }

  get lastChild() {
    return this.children.at(-1) ?? null;
  }

  get lastElementChild(): FakeElement | null {
    for (let i = this.children.length - 1; i >= 0; i--) {
      const child = this.children[i];
      if (child instanceof FakeElement) return child;
    }
    return null;
  }

  get offsetWidth() {
    return 0;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  appendChild<T extends FakeElement | FakeTextNode>(node: T): T {
    if (node instanceof FakeFragment) {
      for (const child of node.children) {
        child.parentElement = this;
        this.children.push(child);
      }
      node.children = [];
      return node;
    }
    if (node instanceof FakeElement) {
      node.parentElement = this;
    }
    this.children.push(node);
    return node;
  }

  replaceChildren(...nodes: Array<FakeElement | FakeTextNode>) {
    this._textContent = "";
    this.children = [];
    for (const node of nodes) {
      this.appendChild(node);
    }
  }

  remove() {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx >= 0) this.parentElement.children.splice(idx, 1);
    this.parentElement = null;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1920, height: 1080 };
  }

  getAnimations() {
    return [];
  }
}

class FakeTextNode {
  nodeType = 3;
  textContent: string;
  constructor(text: string) {
    this.textContent = text;
  }
}

class FakeFragment extends FakeElement {
  constructor() {
    super("#fragment");
  }
}

const createHtml5Comment = (
  overrides: Partial<IComment["comment"]> & {
    index?: number;
    posY?: number;
    owner?: boolean;
    loc?: "ue" | "shita" | "naka";
    content?: string;
  } = {},
): IComment => {
  const {
    index = 0,
    posY = 100,
    owner = false,
    loc = "ue",
    content = "test",
    ...commentOverrides
  } = overrides;
  const commentData: IComment["comment"] = {
    id: 1,
    vpos: 100,
    content: [
      { type: "text", content, slicedContent: [content], width: [100] },
    ],
    rawContent: content,
    date: 1_700_000_000,
    date_usec: 0,
    owner,
    premium: true,
    mail: [loc],
    user_id: 1,
    layer: -1,
    is_my_post: false,
    color: "#FFFFFF",
    size: "medium",
    loc,
    long: 300,
    font: "defont",
    fontSize: 20,
    charSize: 25,
    lineHeight: 29,
    lineCount: 1,
    lineOffset: 0,
    width: 120,
    height: 40,
    resized: false,
    resizedX: false,
    resizedY: false,
    full: false,
    invisible: false,
    scale: 1,
    scaleX: 1,
    ...commentOverrides,
  };
  return {
    comment: commentData,
    index,
    posY,
    loc,
    vpos: commentData.vpos,
    long: commentData.long,
    width: commentData.width,
    height: commentData.height,
    owner,
    flash: false,
    invisible: false,
    mail: commentData.mail,
    content: commentData.rawContent,
    layer: commentData.layer,
    draw: () => {},
    isHovered: () => false,
  };
};

const activeState: FrameActiveState = {
  banActive: false,
  reverseActiveOwner: false,
  reverseActiveViewer: false,
};

const parseCalcNumber = (expr: string): number => {
  const m = /^calc\(([-\d.eE]+)\s*\*\s*var\(--dm-unit\)\)$/.exec(expr.trim());
  if (!m) throw new Error(`Unexpected calc expression: ${expr}`);
  return Number(m[1]);
};

describe("CSSRenderer style alignment with Canvas", () => {
  let head: FakeElement;
  let body: FakeElement;
  let host: FakeElement;
  let canvas: FakeElement;
  let ascent = 85;
  let descent = 30;

  beforeEach(() => {
    initConfig();
    ascent = 85;
    descent = 30;
    head = new FakeElement("head");
    body = new FakeElement("body");
    host = new FakeElement("div");
    canvas = new FakeElement("canvas");
    host.appendChild(canvas);
    class FakeNode {
      static readonly TEXT_NODE = 3;
    }
    vi.stubGlobal("Node", FakeNode);
    vi.stubGlobal("window", {
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    vi.stubGlobal("getComputedStyle", () => ({ position: "relative" }));
    vi.stubGlobal("document", {
      head,
      body,
      createElement: (tag: string) => {
        if (tag === "canvas") {
          return {
            getContext: () => ({
              font: "",
              measureText: () => ({
                width: 100,
                fontBoundingBoxAscent: ascent,
                fontBoundingBoxDescent: descent,
              }),
            }),
          };
        }
        return new FakeElement(tag);
      },
      createDocumentFragment: () => new FakeFragment(),
      createTextNode: (text: string) => new FakeTextNode(text),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("preserves round stroke joins without textShadow blur on stroked comments", () => {
    const renderer = new CSSRenderer(
      canvas as unknown as HTMLCanvasElement,
      defaultConfig,
      { ...defaultOptions, mode: "css" },
    );
    try {
      const styleEl = head.children[0] as FakeElement;
      expect(styleEl.textContent).toContain("stroke-linejoin: round;");

      const html5 = createHtml5Comment({ index: 0 });
      const flash: IComment = {
        ...createHtml5Comment({ index: 1, fontSize: 24, lineHeight: 29 / 25 }),
        flash: true,
      };
      renderer.updateComments([html5, flash], 100, activeState);

      const container = host.children.find((c) =>
        c instanceof FakeElement
          ? c.attributes.has("data-dm-css-container")
          : false,
      ) as FakeElement;
      expect(container.children).toHaveLength(2);
      for (const el of container.children as FakeElement[]) {
        expect(el.style.webkitTextStroke).toContain("var(--dm-unit)");
        expect(el.style.paintOrder).toBe("stroke fill");
        expect(el.style.textShadow).toBe("none");
      }
    } finally {
      renderer.destroy();
    }
  });

  test.each([
    0, 2.5, 10,
  ])("scales HTML5 shadow blur %s and paints Flash shadows on the glyph layer", (blur) => {
    const renderer = new CSSRenderer(
      canvas as unknown as HTMLCanvasElement,
      { ...defaultConfig, cssTextShadowBlur: blur },
      { ...defaultOptions, mode: "css", scale: 0.5 },
    );
    try {
      const html5 = createHtml5Comment({
        index: 0,
        charSize: 10,
        lineHeight: 12,
      });
      const flash = {
        ...createHtml5Comment({ index: 1, fontSize: 24, scale: 0.5 }),
        flash: true,
      };
      renderer.updateComments([html5, flash], 100, activeState);
      const container = host.children.find(
        (el) =>
          el instanceof FakeElement &&
          el.attributes.has("data-dm-css-container"),
      ) as FakeElement;
      const [html5El, flashEl] = container.children as FakeElement[];
      if (!html5El || !flashEl) throw new Error("Missing comments");
      const layer = flashEl.children[0] as FakeElement;
      expect(flashEl.style.textShadow).toBe("none");
      if (blur === 0) {
        expect(html5El.style.textShadow).toBe("none");
        expect(layer.style.textShadow).toBe("none");
      } else {
        expect(html5El.style.textShadow).toContain(
          `0 0 calc(${blur * defaultConfig.commentScale.html5 * 0.8 * 0.5} * var(--dm-unit))`,
        );
        expect(layer.style.textShadow).toContain(`0 0 ${blur}px`);
        expect(layer.style.textShadow).toContain("rgba(0,0,0,0.4)");
        // Fixed combo content replacement must retain the Flash shadow.
        flash.content = "replacement";
        renderer.updateComments([html5, flash], 120, activeState);
        expect((flashEl.children[0] as FakeElement).style.textShadow).toBe(
          layer.style.textShadow,
        );
      }
    } finally {
      renderer.destroy();
    }
  });

  test.each([
    0, 1.5,
  ])("renders a glyph shadow independently of zero stroke width (blur=%s)", (blur) => {
    const renderer = new CSSRenderer(
      canvas as unknown as HTMLCanvasElement,
      {
        ...defaultConfig,
        cssTextShadowBlur: blur,
        contextLineWidth: { html5: 0, flash: 0 },
      },
      { ...defaultOptions, mode: "css" },
    );
    try {
      renderer.updateComments(
        [
          createHtml5Comment(),
          { ...createHtml5Comment({ index: 1 }), flash: true },
        ],
        100,
        activeState,
      );
      const container = host.children.find(
        (el) =>
          el instanceof FakeElement &&
          el.attributes.has("data-dm-css-container"),
      ) as FakeElement;
      for (const el of container.children as FakeElement[]) {
        expect(el.style.paintOrder).toBe("normal");
        expect(el.style.webkitTextStroke).toContain("calc(0 * var(--dm-unit))");
        const glyph = el.children.length ? (el.children[0] as FakeElement) : el;
        expect(glyph.style.paintOrder).toBe("normal");
        if (blur === 0) expect(glyph.style.textShadow).toBe("none");
        else {
          expect(glyph.style.textShadow).toMatch(/^0 0 /);
          expect(glyph.style.textShadow).toContain("rgba(0,0,0,0.4)");
        }
        if (el.children.length) expect(el.style.textShadow).toBe("none");
      }
    } finally {
      renderer.destroy();
    }
  });

  test("applies paddingTopCanvas only for owner && resizedX HTML5 comments", () => {
    const renderer = new CSSRenderer(
      canvas as unknown as HTMLCanvasElement,
      defaultConfig,
      { ...defaultOptions, mode: "css" },
    );
    try {
      // charSize = 10 -> charSize * 0.8 = 8 < html5MinFontSize (10), so fontScale = 0.8
      const normalResized = createHtml5Comment({
        index: 0,
        owner: false,
        resizedX: true,
        charSize: 10,
        lineHeight: 12,
      });
      const ownerResized = createHtml5Comment({
        index: 1,
        owner: true,
        resizedX: true,
        charSize: 10,
        lineHeight: 12,
      });
      renderer.updateComments([normalResized, ownerResized], 100, activeState);

      const container = host.children.find((c) =>
        c instanceof FakeElement
          ? c.attributes.has("data-dm-css-container")
          : false,
      ) as FakeElement;
      const [normalEl, ownerEl] = container.children as FakeElement[];
      if (!normalEl || !ownerEl) throw new Error("Missing rendered elements");

      const drawScale = defaultConfig.commentScale.html5;
      const expectedPaddingTopCanvas =
        (10 - 0.8 * 10) *
        (2 / defaultConfig.html5HiResCommentCorrection) *
        (12 * drawScale);

      const normalPad = parseCalcNumber(normalEl.style.paddingTop);
      const ownerPad = parseCalcNumber(ownerEl.style.paddingTop);
      expect(ownerPad - normalPad).toBeCloseTo(expectedPaddingTopCanvas, 6);
    } finally {
      renderer.destroy();
    }
  });

  test("computes HTML5 baselineCorrection using both ascent and descent", () => {
    const renderer = new CSSRenderer(
      canvas as unknown as HTMLCanvasElement,
      defaultConfig,
      { ...defaultOptions, mode: "css" },
    );
    try {
      const c = createHtml5Comment({
        index: 0,
        charSize: 25,
        lineHeight: 30,
      });
      renderer.updateComments([c], 100, activeState);
      const container = host.children.find((el) =>
        el instanceof FakeElement
          ? el.attributes.has("data-dm-css-container")
          : false,
      ) as FakeElement;
      const el = container.children[0] as FakeElement;

      const drawScale = defaultConfig.commentScale.html5;
      const fontSizePx = 20 * drawScale;
      const lineHeightPx = 30 * drawScale;
      const fontOffset = defaultConfig.fonts.html5.defont.offset;
      const offsetYCanvas =
        ((25 - 30) / 2 + 30 * -0.16 + fontOffset) * drawScale;
      // baseline = (100 + 85 - 30) / 200 = 0.775
      const expectedBaselineCorrection =
        lineHeightPx / 2 + fontSizePx / 2 - 0.775 * fontSizePx;
      expect(parseCalcNumber(el.style.paddingTop)).toBeCloseTo(
        offsetYCanvas + expectedBaselineCorrection,
        6,
      );
    } finally {
      renderer.destroy();
    }
  });

  test("renders nico:waku with main lineWidth via non-shifting outline and syncs HTML5 box size", () => {
    const renderer = new CSSRenderer(
      canvas as unknown as HTMLCanvasElement,
      defaultConfig,
      { ...defaultOptions, mode: "css", scale: 0.5 },
    );
    try {
      const wakuComment = createHtml5Comment({
        index: 0,
        wakuColor: "#FF0000",
        fillColor: "#00FF00",
        width: 240,
        height: 48,
      });
      renderer.updateComments([wakuComment], 100, activeState);
      const container = host.children.find((el) =>
        el instanceof FakeElement
          ? el.attributes.has("data-dm-css-container")
          : false,
      ) as FakeElement;
      const el = container.children[0] as FakeElement;

      const expectedLineWidth = defaultConfig.contextLineWidth.html5;
      expect(el.style.border).toBe("");
      expect(el.style.outline).toBe(
        `calc(${expectedLineWidth} * var(--dm-unit)) solid #FF0000`,
      );
      expect(el.style.outlineOffset).toBe(
        `calc(${-expectedLineWidth / 2} * var(--dm-unit))`,
      );
      expect(el.style.boxSizing).toBe("border-box");
      expect(el.style.backgroundColor).toBe("#00FF00");
      expect(el.style.width).toBe("calc(240 * var(--dm-unit))");
      expect(el.style.height).toBe("calc(48 * var(--dm-unit))");

      // Simulate fixedCombo growth updating width
      wakuComment.content = "testx2";
      wakuComment.comment.rawContent = "testx2";
      wakuComment.comment.width = 300;
      wakuComment.width = 300;
      renderer.updateComments([wakuComment], 120, activeState);
      expect(el.style.width).toBe("calc(300 * var(--dm-unit))");
    } finally {
      renderer.destroy();
    }
  });
});
