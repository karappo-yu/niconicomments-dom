# [niconicomments](https://xpadev.net/niconicomments/)

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/xpadev-net/niconicomments/blob/master/LICENSE)
[![CodeQL](https://github.com/xpadev-net/niconicomments/actions/workflows/codeql-analysis.yml/badge.svg?branch=master)](https://github.com/xpadev-net/niconicomments/actions/workflows/codeql-analysis.yml)
[![TypeDoc](https://github.com/xpadev-net/niconicomments/actions/workflows/typedoc.yml/badge.svg?branch=master)](https://github.com/xpadev-net/niconicomments/actions/workflows/typedoc.yml)

[[日本語](https://github.com/xpadev-net/niconicomments/blob/develop/README.md)]
[[中文](https://github.com/karappo-yu/niconicomments-dom/blob/develop/README.zh.md)]

## ⚠️ About this fork

This repository is a personal fork by karappo-yu, customized specifically for the [IINA danmaku plugin (Danmaku Cosmos)](https://github.com/karappo-yu/iina-plugin-danmaku-cosmos).

It is specialized for IINA's WKWebView environment, so general-purpose compatibility is not guaranteed.

### Changes vs upstream

| Change | Description |
|---|---|
| **CSS renderer** `src/renderer/css.ts` | True DOM-based rendering (div + CSS `@keyframes`): crisp small fonts and GPU-composited smooth scrolling in WKWebView. Enabled via `mode: "css"`. Mutually exclusive with canvas rendering |
| **Owner scale exemption** | Owner comments are excluded from font scale adjustment so comment-art (CA) composition stays intact (CSS + HTML5 + Flash) |
| **Font scale floor** | When scaling down, font size never drops below 25% of medium size, enforced at the measurement layer so measurement/layout/rendering stay consistent |
| **Object pool** | Reuses up to 512 DOM nodes via a pool to cut DOM churn during burst |
| **`mode: "css"` added** | `"css"` added to `ModeType` and typeGuard |
| **CSS follows Auto** | Shares Canvas Auto's Flash/HTML5 selection by posting date, including `gothic` / `mincho` / `defont` and `nico:flash` overrides. Flash DOM uses the engine's font runs, compatibility spacers, line height, resizing and letter spacing alongside modern comments |
| **`_resolveCommentPositions` extracted** | Position-resolution logic extracted in main.ts so CSS mode can resolve positions directly from `drawCanvas` |
| **`pauseCSS` / `resumeCSS` / `getVisibleComments`** | Public CSS-mode APIs: pause/resume and visible-comment listing |

---
Comment rendering library that is somewhat compatible with the official Nico Nico Douga player  
Reference： https://xpadev-net.github.io/niconicomments/  
Github： https://github.com/xpadev-net/niconicomments  
npm： https://www.npmjs.com/package/@xpadev-net/niconicomments

## Installation

```html
<script src="https://cdn.jsdelivr.net/npm/@xpadev-net/niconicomments@0.3.1/dist/bundle.js"></script>
```

or

```
npm i @xpadev-net/niconicomments
```

## Examples

```javascript
const canvas = document.getElementById("canvas");
const video = document.getElementById("video");
const req = await fetch("sample.json");
const res = await req.json();
const niconiComments = new NiconiComments(canvas, res);
//If video.ontimeupdate is used, the comments will be choppy due to the small number of calls.
setInterval(
  () => niconiComments.drawCanvas(video.currentTime * 100),
  10
);
```

## Sample

[Sample](https://xpadev-net.github.io/niconicomments/sample/)

### For users who use this library for domestic use in Japan

This library may infringe on Dwango's patents depending on how it is used  
Please carefully review the following applicable patents and case law before using this library with caution.  
[JP,2006-333851](https://www.j-platpat.inpit.go.jp/c1800/PU/JP-2006-333851/7294651F33633E1EBF3DEC66FAE0ECAD878D19E1829C378FC81D26BBD0A4263B/10/en)  
[JP,2010-267283](https://www.j-platpat.inpit.go.jp/c1800/PU/JP-4734471/9085C128B7ED7D57F6C2F09D9BE4FCB496E638331DB9EC7ADE1E3A44999A3878/15/en)  
[JP,2018-202475](https://www.j-platpat.inpit.go.jp/c1800/PU/JP-6526304/D8AF77CFB92D96C785FEECBD690C53E2F9023F1739E7A5BBDAB588E2ECAC5316/15/en)  
[2018: Case No. Heisei 28 (wa) 38565, Patent Infringement Injunction, etc. Patent Right Civil Litigation](https://www.courts.go.jp/app/files/hanrei_jp/073/088073_hanrei.pdf)  
[2022: Heisei 30 (ne) 10077 Appeal for Patent Infringement Injunction, etc. Patent Right Civil Litigation](https://www.courts.go.jp/app/files/hanrei_jp/418/091418_hanrei.pdf)
