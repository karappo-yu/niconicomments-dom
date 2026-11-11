# niconicomments(fork)

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/xpadev-net/niconicomments/blob/master/LICENSE)

[[日本語](https://github.com/karappo-yu/niconicomments-dom/blob/develop/README.md)]
[[English](https://github.com/karappo-yu/niconicomments-dom/blob/develop/README.en.md)]

## ⚠️ 关于本 fork

本仓库为 karappo-yu 的个人 fork,专为 [IINA 弹幕插件 (Danmaku Cosmos)](https://github.com/karappo-yu/iina-plugin-danmaku-cosmos) 定制。

特化于 IINA 的 WKWebView 环境,不保证作为通用库的兼容性与可维护性。

## 改动清单(相对上游)

| 改动 | 说明 |
|---|---|
| **CSS 渲染器** `src/renderer/css.ts` | 真正的 DOM 渲染 (div + CSS `@keyframes`):小字号依然锐利(系统字体管线 vs canvas 位图采样),滚动走 GPU 合成。通过 `mode: "css"` 启用,与 canvas 渲染互斥 |
| **owner 评论缩放豁免** | 投稿者评论不参与字号缩放,保护 CA(弹幕艺术)构图不因缩放变形(CSS + HTML5 + Flash 三处) |
| **字号缩小下限 (font scale floor)** | 缩小时字号不低于 medium 的 25%。在测量层统一抬升 charSize/lineHeight/fontSize/height/width,保证测量、布局、渲染数据一致 |
| **对象池** | 最多复用 512 个 DOM 节点,降低弹幕爆发时的 DOM 创建/销毁开销 |
| **`mode: "css"` 接入** | 在 `ModeType` 与 typeGuard 中新增 `"css"` 模式 |
| **CSS 对齐 Auto** | 与 Canvas Auto 共用 Flash/H5 判断：默认按投稿时间分流，尊重 `gothic` / `mincho` / `defont` 和 `nico:flash`。Flash DOM 使用引擎的字体分段、兼容空白、行距、缩放与字距，支持新旧弹幕混排 |
| **`_resolveCommentPositions` 抽取** | 从 main.ts 抽出位置解析逻辑,CSS 模式可直接从 `drawCanvas` 解析位置后交给 DOM 渲染器 |
| **`pauseCSS` / `resumeCSS` / `getVisibleComments`** | CSS 模式专用公开 API:暂停/恢复、获取当前可见弹幕列表 |

---

原项目说明见上游 [xpadev-net/niconicomments](https://github.com/xpadev-net/niconicomments)。
