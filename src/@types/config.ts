import type {
  CommentSize,
  FormattedComment,
  IPluginConstructor,
  PlatformFont,
} from "@/@types/";
import type { BaseComment } from "@/comments/";
import type { BaseOptions } from "./options";

export type ConfigItem<T> = T | MultiConfigItem<T>;

export type MultiConfigItem<T> = { html5: T; flash: T };
type ConfigSizeItem<T> = { big: T; medium: T; small: T };
type ConfigResizedItem<T> = { default: T; resized: T };
type ConfigFlashFontItem<T> = { gulim: T; simsun: T; defont: T };
type ConfigHTML5FontItem<T> = { gothic: T; mincho: T; defont: T };

export type CommentStageSize = {
  width: number;
  fullWidth: number;
  height: number;
};

type FlashCharList = {
  [key in "simsunStrong" | "simsunWeak" | "gulim" | "gothic"]: string;
};
export type FlashMode = "xp" | "vista";
export type FlashScriptChar = {
  [key in "super" | "sub"]: string;
};
type FontList = {
  [key in "gulim" | "simsun"]: string;
};
type LineCounts = {
  [key in "default" | "resized" | "doubleResized"]: ConfigSizeItem<number>;
};

export type BaseConfig = {
  cacheAge: number;
  canvasHeight: number;
  canvasWidth: number;
  collisionRange: { [key in "left" | "right"]: number };
  collisionPadding: number;
  colors: { [key: string]: string };
  commentDrawPadding: number;
  commentDrawRange: number;
  commentScale: ConfigItem<number>;
  commentStageSize: ConfigItem<CommentStageSize>;
  flashCommentYOffset: ConfigSizeItem<ConfigResizedItem<number>>;
  flashCommentYPaddingTop: ConfigResizedItem<number>;
  contextFillLiveOpacity: number;
  contextLineWidth: ConfigItem<number>;
  contextStrokeColor: string;
  contextStrokeInversionColor: string;
  contextStrokeOpacity: number;
  /** CSS-only shadow blur, 0–10 px before comment/display scaling; 0 disables it. */
  cssTextShadowBlur: number;
  flashChar: FlashCharList;
  flashMode: FlashMode;
  flashScriptChar: FlashScriptChar;
  flashThreshold: number;
  fonts: {
    flash: FontList;
    html5: PlatformFont;
  };
  fontSize: ConfigItem<ConfigSizeItem<ConfigResizedItem<number>>>;
  fpsInterval: number;
  html5HiResCommentCorrection: number;
  html5LineCounts: ConfigItem<LineCounts>;
  lineHeight: ConfigItem<ConfigSizeItem<ConfigResizedItem<number>>>;
  html5MinFontSize: number;
  sameCAGap: number;
  sameCAMinScore: number;
  sameCARange: number;
  sameCATimestampRange: number;
  flashLetterSpacing: number;
  flashScriptCharOffset: number;
  plugins: IPluginConstructor[];
  commentPlugins: {
    class: typeof BaseComment;
    condition: (
      comment: FormattedComment,
      config: BaseConfig,
      options: BaseOptions,
    ) => boolean;
  }[];
  commentLimit: number | undefined;
  hideCommentOrder: "asc" | "desc";
  /**
   * 固定弹幕(ue/shita)渐进合并(combo): 同文本固定弹幕在前一条还在屏上时
   * 到达 → 在原位渐进显示为 原文x2, x3…(显示计时随最后到达者重置)。
   * 关闭时固定弹幕原样逐条显示。滚动弹幕(naka)不受此配置影响。
   */
  fixedCombo: boolean;
  /**
   * 滚动弹幕(naka)窗口去重窗口(1/100s): 同文本滚动弹幕在窗口内静态合并
   * (最早者胜,宿主文本追加 xN 后缀并随机着色,成员隐藏)。0 = 关闭。
   * owner / 固定弹幕不参与。与 fixedCombo(固定弹幕渐进合并)互不影响。
   */
  nakaDedupeWindow: number;
  lineBreakCount: { [key in CommentSize]: number };
  nakaCommentSpeedOffset: number;
  /** Viewer horizontal speed multiplier; owners and native durations remain intact. */
  scrollSpeed: number;
  atButtonPadding: number;
  atButtonRadius: number;
  flashDoubleResizeHeights: Partial<
    ConfigSizeItem<{
      [key: number]: number;
    }>
  >;
  flashLineBreakScale: ConfigSizeItem<number>;
  compatSpacer: {
    flash: {
      [key: string]: Partial<ConfigFlashFontItem<number>>;
    };
    html5: {
      [key: string]: Partial<ConfigHTML5FontItem<number>>;
    };
  };
};

/**
 * Instance config overrides are shallow: each provided top-level key replaces
 * the matching default config value. Nested objects are full replacements and
 * must contain the complete structure described by BaseConfig, except where
 * BaseConfig itself marks nested entries as partial.
 */
export type Config = Partial<BaseConfig>;
