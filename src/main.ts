import { safeParse } from "valibot";

import type {
  Collision,
  CommentEventHandlerMap,
  FormattedComment,
  FormattedCommentInput,
  FrameActiveState,
  IComment,
  InputFormat,
  IPluginList,
  IRenderer,
  Options,
  Position,
  Timeline,
} from "@/@types/";
import { ZFormattedComment } from "@/@types/";
import { FlashComment } from "@/comments/";
import type { CommentInstanceContext } from "@/contexts/";
import { createNicoScripts, ImageCacheContext } from "@/contexts/";
import { defaultConfig, defaultOptions } from "@/definition/config";
import { initConfig } from "@/definition/initConfig";
import { InvalidOptionError } from "@/errors/";
import { EventHandler } from "@/eventHandler";
import convert2formattedComment from "@/inputParser";
import { createRenderer } from "@/renderer";
import { clampCanvasSize } from "@/renderer/canvas";
import { CSSRenderer } from "@/renderer/css";
import typeGuard from "@/typeGuard";
import {
  applyNakaDedupe,
  arrayEqual,
  buildAtButtonComment,
  buildFixedComboChains,
  changeCALayer,
  fixedComboCountAt,
  getConfig,
  hex2rgb,
  isBanActive,
  isFlashComment,
  isReverseActive,
  parseFont,
  processFixedComment,
  processMovableComment,
} from "@/utils";
import {
  extendMovableCommentTimeline,
  getLazyCommentLookahead,
} from "@/utils/comment";
import type { FixedComboChain } from "@/utils/fixedCombo";
import { createCommentInstance } from "@/utils/plugins";
import { RangeCacheContext } from "@/utils/rangeCache";

import * as internal from "./internal";

const EMPTY_TIMELINE = Object.freeze([]) as readonly IComment[];
const BAN_FRAME_POSITION_RESOLUTION_BUDGET = 256;
const TIMELINE_COMMENT_SORT = (a: IComment, b: IComment) =>
  Number(a.owner) - Number(b.owner) ||
  (a.fixedComboZIndex ?? a.index) - (b.fixedComboZIndex ?? b.index);
const isFiniteVpos = (vpos: number) => Number.isFinite(vpos);
const isFinitePosition = (pos: Position) =>
  Number.isFinite(pos.x) && Number.isFinite(pos.y);
const rejectInvalidCommentPosition = (comment: IComment) => {
  comment.comment.invisible = true;
  try {
    comment.invisible = true;
  } catch (_e) {
    // Built-in comments expose invisible as a getter over comment.invisible.
  }
  comment.posY = 0;
};

const toIntegerOrInfinity = (value: number) => {
  if (Number.isNaN(value) || value === 0) return 0;
  if (!Number.isFinite(value)) return value;
  return Math.trunc(value);
};

const getSliceBounds = (length: number, start: number, end?: number) => {
  let startIndex = toIntegerOrInfinity(start);
  let endIndex = end === undefined ? length : toIntegerOrInfinity(end);

  if (startIndex === -Infinity) {
    startIndex = 0;
  } else if (startIndex < 0) {
    startIndex = Math.max(length + startIndex, 0);
  } else {
    startIndex = Math.min(startIndex, length);
  }

  if (endIndex === -Infinity) {
    endIndex = 0;
  } else if (endIndex < 0) {
    endIndex = Math.max(length + endIndex, 0);
  } else {
    endIndex = Math.min(endIndex, length);
  }

  if (endIndex < startIndex) {
    endIndex = startIndex;
  }

  return { startIndex, endIndex };
};

const hasNakaComment = (items: readonly IComment[]) => {
  let hasNaka = false;
  for (const item of items) {
    if (item.loc === "naka") {
      hasNaka = true;
      break;
    }
  }
  return hasNaka;
};

const areCommentsSortedByVpos = (
  items: readonly IComment[],
  previous?: IComment,
) => {
  let previousComment = previous;
  for (const item of items) {
    if (!item) continue;
    if (previousComment && previousComment.vpos > item.vpos) {
      return false;
    }
    previousComment = item;
  }
  return true;
};

const rendererHasVideoSurface = (renderer: IRenderer) =>
  "video" in renderer &&
  (renderer as IRenderer & { readonly video?: unknown }).video != null;

const getRendererClear = (renderer: IRenderer): (() => void) | undefined => {
  const clear = (renderer as IRenderer & { clear?: unknown }).clear;
  return typeof clear === "function" ? (clear as () => void) : undefined;
};

const removeUndefinedConfigValues = (
  config: NonNullable<Options["config"]>,
): NonNullable<Options["config"]> =>
  Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined),
  ) as NonNullable<Options["config"]>;

type DrawCanvasProfile = {
  triggerHandler: number;
  drawVideo: number;
  drawPlugins: number;
  drawCollision: number;
  drawComments: number;
  drawFPS: number;
  drawCommentCount: number;
  flush: number;
  total: number;
};

class NiconiComments {
  public enableLegacyPiP: boolean;
  public showCollision: boolean;
  public showFPS: boolean;
  public showCommentCount: boolean;
  private lastVpos: number;
  private lastEventVpos: number;
  private lastCursor?: Position;
  private lastFrameBanActive: boolean;
  private frameDirty: boolean;
  private pendingMotionLayout = false;
  private lastRendererWidth: number;
  private lastRendererHeight: number;
  private rendererScale: number;
  private timelineExpansion: number;
  private get lastVposInt() {
    return Math.floor(this.lastVpos);
  }
  private _cachedSplit: {
    vpos: number;
    hasNaka: boolean;
  } | null = null;
  private lazyCommentOrderSortedByVpos: boolean;
  private nextUnprocessedCommentIndex: number;
  private commentArrayIndexMap: WeakMap<IComment, number>;
  private processedCommentIndex: number;
  private comments: IComment[];
  private fixedComboChains: FixedComboChain[] = [];
  private destroyed = false;
  private readonly renderer: IRenderer;
  private cssRenderer: CSSRenderer | null = null;
  private collision: Collision;
  private timeline: Timeline;
  private readonly ctx: CommentInstanceContext;
  private readonly eventHandler: EventHandler;
  private plugins: IPluginList = [];
  static typeGuard = typeGuard;
  static default = NiconiComments;
  static readonly BAN_FRAME_POSITION_RESOLUTION_BUDGET =
    BAN_FRAME_POSITION_RESOLUTION_BUDGET;
  static FlashComment = {
    condition: isFlashComment,
    class: FlashComment,
  };
  static internal = internal;

  /**
   * NiconiComments Constructor
   * @param renderer 描画対象のキャンバス
   * @param data 描画用のコメント
   * @param initOptions 初期化オプション
   */
  constructor(
    _renderer: IRenderer | HTMLCanvasElement,
    data: InputFormat,
    initOptions: Options = {},
  ) {
    const constructorStart = performance.now();
    initConfig();
    if (!typeGuard.config.initOptions(initOptions))
      throw new InvalidOptionError();

    const options = Object.assign({}, defaultOptions, initOptions);
    const config = Object.assign(
      {},
      defaultConfig,
      removeUndefinedConfigValues(options.config ?? {}),
    );

    const nicoScripts = createNicoScripts();
    const imageCache = new ImageCacheContext();
    const rangeCache = new RangeCacheContext();

    this.ctx = {
      config,
      options,
      nicoScripts,
      imageCache,
      rangeCache,
      viewport: { width: config.canvasWidth, offsetX: 0 },
    };
    this.eventHandler = new EventHandler();

    let renderer = _renderer;
    if (renderer instanceof HTMLCanvasElement) {
      renderer = createRenderer(renderer, options.video);
    } else if (options.video) {
      console.warn(
        "options.video is ignored because renderer is not HTMLCanvasElement",
      );
    }

    this.renderer = renderer;
    this._log(`renderer: ${renderer.rendererName}`);
    this.renderer.setLineWidth(getConfig(config.contextLineWidth, false));
    const rendererSize = this.renderer.getSize();
    this.lastRendererWidth = rendererSize.width;
    this.lastRendererHeight = rendererSize.height;
    this.rendererScale = this.isValidSurface(rendererSize)
      ? rendererSize.height / config.canvasHeight
      : 1;
    if (this.isValidSurface(rendererSize))
      this.renderer.setScale(this.rendererScale);
    this.updateViewport(rendererSize);
    this.timelineExpansion = Math.max(0, this.ctx.viewport?.offsetX ?? 0);

    if (options.mode === "css" && _renderer instanceof HTMLCanvasElement) {
      this.cssRenderer = new CSSRenderer(this.renderer.canvas, config, options);
      this.cssRenderer.setViewport(
        this.ctx.viewport?.width ?? config.canvasWidth,
        this.ctx.viewport?.offsetX ?? 0,
      );
    }

    let formatType = options.format;

    //Deprecated Warning
    if (options.formatted) {
      console.warn(
        "Deprecated: options.formatted is no longer recommended. Please use options.format. https://xpadev-net.github.io/niconicomments/#p_format",
      );
    }
    if (formatType === "default") {
      formatType = options.formatted ? "formatted" : "legacy";
    }

    if (options.useLegacy) {
      console.warn(
        "Deprecated: options.useLegacy is no longer recommended. Please use options.mode. https://xpadev-net.github.io/niconicomments/#p_mode",
      );
    }
    if (options.mode === "default" && options.useLegacy) {
      options.mode = "html5";
    }

    const parsedData = convert2formattedComment(data, formatType);
    this.showCollision = options.showCollision;
    this.showFPS = options.showFPS;
    this.showCommentCount = options.showCommentCount;
    this.enableLegacyPiP = options.enableLegacyPiP;

    this.timeline = {};
    this.collision = {
      ue: {},
      shita: {},
      left: {},
      right: {},
    };
    this.lastVpos = -1;
    this.lastEventVpos = -1;
    this.lastFrameBanActive = false;
    this.frameDirty = true;
    this.lazyCommentOrderSortedByVpos = true;
    this.nextUnprocessedCommentIndex = 0;
    this.commentArrayIndexMap = new WeakMap();
    this.processedCommentIndex = -1;

    this.comments = this.preRendering(parsedData);
    this._rebuildCommentArrayIndex(this.comments);
    if (!this.ctx.options.lazy || !this.lazyCommentOrderSortedByVpos) {
      this._advanceNextUnprocessedCommentIndex();
    }

    this._log(
      `constructor complete: ${performance.now() - constructorStart}ms`,
    );
  }

  public destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.cssRenderer) {
      this.cssRenderer.destroy();
      this.cssRenderer = null;
    }
    for (const comment of this.comments) {
      try {
        comment.destroy?.();
      } catch (e) {
        console.error("Failed to destroy comment", e);
      }
    }
    this.comments = [];
    this.fixedComboChains = [];
    this.commentArrayIndexMap = new WeakMap();
    this._clearTimeline();
    this._clearCollision();
    this.ctx.rangeCache.reset();
    for (const plugin of this.plugins) {
      try {
        plugin.instance.destroy?.();
      } catch (e) {
        console.error("Failed to destroy plugin", e);
      }
      try {
        plugin.canvas.destroy?.();
      } catch (e) {
        console.error("Failed to destroy plugin canvas", e);
      }
    }
    this.plugins = [];
    this.ctx.imageCache.reset();
    this.renderer.destroy?.();
  }

  private _clearTimeline() {
    for (const key of Object.keys(this.timeline)) {
      delete this.timeline[Number(key)];
    }
  }

  private _clearCollision() {
    for (const collision of [
      this.collision.ue,
      this.collision.shita,
      this.collision.left,
      this.collision.right,
    ]) {
      for (const key of Object.keys(collision)) {
        delete collision[Number(key)];
      }
    }
  }

  private _rebuildCommentArrayIndex(comments: IComment[]) {
    this.commentArrayIndexMap = new WeakMap();
    for (let i = 0, n = comments.length; i < n; i++) {
      const comment = comments[i];
      if (!comment) continue;
      this.commentArrayIndexMap.set(comment, i);
    }
  }

  private _advanceNextUnprocessedCommentIndex(
    comments = this.comments,
    scanBudget?: number,
  ) {
    const scanEndIndex =
      scanBudget === undefined
        ? comments.length
        : Math.min(
            comments.length,
            this.nextUnprocessedCommentIndex + scanBudget,
          );
    while (this.nextUnprocessedCommentIndex < scanEndIndex) {
      const comment = comments[this.nextUnprocessedCommentIndex];
      if (comment && !isFiniteVpos(comment.vpos)) {
        rejectInvalidCommentPosition(comment);
        this.nextUnprocessedCommentIndex++;
        continue;
      }
      if (comment && !comment.invisible && comment.posY < 0) {
        break;
      }
      this.nextUnprocessedCommentIndex++;
    }
    return this.nextUnprocessedCommentIndex;
  }

  /**
   * 事前に当たり判定を考慮してコメントの描画場所を決定する
   * @param _rawData コメントデータ
   * @returns コメントのインスタンス配列
   */
  private preRendering(_rawData: FormattedComment[]) {
    let rawData = _rawData;
    const preRenderingStart = performance.now();
    if (this.ctx.options.keepCA) {
      rawData = changeCALayer(rawData, this.ctx.config);
    }
    let instances = rawData.reduce<IComment[]>((pv, val, index) => {
      pv.push(createCommentInstance(val, this.renderer, index, this.ctx));
      return pv;
    }, []);

    const plugins: IPluginList = [];
    for (const plugin of this.ctx.config.plugins) {
      try {
        const canvas = this.renderer.getCanvas();
        const pluginInstance = new plugin(canvas, instances);
        plugins.push({
          canvas,
          instance: pluginInstance,
        });
        if (pluginInstance.transformComments) {
          instances = pluginInstance.transformComments(instances);
        }
      } catch (_e) {
        console.error("Failed to init plugin");
      }
    }

    this.plugins = plugins;
    this.lazyCommentOrderSortedByVpos = areCommentsSortedByVpos(instances);
    if (this.ctx.config.fixedCombo) {
      // 位置解析の前にチェーンを確定する: ホストの long 延長・幅予約が
      // そのまま timeline 登録・当たり判定に反映される。
      this.fixedComboChains = buildFixedComboChains(instances);
    }
    // 滚动弹幕窗口去重: 同样在位置解析前静态合并(宿主宽度以 xN 后缀后的
    // 文本测量,参与排道)。窗口分组静态,无需逐帧更新。
    if (this.ctx.config.nakaDedupeWindow > 0) {
      applyNakaDedupe(instances, this.ctx.config.nakaDedupeWindow);
    }
    if (!this.ctx.options.lazy || !this.lazyCommentOrderSortedByVpos) {
      // Non-lazy rendering and lazy fallback both need final plugin output.
      this.getCommentPos(instances, instances.length);
      this.sortTimelineComment();
    }
    this._log(
      `preRendering complete: ${performance.now() - preRenderingStart}ms`,
    );
    return instances;
  }

  /**
   * 計算された描画サイズをもとに各コメントの配置位置を決定する
   * @param data コメントデータ
   * @param end 終了インデックス
   */
  private getCommentPos(
    data: IComment[],
    end: number,
    touchedTimeline?: Set<number>,
    advanceBudget?: number,
  ) {
    const getCommentPosStart = performance.now();
    const startIndex = this.processedCommentIndex + 1;
    if (startIndex >= end) return;
    for (let i = startIndex; i < end; i++) {
      const comment = data[i];
      if (!comment) continue;
      this.processedCommentIndex = i;
      if (comment.invisible || comment.posY > -1) continue;
      if (comment.loc === "naka") {
        processMovableComment(
          comment,
          this.collision,
          this.timeline,
          false,
          this.ctx.config,
          touchedTimeline,
          this.timelineExpansion,
        );
      } else {
        processFixedComment(
          comment,
          this.collision[comment.loc],
          this.timeline,
          false,
          this.ctx.config,
          touchedTimeline,
        );
      }
    }
    this.nextUnprocessedCommentIndex = Math.max(
      this.nextUnprocessedCommentIndex,
      this.processedCommentIndex + 1,
    );
    this._advanceNextUnprocessedCommentIndex(data, advanceBudget);
    this._log(
      `getCommentPos complete: ${performance.now() - getCommentPosStart}ms`,
    );
  }

  private isValidSurface(size: { width: number; height: number }) {
    return (
      Number.isFinite(size.width) &&
      Number.isFinite(size.height) &&
      size.width > 0 &&
      size.height > 0
    );
  }

  private updateViewport(size: { width: number; height: number }) {
    if (!this.isValidSurface(size) || !this.ctx.viewport) return;
    const width = size.width / (size.height / this.ctx.config.canvasHeight);
    this.ctx.viewport.width = width;
    this.ctx.viewport.offsetX = (width - this.ctx.config.canvasWidth) / 2;
  }

  /** Resize the output surface without re-parsing comments or changing CA scale. */
  public resize(width: number, height: number): boolean {
    if (this.destroyed || !this.isValidSurface({ width, height })) return false;
    const size = clampCanvasSize(width, height);
    if (!this.isValidSurface(size)) return false;
    if (
      size.width === this.lastRendererWidth &&
      size.height === this.lastRendererHeight
    ) {
      return false;
    }
    const previousScale = this.rendererScale;
    this.renderer.setSize(size.width, size.height);
    const actual = this.renderer.getSize();
    this.rendererScale = actual.height / this.ctx.config.canvasHeight;
    // HTML5CSSRenderer retains its scale through setSize; Canvas/WebGL reset it.
    this.renderer.setScale(
      this.renderer.rendererName === "HTML5CSSRenderer"
        ? this.rendererScale / previousScale
        : this.rendererScale,
    );
    this.renderer.setLineWidth(
      getConfig(this.ctx.config.contextLineWidth, false),
    );
    this.lastRendererWidth = actual.width;
    this.lastRendererHeight = actual.height;
    this.updateViewport(actual);
    const expansion = Math.max(0, this.ctx.viewport?.offsetX ?? 0);
    if (expansion > this.timelineExpansion) {
      const touched = new Set<number>();
      for (const comment of this.comments) {
        // Includes dynamically added comments; excludes unresolved lazy comments.
        if (
          comment.invisible ||
          !this.timeline[comment.vpos]?.includes(comment)
        )
          continue;
        extendMovableCommentTimeline(
          comment,
          this.timeline,
          this.ctx.config,
          this.timelineExpansion,
          expansion,
          touched,
        );
      }
      this.sortTimelineComment(touched);
      this.timelineExpansion = expansion;
    }
    this.cssRenderer?.setViewport(
      this.ctx.viewport?.width ?? this.ctx.config.canvasWidth,
      this.ctx.viewport?.offsetX ?? 0,
    );
    this.frameDirty = true;
    return true;
  }

  private resolveLazyCommentWindow(vpos: number, resolutionBudget?: number) {
    if (!this.ctx.options.lazy) return false;
    const scanStartIndex = this.nextUnprocessedCommentIndex;
    const scanEndIndex =
      resolutionBudget === undefined
        ? this.comments.length
        : Math.min(this.comments.length, scanStartIndex + resolutionBudget);
    const startIndex = this._advanceNextUnprocessedCommentIndex(
      this.comments,
      resolutionBudget,
    );
    if (startIndex >= scanEndIndex) return false;
    const resolveUntil =
      vpos +
      getLazyCommentLookahead(
        this.ctx.config.canvasWidth,
        Math.max(0, this.ctx.viewport?.offsetX ?? 0),
        this.ctx.config.commentDrawRange,
        this.ctx.config.scrollSpeed,
      );
    let endIndex = startIndex - 1;
    for (let i = startIndex; i < scanEndIndex; i++) {
      const comment = this.comments[i];
      if (comment && !isFiniteVpos(comment.vpos)) {
        rejectInvalidCommentPosition(comment);
        continue;
      }
      if (!comment || comment.invisible || comment.posY > -1) {
        continue;
      }
      if (comment.vpos <= resolveUntil) {
        endIndex = i;
      } else if (this.lazyCommentOrderSortedByVpos) {
        break;
      }
    }
    if (endIndex < startIndex) {
      return false;
    }
    const touchedTimeline = new Set<number>();
    this.getCommentPos(
      this.comments,
      Math.min(endIndex + 1, scanEndIndex),
      touchedTimeline,
      resolutionBudget === undefined ? undefined : 0,
    );
    this.sortTimelineComment(touchedTimeline);
    return true;
  }

  /**
   * 投稿者コメントを前に移動
   */
  private sortTimelineComment(vposes?: Iterable<number | string>) {
    const sortCommentStart = performance.now();
    const targetVposes = vposes ?? Object.keys(this.timeline);
    for (const vpos of targetVposes) {
      const item = this.timeline[Number(vpos)];
      if (!item) continue;
      item.sort(TIMELINE_COMMENT_SORT);
    }
    this._log(`parseData complete: ${performance.now() - sortCommentStart}ms`);
  }

  /**
   * 動的にコメント追加する
   * ※すでに存在するコメントの位置はvposに関係なく更新されません
   * @param rawComments コメントデータ
   */
  public addComments(...rawComments: FormattedCommentInput[]) {
    const validComments = rawComments.reduce<FormattedComment[]>((pv, val) => {
      const parsedComment = safeParse(ZFormattedComment, val);
      if (parsedComment.success) pv.push(parsedComment.output);
      return pv;
    }, []);
    if (validComments.length === 0) return;
    this.ctx.rangeCache.reset();
    const touchedTimeline = new Set<number>();
    const comments = validComments.reduce<IComment[]>((pv, val, index) => {
      pv.push(
        createCommentInstance(
          val,
          this.renderer,
          this.comments.length + index,
          this.ctx,
        ),
      );
      return pv;
    }, []);
    for (const plugin of this.plugins) {
      try {
        plugin.instance.addComments?.(comments);
      } catch (e) {
        console.error("Failed to add comments", e);
      }
    }
    for (const comment of comments) {
      if (comment.invisible) continue;
      if (comment.loc === "naka") {
        processMovableComment(
          comment,
          this.collision,
          this.timeline,
          false,
          this.ctx.config,
          touchedTimeline,
          this.timelineExpansion,
        );
      } else {
        processFixedComment(
          comment,
          this.collision[comment.loc],
          this.timeline,
          false,
          this.ctx.config,
          touchedTimeline,
        );
      }
    }
    this.comments.push(...comments);
    this.nextUnprocessedCommentIndex = Math.min(
      this.nextUnprocessedCommentIndex,
      this.comments.length - comments.length,
    );
    const baseOffset = this.comments.length - comments.length;
    for (let i = 0, n = comments.length; i < n; i++) {
      const comment = comments[i];
      if (!comment) continue;
      this.commentArrayIndexMap.set(comment, baseOffset + i);
    }
    if (!this.ctx.options.lazy) {
      const prePushTail = baseOffset - 1;
      if (this.processedCommentIndex < prePushTail) {
        this.getCommentPos(this.comments, prePushTail + 1, touchedTimeline);
      }
      this.processedCommentIndex = Math.max(
        this.processedCommentIndex,
        this.comments.length - 1,
      );
    }
    this._advanceNextUnprocessedCommentIndex();
    this.sortTimelineComment(touchedTimeline);
    this._cachedSplit = null;
  }

  /**
   * 固定弹幕 combo 渐进更新:按 vpos 重算各链计数,计数变化时更新宿主文本/颜色。
   * 纯函数式(从静态的链定义重算),seek 后自动正确。
   * @param vpos 当前 vpos
   * @returns 是否有链计数变化(需要重绘)
   */
  private _updateFixedCombo(vpos: number): boolean {
    if (this.fixedComboChains.length === 0) return false;
    let changed = false;
    for (const chain of this.fixedComboChains) {
      const count = fixedComboCountAt(chain, vpos);
      if (count === chain.currentCount) continue;
      chain.currentCount = count;
      changed = true;
      const host = chain.host;
      // 还原原始字号数据后写入新文本(content setter 会重新测量);
      // 高度保持原值防止 shita 弹幕垂直抖动,宽度随文本自然重新居中
      try {
        host.comment.charSize = chain.charSize;
        host.comment.lineHeight = chain.lineHeight;
        host.comment.fontSize = chain.fontSize;
        host.content = count > 1 ? `${chain.base}x${count}` : chain.base;
        host.comment.height = chain.height;
        // 弹幕本体保持原生样式(不随合并改色),仅 xN 后缀使用逐级随机色。
        // 后缀文本与颜色均由引擎显式写入,渲染器无需自行解析拼接串。
        host.comment.comboSuffix = count > 1 ? `x${count}` : undefined;
        host.comment.comboSuffixColor =
          count > 1 ? chain.suffixColor : undefined;
        // z 序提升到已接续的最后一条成员的层级:生命周期被续上时,
        // 宿主覆盖此前飘过它上面的弹幕(后到的弹幕 index 更大,仍在其上)
        host.fixedComboZIndex = chain.memberIndices[count - 1] ?? host.index;
      } catch (e) {
        this._log(
          `_updateFixedCombo: failed to update host index=${host.index}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
      // z 序变化后重排宿主所在链的 timeline 槽位(canvas 绘制顺序 = 数组顺序)
      this._resortFixedComboChainTimeline(chain);
    }
    return changed;
  }

  /**
   * combo 计数变化后重排链覆盖的 timeline 槽位。
   * 排序比较器使用 fixedComboZIndex,宿主的新 z 序由此生效。
   * @param chain 合并链
   */
  private _resortFixedComboChainTimeline(chain: FixedComboChain): void {
    for (let v = chain.host.vpos; v < chain.end; v++) {
      const item = this.timeline[v];
      if (item) item.sort(TIMELINE_COMMENT_SORT);
    }
  }

  /**
   * キャンバスを描画する
   * @param vpos 動画の現在位置の100倍 ニコニコから吐き出されるコメントの位置情報は主にこれ
   * @param forceRendering キャッシュを使用せずに再描画を強制するか
   * @param cursor カーソルの位置
   * @returns 再描画されたか
   */
  public drawCanvas(
    vpos: number,
    forceRendering = false,
    cursor?: Position,
  ): boolean {
    if (this.destroyed || !isFiniteVpos(vpos)) return false;
    const size = this.renderer.getSize();
    const hasValidSurface = this.isValidSurface(size);
    if (
      hasValidSurface &&
      (size.width !== this.lastRendererWidth ||
        size.height !== this.lastRendererHeight)
    ) {
      this.resize(size.width, size.height);
    }
    const profile: DrawCanvasProfile | undefined = this.ctx.options.debug
      ? {
          triggerHandler: 0,
          drawVideo: 0,
          drawPlugins: 0,
          drawCollision: 0,
          drawComments: 0,
          drawFPS: 0,
          drawCommentCount: 0,
          flush: 0,
          total: 0,
        }
      : undefined;
    const setProfile = <K extends keyof DrawCanvasProfile>(
      key: K,
      start: number,
    ) => {
      if (profile) {
        profile[key] = performance.now() - start;
      }
    };

    const vposInt = Math.floor(vpos);
    if (this.pendingMotionLayout) this.reflowMotion(vposInt);
    const drawCanvasStart = performance.now();
    const requiresVideoRedraw = rendererHasVideoSurface(this.renderer);
    const rendererNeedsRedraw = this.renderer.needsRedraw?.() ?? false;
    const cursorChanged =
      (cursor === undefined) !== (this.lastCursor === undefined) ||
      (cursor !== undefined &&
        this.lastCursor !== undefined &&
        (cursor.x !== this.lastCursor.x || cursor.y !== this.lastCursor.y));
    this.lastCursor =
      cursor === undefined ? undefined : { x: cursor.x, y: cursor.y };
    const requiresDynamicFrameRedraw =
      requiresVideoRedraw ||
      rendererNeedsRedraw ||
      this.frameDirty ||
      this.plugins.length > 0 ||
      this.showCollision ||
      this.showFPS ||
      this.showCommentCount ||
      cursorChanged;
    if (
      this.lastVpos === vpos &&
      !forceRendering &&
      !requiresDynamicFrameRedraw
    ) {
      return false;
    }
    const triggerHandlerStart = profile ? performance.now() : 0;
    this.eventHandler.trigger(
      vposInt,
      this.lastEventVpos,
      this.ctx.nicoScripts,
    );
    this.lastEventVpos = vposInt;
    setProfile("triggerHandler", triggerHandlerStart);
    const frameBanActive = isBanActive(
      vpos,
      this.ctx.nicoScripts,
      this.ctx.rangeCache,
    );
    this.resolveLazyCommentWindow(
      vposInt,
      frameBanActive ? BAN_FRAME_POSITION_RESOLUTION_BUDGET : undefined,
    );
    const timelineRange = this.timeline[vposInt] ?? EMPTY_TIMELINE;
    const lastTimelineRange = this.timeline[this.lastVposInt] ?? EMPTY_TIMELINE;
    // combo 更新必须在下方早退检查之前: 计数变化时 timelineRange 成员集合不变
    // (宿主同一条),arrayEqual 会通过,不在此处标记就会被早退吞掉
    const fixedComboChanged = this._updateFixedCombo(vpos);
    const currentHasNaka = hasNakaComment(timelineRange);
    const lastHasNaka =
      this._cachedSplit?.vpos === this.lastVposInt
        ? this._cachedSplit.hasNaka
        : hasNakaComment(lastTimelineRange);
    this._cachedSplit = { vpos: vposInt, hasNaka: currentHasNaka };
    if (
      !forceRendering &&
      !requiresDynamicFrameRedraw &&
      !fixedComboChanged &&
      !currentHasNaka &&
      !lastHasNaka &&
      frameBanActive === this.lastFrameBanActive
    ) {
      if (arrayEqual(timelineRange, lastTimelineRange)) return false;
    }
    this.frameDirty = true;

    if (!hasValidSurface) {
      this.lastRendererWidth = size.width;
      this.lastRendererHeight = size.height;
      this.lastVpos = vpos;
      this.lastFrameBanActive = frameBanActive;
      this.cssRenderer?.clear();
      return false;
    }

    if (this.cssRenderer) {
      this.lastVpos = vpos;
      this._resolveCommentPositions(timelineRange, frameBanActive);
      const frameActiveState: FrameActiveState = {
        banActive: frameBanActive,
        reverseActiveOwner: isReverseActive(
          vpos,
          true,
          this.ctx.nicoScripts,
          this.ctx.rangeCache,
        ),
        reverseActiveViewer: isReverseActive(
          vpos,
          false,
          this.ctx.nicoScripts,
          this.ctx.rangeCache,
        ),
      };
      this.cssRenderer.updateComments(timelineRange, vpos, frameActiveState);
      this.lastFrameBanActive = frameBanActive;
      this.frameDirty = false;
      return true;
    }

    this.renderer.clearRect(
      0,
      0,
      this.ctx.viewport?.width ?? this.ctx.config.canvasWidth,
      this.ctx.config.canvasHeight,
    );

    const drawVideoStart = profile ? performance.now() : 0;
    this._drawVideo();
    setProfile("drawVideo", drawVideoStart);

    const drawPluginsStart = profile ? performance.now() : 0;
    for (const plugin of this.plugins) {
      try {
        const isUpdated = plugin.instance.draw?.(vpos);
        if (isUpdated !== false) {
          this.renderer.invalidateImage(plugin.canvas);
        }
        const pluginSize = plugin.canvas.getSize();
        const offsetX =
          pluginSize.width === this.ctx.config.canvasWidth &&
          pluginSize.height === this.ctx.config.canvasHeight
            ? (this.ctx.viewport?.offsetX ?? 0)
            : 0;
        this.renderer.drawImage(plugin.canvas, offsetX, 0);
      } catch (e) {
        console.error("Failed to draw comments", e);
      }
    }
    setProfile("drawPlugins", drawPluginsStart);

    const drawCollisionStart = profile ? performance.now() : 0;
    this._drawCollision(vposInt);
    setProfile("drawCollision", drawCollisionStart);

    const drawCommentsStart = profile ? performance.now() : 0;
    const drawnCount = this._drawComments(
      timelineRange,
      vpos,
      cursor,
      frameBanActive,
    );
    setProfile("drawComments", drawCommentsStart);

    const drawFPSStart = profile ? performance.now() : 0;
    this._drawFPS(drawCanvasStart);
    setProfile("drawFPS", drawFPSStart);

    const drawCommentCountStart = profile ? performance.now() : 0;
    this._drawCommentCount(drawnCount);
    setProfile("drawCommentCount", drawCommentCountStart);

    const flushStart = profile ? performance.now() : 0;
    this.renderer.flush();
    setProfile("flush", flushStart);
    this.lastVpos = vpos;
    this.lastFrameBanActive = frameBanActive;
    this.frameDirty = false;

    if (profile) {
      profile.total = performance.now() - drawCanvasStart;
      this._log(
        `drawCanvas profile: trigger=${profile.triggerHandler.toFixed(2)}ms, video=${profile.drawVideo.toFixed(2)}ms, plugins=${profile.drawPlugins.toFixed(2)}ms, collision=${profile.drawCollision.toFixed(2)}ms, comments=${profile.drawComments.toFixed(2)}ms, fps=${profile.drawFPS.toFixed(2)}ms, count=${profile.drawCommentCount.toFixed(2)}ms, flush=${profile.flush.toFixed(2)}ms, total=${profile.total.toFixed(2)}ms`,
      );
    } else {
      this._log(
        `drawCanvas complete: ${performance.now() - drawCanvasStart}ms`,
      );
    }
    return true;
  }

  /**
   * 背景動画が設定されている場合に描画する
   */
  private _drawVideo() {
    this.renderer.drawVideo(this.enableLegacyPiP);
  }

  /**
   * CSS レンダラー用にコメント位置を解決する
   * _drawComments の位置解決ロジックを抽出したもの
   */
  private _resolveCommentPositions(
    timelineRange: readonly IComment[],
    banActive: boolean,
  ) {
    const { config } = this.ctx;
    let startIndex = 0;
    let endIndex = timelineRange.length;
    if (config.commentLimit !== undefined) {
      if (config.commentLimit === 0) {
        return;
      } else if (config.hideCommentOrder === "asc") {
        ({ startIndex, endIndex } = getSliceBounds(
          timelineRange.length,
          -config.commentLimit,
        ));
      } else {
        ({ startIndex, endIndex } = getSliceBounds(
          timelineRange.length,
          0,
          config.commentLimit,
        ));
      }
    }
    if (banActive && !this.ctx.options.lazy) return;
    let maxCommentOffset = -1;
    let requiresFullScan = false;
    for (let i = startIndex; i < endIndex; i++) {
      const comment = timelineRange[i];
      if (!comment || comment.invisible) continue;
      const commentOffset = this.commentArrayIndexMap.get(comment);
      if (commentOffset === undefined) {
        requiresFullScan = true;
        break;
      }
      if (maxCommentOffset < commentOffset) {
        maxCommentOffset = commentOffset;
      }
    }
    if (banActive) {
      const resolutionEnd =
        this.processedCommentIndex + 1 + BAN_FRAME_POSITION_RESOLUTION_BUDGET;
      if (
        requiresFullScan &&
        this.processedCommentIndex < this.comments.length - 1
      ) {
        this.getCommentPos(
          this.comments,
          Math.min(this.comments.length, resolutionEnd),
        );
      } else if (
        maxCommentOffset >= 0 &&
        this.processedCommentIndex < maxCommentOffset
      ) {
        this.getCommentPos(
          this.comments,
          Math.min(maxCommentOffset + 1, resolutionEnd),
        );
      }
      return;
    }
    if (
      requiresFullScan &&
      this.processedCommentIndex < this.comments.length - 1
    ) {
      this.getCommentPos(this.comments, this.comments.length);
    } else if (
      maxCommentOffset >= 0 &&
      this.processedCommentIndex < maxCommentOffset
    ) {
      this.getCommentPos(this.comments, maxCommentOffset + 1);
    }
  }

  /**
   * コメントを描画する
   * @param timelineRange 指定されたvposに存在するコメント
   * @param vpos vpos
   * @param cursor カーソルの位置
   * @returns 描画したコメント数
   */
  private _drawComments(
    timelineRange: readonly IComment[],
    vpos: number,
    cursor?: Position,
    frameBanActive?: boolean,
  ): number {
    const { config, nicoScripts, rangeCache } = this.ctx;
    const banActive =
      frameBanActive ?? isBanActive(vpos, nicoScripts, rangeCache);
    if (banActive) return 0;

    let startIndex = 0;
    let endIndex = timelineRange.length;
    if (config.commentLimit !== undefined) {
      if (config.commentLimit === 0) {
        endIndex = 0;
      } else if (config.hideCommentOrder === "asc") {
        ({ startIndex, endIndex } = getSliceBounds(
          timelineRange.length,
          -config.commentLimit,
        ));
      } else {
        ({ startIndex, endIndex } = getSliceBounds(
          timelineRange.length,
          0,
          config.commentLimit,
        ));
      }
    }
    const frameActiveState: FrameActiveState = {
      banActive,
      reverseActiveOwner: isReverseActive(vpos, true, nicoScripts, rangeCache),
      reverseActiveViewer: isReverseActive(
        vpos,
        false,
        nicoScripts,
        rangeCache,
      ),
    };
    let maxCommentOffset = -1;
    let requiresFullScan = false;
    for (let i = startIndex; i < endIndex; i++) {
      const comment = timelineRange[i];
      if (!comment || comment.invisible) continue;
      const commentOffset = this.commentArrayIndexMap.get(comment);
      if (commentOffset === undefined) {
        requiresFullScan = true;
        break;
      }
      if (maxCommentOffset < commentOffset) {
        maxCommentOffset = commentOffset;
      }
    }
    if (
      requiresFullScan &&
      this.processedCommentIndex < this.comments.length - 1
    ) {
      this.getCommentPos(this.comments, this.comments.length);
    } else if (requiresFullScan) {
      this._log(
        "_drawComments: requiresFullScan with no unprocessed comments — possible plugin side-effect",
      );
    } else if (
      maxCommentOffset >= 0 &&
      this.processedCommentIndex < maxCommentOffset
    ) {
      this.getCommentPos(this.comments, maxCommentOffset + 1);
    }
    const guardUnregisteredUnresolved = requiresFullScan;
    let drawnCount = 0;
    for (let i = startIndex; i < endIndex; i++) {
      const comment = timelineRange[i];
      if (!comment || comment.invisible) {
        continue;
      }
      if (guardUnregisteredUnresolved) {
        const commentOffset = this.commentArrayIndexMap.get(comment);
        if (commentOffset === undefined && comment.posY < 0) {
          this._log(
            "_drawComments: skip unresolved unregistered comment (possible plugin-injected entry)",
          );
          continue;
        }
      }
      try {
        comment.draw(vpos, this.showCollision, cursor, frameActiveState);
        drawnCount += 1;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this._log(
          `_drawComments: failed to draw comment index=${comment.index}: ${message}`,
        );
      }
    }
    return drawnCount;
  }

  /**
   * 当たり判定を描画する
   * @param vpos vpos
   */
  private _drawCollision(vpos: number) {
    const { config } = this.ctx;
    if (this.showCollision) {
      this.renderer.save();
      const leftCollision = this.collision.left[vpos];
      const rightCollision = this.collision.right[vpos];
      this.renderer.setFillStyle("red");
      if (leftCollision) {
        for (const comment of leftCollision) {
          this.renderer.fillRect(
            config.collisionRange.left,
            comment.posY,
            getConfig(config.contextLineWidth, comment.flash),
            comment.height,
          );
        }
      }
      if (rightCollision) {
        for (const comment of rightCollision) {
          this.renderer.fillRect(
            config.collisionRange.right,
            comment.posY,
            getConfig(config.contextLineWidth, comment.flash) * -1,
            comment.height,
          );
        }
      }
      this.renderer.restore();
    }
  }

  /**
   * FPSを描画する
   * @param drawCanvasStart 処理を開始した時間(ms)
   */
  private _drawFPS(drawCanvasStart: number) {
    const { config } = this.ctx;
    if (this.showFPS) {
      this.renderer.save();
      this.renderer.setFont(parseFont("defont", 60, config));
      this.renderer.setFillStyle("#00FF00");
      this.renderer.setStrokeStyle(
        `rgba(${hex2rgb(config.contextStrokeColor).join(",")},${
          config.contextStrokeOpacity
        })`,
      );
      const drawTime = Math.floor(performance.now() - drawCanvasStart);
      const fps = Math.floor(1000 / (drawTime === 0 ? 1 : drawTime));
      this.renderer.strokeText(`FPS:${fps}(${drawTime}ms)`, 100, 100);
      this.renderer.fillText(`FPS:${fps}(${drawTime}ms)`, 100, 100);
      this.renderer.restore();
    }
  }

  /**
   * 描画されたコメント数を描画する
   * @param count コメント描画数
   */
  private _drawCommentCount(count?: number | undefined) {
    const { config } = this.ctx;
    if (this.showCommentCount) {
      this.renderer.save();
      this.renderer.setFont(parseFont("defont", 60, config));
      this.renderer.setFillStyle("#00FF00");
      this.renderer.setStrokeStyle(
        `rgba(${hex2rgb(config.contextStrokeColor).join(",")},${
          config.contextStrokeOpacity
        })`,
      );
      this.renderer.strokeText(`Count:${count ?? 0}`, 100, 200);
      this.renderer.fillText(`Count:${count ?? 0}`, 100, 200);
      this.renderer.restore();
    }
  }

  /**
   * イベントハンドラを追加
   * @template K
   * @param eventName イベント名
   * @param handler イベントハンドラ
   */
  public addEventListener<K extends keyof CommentEventHandlerMap>(
    eventName: K,
    handler: CommentEventHandlerMap[K],
  ) {
    this.eventHandler.register(eventName, handler);
  }

  /**
   * イベントハンドラを削除
   * @template K
   * @param eventName イベント名
   * @param handler イベントハンドラ
   */
  public removeEventListener<K extends keyof CommentEventHandlerMap>(
    eventName: K,
    handler: CommentEventHandlerMap[K],
  ) {
    this.eventHandler.remove(eventName, handler);
  }

  /**
   * キャンバスを消去する
   */
  public clear() {
    if (this.cssRenderer) {
      this.cssRenderer.clear();
    }
    const clear = getRendererClear(this.renderer);
    if (clear) {
      clear.call(this.renderer);
    } else {
      const size = this.renderer.getSize();
      this.renderer.clearRect(0, 0, size.width, size.height);
    }
    this.renderer.flush();
  }

  public pauseCSS() {
    if (this.cssRenderer) {
      this.cssRenderer.pause();
    }
  }

  public resumeCSS() {
    if (this.cssRenderer) {
      this.cssRenderer.resume();
    }
  }

  /** Queue motion relayout for the next draw; preserve owners, parsed data and DOM. */
  public setScrollSpeed(speed: number): boolean {
    if (
      this.destroyed ||
      !Number.isFinite(speed) ||
      speed < 0.25 ||
      speed > 4 ||
      speed === this.ctx.config.scrollSpeed
    )
      return false;
    this.ctx.config.scrollSpeed = speed;
    this.pendingMotionLayout = true;
    this.frameDirty = true;
    return true;
  }

  private reflowMotion(vpos: number) {
    this.pendingMotionLayout = false;
    this.collision = { ue: {}, shita: {}, left: {}, right: {} };
    this.timeline = {};
    this.processedCommentIndex = -1;
    this.nextUnprocessedCommentIndex = 0;
    for (const comment of this.comments) comment.posY = -1;
    if (!this.ctx.options.lazy || !this.lazyCommentOrderSortedByVpos) {
      this.getCommentPos(this.comments, this.comments.length);
      this.sortTimelineComment();
    } else {
      this.resolveLazyCommentWindow(vpos);
    }
    this._cachedSplit = null;
    this.frameDirty = true;
    this.cssRenderer?.invalidateMotion();
  }

  public setPlaybackSpeed(speed: number) {
    if (this.cssRenderer) {
      this.cssRenderer.setPlaybackSpeed(speed);
    }
  }

  public getVisibleComments(): Record<string, unknown>[] {
    if (!this.cssRenderer) return [];
    const indices = this.cssRenderer.getVisibleCommentIndices();
    const result: Record<string, unknown>[] = [];
    for (const idx of indices) {
      const c = this.comments[idx];
      if (!c) continue;
      result.push({
        index: c.index,
        vpos: c.vpos,
        loc: c.loc,
        posY: c.posY,
        height: c.height,
      });
    }
    return result;
  }

  /**
   * \@ボタンの呼び出し用
   * @param vpos 再生位置
   * @param pos カーソルの位置
   */
  public click(vpos: number, pos: Position) {
    if (!isFiniteVpos(vpos) || !isFinitePosition(pos)) return;
    const _comments = this.timeline[Math.floor(vpos)];
    if (!_comments) return;
    for (let i = _comments.length - 1; i >= 0; i--) {
      const comment = _comments[i];
      if (!comment) continue;
      if (comment.isHovered(pos)) {
        const newComment = buildAtButtonComment(comment.comment, vpos);
        if (!newComment) continue;
        this.addComments(newComment);
      }
    }
  }

  private _log(msg: string) {
    if (this.ctx.options.debug) console.debug(msg);
  }
}

export default NiconiComments;
export type * from "@/@types";
