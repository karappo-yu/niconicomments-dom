# [niconicomments](https://xpadev.net/niconicomments/)

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/xpadev-net/niconicomments/blob/master/LICENSE)
[![CodeQL](https://github.com/xpadev-net/niconicomments/actions/workflows/codeql-analysis.yml/badge.svg?branch=master)](https://github.com/xpadev-net/niconicomments/actions/workflows/codeql-analysis.yml)
[![TypeDoc](https://github.com/xpadev-net/niconicomments/actions/workflows/typedoc.yml/badge.svg?branch=master)](https://github.com/xpadev-net/niconicomments/actions/workflows/typedoc.yml)

[[English](https://github.com/xpadev-net/niconicomments/blob/develop/README.en.md)]
[[中文](https://github.com/karappo-yu/niconicomments-dom/blob/develop/README.zh.md)]

## ⚠️ このフォークについて

このリポジトリは karappo-yu の個人フォークで、[IINA 用コメント描画プラグイン (Danmaku Cosmos)](https://github.com/karappo-yu/iina-plugin-danmaku-cosmos) 専用にカスタマイズしたものです。

IINA の WKWebView 環境に特化したため、汎用ライブラリとしての互換性・保守性は保証しません。

### 主な変更点

| 変更 | 説明 |
|---|---|
| **CSS レンダラーの追加** `src/renderer/css.ts` | div と CSS アニメーションによる DOM 描画。WKWebView でも小さな文字がくっきり表示され、スクロールは GPU 合成で滑らかに動きます。`mode: "css"` で有効 |
| **投稿者コメントのスケール除外** | 投稿者コメントはフォントのスケール調整の対象外にし、CA(コメントアート)のレイアウトが崩れないようにしました。CSS / HTML5 / Flash すべてに適用 |
| **フォント縮小の下限** | 縮小時、フォントが medium サイズの 25% 未満にならないよう測定レイヤーで調整。測定・レイアウト・描画のデータが一致します |
| **DOM ノードのプール** | 最大 512 個の DOM ノードを再利用し、コメントが集中する場面でも生成・破棄のコストを抑えます |
| **`mode: "css"` の追加** | `ModeType` と typeGuard に `"css"` を追加 |
| **CSS の Auto 互換** | Canvas Auto と同じ投稿日時・コマンドによる Flash / HTML5 判定を使用。`gothic` / `mincho` / `defont` と `nico:flash` を尊重し、Flash コメントのフォント分割・互換空白・行間・縮小・字間を DOM に反映 |
| **`_resolveCommentPositions` の切り出し** | CSS モードが `drawCanvas` から直接位置を解決できるよう、main.ts の位置解決ロジックを分離 |
| **CSS モード用の公開 API** | `pauseCSS` / `resumeCSS` / `getVisibleComments`(一時停止・再開・表示中のコメント一覧の取得) |

---
ニコニコ動画の公式プレイヤー互換の高パフォーマンスなコメント描画ライブラリ  
High peformance High compatibility comment drawing library  
Reference： https://xpadev-net.github.io/niconicomments/  
Github： https://github.com/xpadev-net/niconicomments  
npm： https://www.npmjs.com/package/@xpadev-net/niconicomments


## Installation

CDN から読み込む場合は、可変エイリアスではなく固定バージョンを指定してください。

```html
<script src="https://cdn.jsdelivr.net/npm/@xpadev-net/niconicomments@0.3.1/dist/bundle.js"></script>
```

or

```shell
npm i @xpadev-net/niconicomments
```

npm で読み込む場合:

```javascript
import NiconiComments from "@xpadev-net/niconicomments";
```

## Examples

```javascript
const canvas = document.getElementById("canvas");
const video = document.getElementById("video");
const req = await fetch("sample.json");
const res = await req.json();
const niconiComments = new NiconiComments(canvas, res);
//video.ontimeupdateを使用すると、呼び出し回数の関係でコメントカクつく
let animationFrameId = null;

const stopDrawing = () => {
  if (animationFrameId === null) return;
  cancelAnimationFrame(animationFrameId);
  animationFrameId = null;
};

const draw = () => {
  animationFrameId = null;
  niconiComments.drawCanvas(video.currentTime * 100);
  if (!video.paused && document.visibilityState !== "hidden") {
    animationFrameId = requestAnimationFrame(draw);
  }
};

const startDrawing = () => {
  if (animationFrameId === null && document.visibilityState !== "hidden") {
    animationFrameId = requestAnimationFrame(draw);
  }
};

video.addEventListener("play", startDrawing);
video.addEventListener("pause", () => {
  stopDrawing();
  niconiComments.drawCanvas(video.currentTime * 100);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" || video.paused) {
    stopDrawing();
  } else {
    startDrawing();
  }
});
```

## Sample

[サンプル](https://xpadev-net.github.io/niconicomments/sample/)


### このライブラリを使用される方へ

このライブラリを使用するかどうかに関わらず、リアルタイムでコメントを取得、画面を描画、コメントの投稿という一連の流れを実装した場合、ニコニコの特許を侵害する可能性があります  
詳しくはこちら[ニコニコが保有する特許について](https://github.com/xpadev-net/niconicomments/blob/develop/ABOUT_PATENT.md)を参照してください
