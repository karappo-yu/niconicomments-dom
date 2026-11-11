# WebKit CA 特殊空格错位调查

调查日期：2026-11-11。复现文件：`Steins;Gate0 ゲームED曲でコメント歌詞PV【コメ直表示版】.json`，定位到 217 秒（3:37）的 `1.048596`。测试使用完整 V1 数据及从该帧提取的四层最小样例。

## 结论与测量

同一台 Mac、相同字体配置、相同输入下，旧引擎在 Chromium 正常，在 Playwright WebKit 和 macOS 系统 WKWebView 均复现数字解体。主要原因是特殊空格的宽度差异，随后固定弹幕的自动缩放放大了这个差异；不是视频时钟或 GPU 动画不同步。

直接设置 `400 100px "Hiragino Sans"` 测量，结果如下（px）：

| 字符 | Chromium | WebKit 原始测量 | 兼容宽度 |
| --- | ---: | ---: | ---: |
| U+2000 EN QUAD | 50 | 27.783203 | 0.5em |
| U+2001 EM QUAD | 100 | 27.783203 | 1em |
| U+2004 THREE-PER-EM SPACE | 33.333328 | 27.783203 | 1/3em |
| U+2005 FOUR-PER-EM SPACE | 25 | 27.783203 | 0.25em |

这些不同宽度的字符在 WebKit 中得到相同的宽度，并且该值等于 Arial 普通空格的宽度；这符合缺失字形回退造成的现象。U+2002/U+2003 在 Hiragino 下仍能正确测量。只替换 U+2001 为 U+2003 不能解决剩余的空格差异。

四层弹幕在 1920×1080 逻辑坐标中的宽度如下。修复后的高度、字号与 Chromium 也一致。

| 原文件弹幕编号 | Chromium | WebKit 修复前 | WebKit 修复后 |
| --- | ---: | ---: | ---: |
| 935 | 1903.133236 | 610.014641 | 1903.133236 |
| 962 | 1911.566618 | 1596.720351 | 1911.566618 |
| 963 | 1917.188873 | 1090.717423 | 1917.188873 |
| 964 | 1903.133236 | 891.127379 | 1903.133236 |

占位空格变窄后，有的弹幕不再触发原本需要的宽度缩放，有的采用不同缩放比例。`ue` 与 `shita` 的高度和起点随之分离，最终把各层组成的数字拆开。

## 实现

- `src/utils/html5Spacers.ts`：按配置与字体缓存特性探测。只有 EN QUAD 与 EM QUAD 被测成同一正宽度时才启用兼容处理，并且只修正实测偏离 em 比例的字符。字体与浏览器正常时保留原生路径；显式 `compatSpacer.html5` 设置优先。
- `src/utils/niconico.ts`：把需要修正的空格分成已有的 `spacer` 项，测量时使用 em 宽度。拆分改为迭代，避免大量交替字符导致递归溢出；正常浏览器保留整段文本路径。
- `src/renderer/css.ts`：按同一比例生成 inline-block 空格，并保留原字符和行盒。没有使用零高度占位，以免只有空格的尾行消失。兼容彩色 `xN` 后缀及元素池复用。
- `src/comments/HTML5Comment.ts`：Canvas 绘制把 spacer 累加到横坐标，只有真实换行才推进纵坐标。原有 spacer 绘制把宽度误加到行号，这条原先默认不启用的路径也一并修正。重新解析内容时保留原字体。

输入文件、NicoScript 文本和原始特殊空格没有被替换；字号、行高和位置由修正后的测量自然得出，没有针对这个视频写坐标补丁。

## 验证与复现

环境：本机 macOS 27.2.1；Chromium 156.0.8078.4；Playwright WebKit 26.5。另用 AppKit + 系统 WKWebView 独立验证，旧包复现错误，新包恢复完整数字。这里的版本号来自本机测试程序，不代表浏览器的公开发行版本。

```sh
pnpm run check-types
pnpm run test:unit
pnpm run build:ts
pnpm run build:dts
pnpm exec playwright install chromium webkit
node scripts/check-ca-spaces.mjs
```

最后一条默认使用 `tests/fixtures/worldline-ca.json`（从原文件提取的四层弹幕，已展开 `<br>` 替换）。也可以验证完整 V1 文件：

```sh
node scripts/check-ca-spaces.mjs '/path/to/Steins;Gate0 ゲームED曲でコメント歌詞PV【コメ直表示版】.json'
```

已安装浏览器的可执行路径可分别通过 `CA_CHROMIUM_EXECUTABLE` 和 `CA_WEBKIT_EXECUTABLE` 指定。脚本是本机双浏览器字体兼容性检查；复现原问题应在装有 Hiragino 字体的 macOS 上运行。

脚本检查 CSS / Canvas 的四层几何、CSS 行盒、原始文本、元素池复用与固定弹幕合并后缀，并输出截图和测量值到 `test-results/ca-spaces/`。

本机实测：213 个单元测试通过；3:37 的 Chromium CSS 修复前后 RGBA 像素完全相同。1280×720 的 Chromium / Playwright WebKit CSS 截图，使用 pixelmatch `threshold: 0.1`、默认忽略抗锯齿像素时，差异从 3.784% 降至 0.020%；Canvas 修复后的差异为 0.303%。该比例是渲染回归指标，不等同于所有像素逐字节一致。

## 范围与限制

修复针对 U+2000–U+2006 中实测异常的 em 相对空格。Figure / punctuation / thin / hair space 的宽度依赖字体，未做统一覆盖。普通文字、字体栅格化、其他 CA 特殊字符仍可能有细小的跨浏览器差异。此帧通过不能证明所有 CA 都达到逐像素一致。

引擎源码及测试构建位于本仓库，构建产物为 `dist/bundle.js`，可作为 IINA 插件内置引擎的更新来源。
