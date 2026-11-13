import type {
  BaseConfig,
  BaseOptions,
  CommentFont,
  FormattedCommentWithSize,
  FrameActiveState,
  IComment,
} from "@/@types/";
import { getConfig, getFontSizeAndScale, getStrokeColor } from "@/utils";
import { getScrollSpeed } from "@/utils/comment";

const POOL_MAX_SIZE = 512;

const CSS = `
@keyframes dm-scroll {
  from { transform: translateX(calc(var(--dm-from) * var(--dm-unit))); }
  to   { transform: translateX(calc(var(--dm-to) * var(--dm-unit))); }
}
@keyframes dm-scroll-alt {
  from { transform: translateX(calc(var(--dm-from) * var(--dm-unit))); }
  to   { transform: translateX(calc(var(--dm-to) * var(--dm-unit))); }
}
@keyframes dm-pop {
  from { transform: translateX(-50%) scale(1.15); }
  to   { transform: translateX(-50%) scale(1); }
}
[data-dm-css-container] {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 1;
  font-family: Arial, "MS PGothic", MSPGothic, MS-PGothic, sans-serif;
}
[data-dm-css-container].dm-paused [data-dm-comment] {
  animation-play-state: paused !important;
}
[data-dm-comment] {
  position: absolute;
  will-change: transform, opacity;
  contain: layout style;
  overflow: visible;
  white-space: pre;
  pointer-events: none;
  paint-order: stroke fill;
  stroke-linejoin: round;
}
`;

class CSSRenderer {
  private readonly config: BaseConfig;
  private readonly options: BaseOptions;
  private container: HTMLDivElement;
  private pool: HTMLDivElement[] = [];
  private activeElements: Map<number, HTMLDivElement> = new Map();
  private activeSeenGeneration: Map<number, number> = new Map();
  private activeElementReverse: Map<number, boolean> = new Map();
  private visibilityGeneration = 0;
  private motionDirty = false;
  private styleElement: HTMLStyleElement;
  private paused = false;
  private lastUpdateVpos = -1;
  private playbackSpeed = 1;
  private measureCanvas: HTMLCanvasElement | null = null;
  private fontMetricsCache = new Map<
    string,
    { ascent: number; baseline: number }
  >();
  private readonly canvas: HTMLCanvasElement;
  private readonly host: HTMLElement;
  private viewportWidth: number;
  private viewportOffsetX = 0;
  private resizeObserver?: ResizeObserver;
  private readonly syncBounds = () => {
    const canvasRect = this.canvas.getBoundingClientRect();
    const hostRect = this.host.getBoundingClientRect();
    const aspect = this.viewportWidth / this.config.canvasHeight;
    const height = Math.min(canvasRect.height, canvasRect.width / aspect);
    const width = height * aspect;
    this.container.style.left = `${canvasRect.left - hostRect.left + this.host.scrollLeft - this.host.clientLeft + (canvasRect.width - width) / 2}px`;
    this.container.style.top = `${canvasRect.top - hostRect.top + this.host.scrollTop - this.host.clientTop + (canvasRect.height - height) / 2}px`;
    this.container.style.width = `${width}px`;
    this.container.style.height = `${height}px`;
    this.container.style.setProperty(
      "--dm-unit",
      `${height / this.config.canvasHeight}px`,
    );
    this.container.style.setProperty(
      "--dm-display-scale",
      String(height / this.config.canvasHeight),
    );
  };

  constructor(
    canvas: HTMLCanvasElement,
    config: BaseConfig,
    options: BaseOptions,
  ) {
    this.config = config;
    this.options = options;
    this.canvas = canvas;
    this.viewportWidth = config.canvasWidth;
    this.container = document.createElement("div");
    this.container.setAttribute("data-dm-css-container", "");

    const parent = canvas.parentElement;
    this.host = parent ?? document.body;
    if (parent) {
      if (getComputedStyle(parent).position === "static") {
        parent.style.position = "relative";
      }
      parent.appendChild(this.container);
    } else {
      document.body.appendChild(this.container);
    }

    this.styleElement = document.createElement("style");
    this.styleElement.textContent = CSS;
    document.head.appendChild(this.styleElement);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.syncBounds);
      this.resizeObserver.observe(canvas);
      this.resizeObserver.observe(this.host);
    }
    window.addEventListener("resize", this.syncBounds);
    this.syncBounds();
  }

  setViewport(width: number, offsetX: number) {
    if (width !== this.viewportWidth || offsetX !== this.viewportOffsetX) {
      this.clear();
      this.viewportWidth = width;
      this.viewportOffsetX = offsetX;
    }
    this.syncBounds();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.container.classList.add("dm-paused");
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.container.classList.remove("dm-paused");
  }

  updateComments(
    comments: readonly IComment[],
    vpos: number,
    frameActiveState: FrameActiveState,
  ): number {
    if (frameActiveState.banActive) {
      if (this.activeElements.size > 0) {
        this.clear();
      }
      return 0;
    }

    const generation = ++this.visibilityGeneration;
    const motionDirty = this.motionDirty;
    this.motionDirty = false;
    const isSeek =
      this.lastUpdateVpos >= 0 && Math.abs(vpos - this.lastUpdateVpos) > 150;
    let drawnCount = 0;

    let startIndex = 0;
    let endIndex = comments.length;
    const limit = this.config.commentLimit;
    const excludedByLimit = new Set<number>();
    if (limit !== undefined) {
      if (limit === 0) {
        if (this.activeElements.size > 0) this.clear();
        this.lastUpdateVpos = vpos;
        return 0;
      }
      if (this.config.hideCommentOrder === "asc") {
        startIndex = Math.max(0, comments.length - limit);
      } else {
        endIndex = Math.min(comments.length, limit);
      }
      for (let i = 0; i < startIndex; i++) {
        const c = comments[i];
        if (c) excludedByLimit.add(c.index);
      }
      for (let i = endIndex; i < comments.length; i++) {
        const c = comments[i];
        if (c) excludedByLimit.add(c.index);
      }
    }

    const newElements: HTMLDivElement[] = [];

    for (let i = startIndex; i < endIndex; i++) {
      const isReverse = comments[i]?.owner
        ? frameActiveState.reverseActiveOwner
        : frameActiveState.reverseActiveViewer;
      const comment = comments[i];
      if (!comment || comment.invisible) {
        continue;
      }

      this.activeSeenGeneration.set(comment.index, generation);

      const element = this.activeElements.get(comment.index);
      if (element && motionDirty) {
        const posY =
          comment.loc === "shita"
            ? this.config.canvasHeight - comment.posY - comment.height
            : comment.posY;
        element.style.top = `calc(${posY} * var(--dm-unit))`;
      }

      if (!element) {
        if (!this.createCommentElement(comment, vpos, isReverse)) {
          this.activeSeenGeneration.delete(comment.index);
          continue;
        }
        const newEl = this.activeElements.get(comment.index);
        if (newEl) newElements.push(newEl!);
      } else if (
        comment.loc === "naka" &&
        (isSeek ||
          motionDirty ||
          isReverse !== this.activeElementReverse.get(comment.index))
      ) {
        this.reanimateScroll(comment, vpos, isReverse);
      } else {
        if (comment.loc !== "naka") {
          this.syncFixedCombo(element, comment);
        }
        if (isSeek) {
          this.setupFixedAnimation(element);
        }
      }
      drawnCount++;
    }

    this.lastUpdateVpos = vpos;

    if (newElements.length > 0) {
      const fragment = document.createDocumentFragment();
      for (let i = 0, n = newElements.length; i < n; i++) {
        fragment.appendChild(newElements[i]!);
      }
      this.container.appendChild(fragment);
    }

    for (const [index, element] of this.activeElements) {
      if (this.activeSeenGeneration.get(index) !== generation) {
        if (!motionDirty && !excludedByLimit.has(index)) {
          // CSS animation の再生状態を確認。running/paused ならまだ画面上。
          // getAnimations() は CSS @keyframes アニメーションも返す。
          // dm-pop(combo 演出)は装飾のみで、生存判定から除外する。
          const anims = element.getAnimations();
          let stillPlaying = false;
          for (let i = 0, n = anims.length; i < n; i++) {
            const anim = anims[i];
            if (!anim) continue;
            if ((anim as CSSAnimation).animationName === "dm-pop") continue;
            const state = anim.playState;
            if (state === "running" || state === "paused") {
              stillPlaying = true;
              break;
            }
          }
          if (stillPlaying) continue;
        }
        this.recycleElement(element);
        this.activeElements.delete(index);
        this.activeSeenGeneration.delete(index);
        this.activeElementReverse.delete(index);
      }
    }

    return drawnCount;
  }

  private createCommentElement(
    comment: IComment,
    vpos: number,
    isReverse: boolean,
  ): boolean {
    const element = this.getElementFromPool();
    const c = comment.comment;

    const drawScale = getConfig(this.config.commentScale, comment.flash);
    // owner コメント(投稿者コメント)はスケール調整の対象外
    const rawLayerScale =
      c.layer === -1 && !comment.owner ? this.options.scale : 1;
    // Flash stores a font size plus resize scale; HTML5 stores charSize.
    // In particular Flash charSize is zero, so the HTML5 calculation would
    // make every old comment disappear when CSS follows Auto selection.
    const { fontSize: renderFontSize, scale: fontScale } = comment.flash
      ? { fontSize: c.fontSize, scale: c.scale }
      : getFontSizeAndScale(c.charSize, this.config);
    const layerScale = rawLayerScale;
    const fontSizePx = renderFontSize * drawScale * fontScale * layerScale;

    const lineHeightPx = comment.flash
      ? c.fontSize * c.lineHeight * drawScale * fontScale * layerScale
      : c.lineHeight * drawScale * layerScale;

    const paddingTop =
      comment.owner && c.resizedX
        ? (10 - fontScale * 10) *
          ((c.lineCount + 1) / this.config.html5HiResCommentCorrection)
        : 0;
    const paddingTopCanvas = paddingTop * lineHeightPx;

    const fontOffset =
      (c.font === "gothic" || c.font === "mincho" || c.font === "defont"
        ? this.config.fonts.html5[c.font]?.offset
        : undefined) ?? 0;
    const offsetY =
      (c.charSize - c.lineHeight) / 2 + c.lineHeight * -0.16 + fontOffset;
    const offsetYCanvas = offsetY * drawScale * layerScale;

    let posY: number;
    if (comment.loc === "shita") {
      posY = this.config.canvasHeight - comment.posY - comment.height;
    } else {
      posY = comment.posY;
    }

    // fixedCombo/nakaDedupe 宿主: 本体原生样式 + 随机色 xN 后缀 span;
    // 无后缀时退化为整串 textContent(所有弹幕通用)
    this.applyComboContent(element, comment);

    const lineWidth = getConfig(this.config.contextLineWidth, comment.flash);
    const strokeColor = getStrokeColor(c, this.config);
    const strokeWidthPx = lineWidth * drawScale * fontScale * layerScale;

    const effectiveAlpha = this.getEffectiveAlpha(c);

    this.applyFont(element, c.font, comment.flash);

    let paddingTopCss = "0";
    if (!comment.flash) {
      const fontFamily = element.style.fontFamily || "sans-serif";
      const fontWeight = element.style.fontWeight || "400";
      const metrics = this.measureFontMetrics(fontFamily, fontWeight);
      const baselineCorrection =
        lineHeightPx / 2 + fontSizePx / 2 - metrics.baseline * fontSizePx;
      paddingTopCss = `calc(${paddingTopCanvas + offsetYCanvas + baselineCorrection} * var(--dm-unit))`;
    }

    element.style.top = `calc(${posY} * var(--dm-unit))`;
    element.style.paddingTop = paddingTopCss;
    element.style.fontSize = `calc(${fontSizePx} * var(--dm-unit))`;
    element.style.lineHeight = String(lineHeightPx / fontSizePx);
    element.style.color = c.color;
    element.style.zIndex = String(
      (comment.owner ? 0x40000000 : 0) +
        (comment.fixedComboZIndex ?? comment.index) +
        1,
    );
    element.style.webkitTextStroke = `calc(${strokeWidthPx} * var(--dm-unit)) ${strokeColor}`;
    // WebKit can suppress fill shadows with stroke-first painting and a zero
    // stroke. Shadow-only text must use normal painting to blur the glyph fill.
    element.style.paintOrder = strokeWidthPx > 0 ? "stroke fill" : "normal";
    // Flash paints on its own transformed layer; avoid inheriting a shadow
    // already scaled for the HTML5 outer element.
    element.style.textShadow =
      !comment.flash && this.config.cssTextShadowBlur > 0
        ? `0 0 calc(${this.config.cssTextShadowBlur * drawScale * fontScale * layerScale} * var(--dm-unit)) ${strokeColor}`
        : "none";

    if (effectiveAlpha !== 1) {
      element.style.opacity = String(effectiveAlpha);
    }

    if (!comment.flash && (c.fillColor || c.wakuColor)) {
      element.style.boxSizing = "border-box";
      element.style.width = `calc(${c.width} * var(--dm-unit))`;
      element.style.height = `calc(${c.height} * var(--dm-unit))`;
    }

    if (c.fillColor) {
      element.style.backgroundColor = c.fillColor;
    }

    if (c.wakuColor) {
      const borderWidthPx = getConfig(this.config.contextLineWidth, false);
      element.style.outline = `calc(${borderWidthPx} * var(--dm-unit)) solid ${c.wakuColor}`;
      element.style.outlineOffset = `calc(${-borderWidthPx / 2} * var(--dm-unit))`;
    }

    if (comment.loc === "naka") {
      if (!this.setupScrollAnimation(element, comment, vpos, isReverse)) {
        this.recycleElement(element);
        return false;
      }
    } else {
      this.setupFixedAnimation(element);
    }

    this.activeElementReverse.set(comment.index, isReverse);

    this.activeElements.set(comment.index, element);

    // 再生速度変更時の再アニメーション用に comment を保持
    (element as HTMLDivElement & { __dmComment?: IComment }).__dmComment =
      comment;

    // CSS animation の pause は container の class で一括管理
    return true;
  }

  private reanimateScroll(comment: IComment, vpos: number, isReverse: boolean) {
    const element = this.activeElements.get(comment.index);
    if (!element) return;

    if (!this.setupScrollAnimation(element, comment, vpos, isReverse)) {
      this.recycleElement(element);
      this.activeElements.delete(comment.index);
      this.activeSeenGeneration.delete(comment.index);
      this.activeElementReverse.delete(comment.index);
      return;
    }

    this.activeElementReverse.set(comment.index, isReverse);
  }

  setPlaybackSpeed(speed: number) {
    const next = Number.isFinite(speed) && speed > 0 ? speed : 1;
    if (next === this.playbackSpeed) return;
    this.playbackSpeed = next;

    // 再生速度が変わった瞬間だけ、全てのアクティブなスクロール弾幕を
    // 現在の vpos 基準で再アニメーションする (位置は連続、時間は新速度に合わせて縮尺)。
    // 固定コメント(ue/shita)はアニメーションを持たず vpos 可視性のみで制御されるため不要。
    for (const [index, element] of this.activeElements) {
      const comment = (element as HTMLDivElement & { __dmComment?: IComment })
        .__dmComment;
      if (comment?.loc !== "naka") continue;
      const isReverse = this.activeElementReverse.get(index) ?? false;
      this.reanimateScroll(comment, this.lastUpdateVpos, isReverse);
    }
  }

  /** The next frame refreshes each surviving node once after relayout. */
  invalidateMotion() {
    this.motionDirty = true;
  }

  private setupScrollAnimation(
    element: HTMLDivElement,
    comment: IComment,
    vpos: number,
    isReverse: boolean,
  ): boolean {
    const c = comment.comment;
    const commentScale = getConfig(this.config.commentScale, comment.flash);
    // owner コメント(投稿者コメント)はスケール調整の対象外
    const rawLayerScale =
      c.layer === -1 && !comment.owner ? this.options.scale : 1;
    const { fontSize: renderFontSize, scale: fontScale } = comment.flash
      ? { fontSize: c.fontSize, scale: c.scale }
      : getFontSizeAndScale(c.charSize, this.config);
    const layerScale = rawLayerScale;
    const fontSizePx = renderFontSize * commentScale * fontScale * layerScale;

    const speed = getScrollSpeed(comment, this.config);

    const vposLapsed = vpos - comment.vpos;
    const normalXPx =
      this.config.commentDrawPadding +
      this.config.commentDrawRange -
      (vposLapsed + 100) * speed;

    const currentXPx = normalXPx + this.viewportOffsetX;
    const toXPx = Math.min(0, this.viewportOffsetX) - (c.width + fontSizePx);
    const remainingPx = currentXPx - toXPx;
    // アニメーションは実時間駆動のため、再生速度の倍率で除算して
    // スクロール時間を「ビデオ時間」基準に揃える (1x では何も変わらない)
    const remainingSec = remainingPx / (speed * 100) / this.playbackSpeed;

    if (remainingSec <= 0) {
      return false;
    }

    let fromXPx: number;
    let endXPx: number;
    if (isReverse) {
      fromXPx = this.viewportWidth - c.width - currentXPx;
      endXPx = this.viewportWidth - c.width - toXPx;
    } else {
      fromXPx = currentXPx;
      endXPx = toXPx;
    }

    // CSS @keyframes 経由: JS の Animation オブジェクトを作らず CSS エンジンに任せる
    element.style.setProperty("--dm-from", String(fromXPx));
    element.style.setProperty("--dm-to", String(endXPx));
    // Alternating equivalent names restarts CSS animation at style resolution,
    // without an offsetWidth read/layout flush for every comment.
    const name =
      element.style.animationName === "dm-scroll"
        ? "dm-scroll-alt"
        : "dm-scroll";
    element.style.animation = `${name} ${remainingSec}s linear forwards`;
    return true;
  }

  private setupFixedAnimation(element: HTMLDivElement) {
    element.style.left = "50%";
    element.style.transform = "translateX(-50%)";
  }

  /**
   * 写入弹幕文本:fixedCombo 宿主拆分本体 + 随机色 xN 后缀 span,
   * 其余弹幕保持整串 textContent。
   * @param element 目标元素
   * @param comment 弹幕实例
   */
  private applyComboContent(element: HTMLDivElement, comment: IComment): void {
    const c = comment.comment;
    const suffix = c.comboSuffix;
    const content = comment.content;
    if (comment.flash) {
      this.applyFlashContent(element, comment);
      return;
    }
    if (!comment.flash && c.content.some((item) => item.type === "spacer")) {
      element.replaceChildren();
      for (const item of c.content) {
        if (item.type === "spacer") {
          const span = document.createElement("span");
          span.dataset.dmSpacer = "";
          span.textContent = item.char.repeat(item.count);
          span.style.display = "inline-block";
          span.style.width = `${item.count * item.charWidth}em`;
          element.appendChild(span);
        } else {
          element.appendChild(document.createTextNode(item.content));
        }
      }
      if (suffix && element.lastChild?.nodeType === Node.TEXT_NODE) {
        const last = element.lastChild;
        last.textContent = (last.textContent ?? "").slice(0, -suffix.length);
        const span = document.createElement("span");
        span.textContent = suffix;
        span.style.color = c.comboSuffixColor ?? "inherit";
        element.appendChild(span);
      }
      return;
    }
    if (!suffix) {
      if (element.textContent !== content) element.textContent = content;
      return;
    }
    // 池复用的元素可能残留旧 dataset,须确认 span 子节点确实存在
    if (element.dataset.dmComboSuffix === suffix && element.lastElementChild) {
      return;
    }
    const base = content.slice(0, -suffix.length);
    element.replaceChildren();
    element.appendChild(document.createTextNode(base));
    const span = document.createElement("span");
    span.textContent = suffix;
    span.style.color = c.comboSuffixColor ?? "inherit";
    element.appendChild(span);
    element.dataset.dmComboSuffix = suffix;
  }

  private applyFlashContent(element: HTMLDivElement, comment: IComment): void {
    const c = comment.comment;
    const layerScale =
      c.layer === -1 && !comment.owner ? this.options.scale : 1;
    const scale =
      getConfig(this.config.commentScale, true) * c.scale * layerScale;
    const lineHeight = c.fontSize * c.lineHeight;
    const offsetKey = c.resizedY ? "resized" : "default";
    const offsetY =
      this.config.flashCommentYPaddingTop[offsetKey] +
      lineHeight * this.config.flashCommentYOffset[c.size][offsetKey];
    const buttonPadding = getConfig(this.config.atButtonPadding, true) * 2;
    const suffixStart = c.comboSuffix
      ? comment.content.length - c.comboSuffix.length
      : Infinity;

    // Keep the measured collision box on the animated outer element. A
    // separate layer stretches glyphs and advances exactly like Flash's
    // canvas image, without scaling the scrolling translation.
    element.replaceChildren();
    element.style.width = `calc(${c.width} * var(--dm-unit))`;
    element.style.height = `calc(${c.height} * var(--dm-unit))`;
    // Fixed-combo suffixes can trigger a new width resize while visible.
    element.style.fontSize = `calc(${c.fontSize * scale} * var(--dm-unit))`;
    element.style.lineHeight = String(c.lineHeight);
    element.style.webkitTextStroke = `calc(${getConfig(this.config.contextLineWidth, true) * scale} * var(--dm-unit)) ${getStrokeColor(c, this.config)}`;
    const layer = document.createElement("span");
    layer.dataset.dmFlash = "";
    layer.style.position = "absolute";
    layer.style.left = "0";
    layer.style.top = "0";
    layer.style.width = `${c.width / scale / c.scaleX}px`;
    layer.style.height = `${(c.height + (c.button ? buttonPadding : 0)) / scale}px`;
    layer.style.overflow = "hidden";
    layer.style.transformOrigin = "0 0";
    // Resolve the font at Flash's original size before applying its image
    // scale. WebKit rounds color-emoji advances at font resolution time;
    // resolving at the final CSS size would change measured line widths.
    layer.style.fontSize = `${c.fontSize}px`;
    layer.style.webkitTextStroke = `${getConfig(this.config.contextLineWidth, true)}px ${getStrokeColor(c, this.config)}`;
    layer.style.paintOrder =
      getConfig(this.config.contextLineWidth, true) > 0
        ? "stroke fill"
        : "normal";
    layer.style.textShadow =
      this.config.cssTextShadowBlur > 0
        ? `0 0 ${this.config.cssTextShadowBlur}px ${getStrokeColor(c, this.config)}`
        : "none";
    layer.style.transform = `scale(calc(${scale * c.scaleX} * var(--dm-display-scale)), calc(${scale} * var(--dm-display-scale)))`;
    element.appendChild(layer);

    let left = 0;
    let line = 0;
    let textOffset = 0;
    let wasButton = false;
    for (const item of c.content) {
      if (item.type === "spacer") {
        const span = document.createElement("span");
        span.dataset.dmSpacer = "";
        span.textContent = item.char.repeat(item.count);
        // Spacer advance is explicit in Flash; its glyph is never painted.
        span.style.visibility = "hidden";
        span.style.position = "absolute";
        span.style.left = `${left}px`;
        span.style.width = `${item.count * item.charWidth * c.fontSize}px`;
        layer.appendChild(span);
        left += item.count * item.charWidth * c.fontSize;
        textOffset += span.textContent.length;
        wasButton = !!item.isButton;
        continue;
      }
      for (let i = 0; i < item.slicedContent.length; i++) {
        const text = item.slicedContent[i];
        if (text === undefined) continue;
        if (c.button && !c.button.hidden && wasButton !== !!item.isButton) {
          left += buttonPadding;
        }
        if (text) {
          const span = document.createElement("span");
          this.applyFont(span, item.font ?? c.font, true);
          span.style.fontSize = "inherit";
          span.style.lineHeight = "1";
          const metrics = this.measureFontMetrics(
            span.style.fontFamily,
            span.style.fontWeight,
          );
          const baseline = (c.lineOffset + line + 1) * lineHeight + offsetY;
          span.style.position = "absolute";
          span.style.left = `${left}px`;
          span.style.top = `${baseline - metrics.baseline * c.fontSize}px`;
          const split = Math.max(0, suffixStart - textOffset);
          if (split < text.length) {
            span.appendChild(document.createTextNode(text.slice(0, split)));
            const suffix = document.createElement("span");
            suffix.textContent = text.slice(split);
            suffix.style.color = c.comboSuffixColor ?? "inherit";
            span.appendChild(suffix);
          } else {
            span.textContent = text;
          }
          layer.appendChild(span);
        }
        left += item.width[i] ?? 0;
        textOffset += text.length;
        if (i < item.slicedContent.length - 1) {
          layer.appendChild(document.createTextNode("\n"));
          left = 0;
          line++;
          textOffset++;
        }
      }
      wasButton = !!item.isButton;
    }
  }

  /**
   * fixedCombo 宿主の段階更新を DOM に反映する。
   * エンジン側(_updateFixedCombo)が comment.content / comboSuffix を更新済みなので、
   * ここでテキストを同期し、テキスト変化時に pop アニメーションを再生する。
   * 本体色は原生スタイルを維持し、xN 后缀のみ独立色を持つ。
   * 要素は固定幅の予約ボックス(中央揃え・テキスト左詰め)のため位置は動かない。
   */
  private syncFixedCombo(element: HTMLDivElement, comment: IComment): void {
    const c = comment.comment;
    if (element.textContent !== comment.content) {
      this.applyComboContent(element, comment);
      if (!comment.flash && (c.fillColor || c.wakuColor)) {
        element.style.width = `calc(${c.width} * var(--dm-unit))`;
        element.style.height = `calc(${c.height} * var(--dm-unit))`;
      }
      // 本体色不变(fixedCombo 宿主保持原生样式),同步以防外部改色
      element.style.color = c.color;
      // z 序: 計数が進む(生命周期が繋がる)たびに、最後に繋がったメンバーの
      // 层级へ引き上げ、それまでに自分の上を通過した弾幕を覆う
      element.style.zIndex = String(
        (comment.owner ? 0x40000000 : 0) +
          (comment.fixedComboZIndex ?? comment.index) +
          1,
      );
      // pop: アニメーションを再トリガー(クリア → 強制リフロー → 再設定)
      element.style.animation = "";
      void element.offsetWidth;
      element.style.animation = "dm-pop 0.25s ease-out";
    }
  }

  private getEffectiveAlpha(c: FormattedCommentWithSize): number {
    if (typeof c.opacity === "number") return c.opacity;
    return c._live ? this.config.contextFillLiveOpacity : 1;
  }

  private measureFontMetrics(fontFamily: string, fontWeight: string) {
    const cacheKey = `${fontFamily}|${fontWeight}`;
    const cached = this.fontMetricsCache.get(cacheKey);
    if (cached !== undefined) return cached;

    if (!this.measureCanvas) {
      this.measureCanvas = document.createElement("canvas");
    }
    const ctx = this.measureCanvas.getContext("2d");
    if (!ctx) {
      return { ascent: 0.9, baseline: 0.85 };
    }
    const measureFontSize = 100;
    ctx.font = `${fontWeight} ${measureFontSize}px ${fontFamily}`;
    const metrics = ctx.measureText("Ag");
    const ascent =
      (metrics as TextMetrics).fontBoundingBoxAscent ?? measureFontSize * 0.9;
    const descent = metrics.fontBoundingBoxDescent ?? measureFontSize * 0.2;
    const result = {
      ascent: ascent / measureFontSize,
      baseline: (measureFontSize + ascent - descent) / 2 / measureFontSize,
    };
    this.fontMetricsCache.set(cacheKey, result);
    return result;
  }

  private applyFont(element: HTMLElement, font: CommentFont, isFlash: boolean) {
    if (isFlash && (font === "gulim" || font === "simsun")) {
      const flashFonts = this.config.fonts.flash as Record<string, string>;
      const fontTemplate = flashFonts[font] || flashFonts.gulim;
      if (fontTemplate) {
        element.style.font = fontTemplate.replace("[size]", "100");
      }
    } else {
      const html5Fonts = this.config.fonts.html5;
      const fontConfig =
        font === "gothic" || font === "mincho" || font === "defont"
          ? html5Fonts[font]
          : html5Fonts.defont;
      if (fontConfig) {
        element.style.fontFamily = fontConfig.font;
        element.style.fontWeight = String(fontConfig.weight);
      }
    }
  }

  private getElementFromPool(): HTMLDivElement {
    while (this.pool.length > 0) {
      const element = this.pool.pop() as HTMLDivElement;
      // @keyframes 方式では animation プロパティをクリアするだけで完了
      return element;
    }
    const element = document.createElement("div");
    element.setAttribute("data-dm-comment", "");
    return element;
  }

  private recycleElement(element: HTMLDivElement) {
    // CSS @keyframes 方式: animation プロパティをクリアするだけで終了
    element.style.animation = "";
    element.remove();
    element.style.cssText = "";
    element.textContent = "";
    if (this.pool.length < POOL_MAX_SIZE) {
      this.pool.push(element);
    }
  }

  clear() {
    for (const [, element] of this.activeElements) {
      this.recycleElement(element);
    }
    this.activeElements.clear();
    this.activeSeenGeneration.clear();
    this.activeElementReverse.clear();
    this.lastUpdateVpos = -1;
  }

  getVisibleCommentIndices(): number[] {
    return Array.from(this.activeElements.keys());
  }

  destroy() {
    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.syncBounds);
    this.clear();
    this.container.remove();
    this.styleElement.remove();
    this.pool = [];
    this.measureCanvas = null;
    this.fontMetricsCache.clear();
  }
}

export { CSSRenderer };
