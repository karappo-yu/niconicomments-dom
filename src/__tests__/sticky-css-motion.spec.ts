import path from "node:path";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(
    '<div style="position:relative;width:1280px;height:720px"><canvas id="canvas" width="1920" height="1080" style="width:1280px;height:720px"></canvas></div>',
  );
  await page.addScriptTag({ path: path.resolve("dist/bundle.js") });
});

test("speed handoff is deferred, sticky, fractional and leaves fixed and future 1x comments unchanged", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const Engine = (
      window as typeof window & {
        NiconiComments: typeof import("@/main").default;
      }
    ).NiconiComments;
    const rows = [
      {
        id: 1,
        content: "HTML5",
        date: 1700000000,
        vpos: 0,
        mail: ["naka", "@20"],
      },
      {
        id: 2,
        content: "Flash",
        date: 1300000000,
        vpos: 0,
        mail: ["naka", "@20"],
      },
      {
        id: 3,
        content: "fixed",
        date: 1700000000,
        vpos: 0,
        mail: ["ue", "@20"],
      },
      {
        id: 4,
        content: "boost-born",
        date: 1700000000,
        vpos: 600,
        mail: ["naka", "@20"],
      },
      {
        id: 5,
        content: "normal-born",
        date: 1700000000,
        vpos: 1000,
        mail: ["naka", "@20"],
      },
      {
        id: 6,
        content: "owner",
        date: 1700000000,
        vpos: 0,
        mail: ["naka", "@20"],
        owner: true,
      },
    ].map((row) => ({
      date_usec: 0,
      owner: false,
      premium: false,
      user_id: row.id,
      layer: -1,
      is_my_post: false,
      ...row,
    }));
    const nc = new Engine(
      document.getElementById("canvas") as HTMLCanvasElement,
      rows,
      { format: "formatted", mode: "css" },
    );
    const internal = nc as unknown as {
      cssRenderer: {
        frameDrivenElements: Map<HTMLDivElement, { lastX: number }>;
        updateComments(
          comments: import("@/@types").IComment[],
          vpos: number,
          state: import("@/@types").FrameActiveState,
        ): void;
      };
      comments: import("@/@types").IComment[];
      ctx: {
        config: import("@/@types").BaseConfig;
        viewport: { width: number; offsetX: number };
      };
    };
    const frame = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    const find = (text: string) => {
      const element = [
        ...document.querySelectorAll<HTMLDivElement>("[data-dm-comment]"),
      ].find((element) => element.textContent === text);
      if (!element) throw new Error(`Missing fixture: ${text}`);
      return element;
    };
    const x = (element: HTMLDivElement) =>
      new DOMMatrix(getComputedStyle(element).transform).m41;
    nc.drawCanvas(100, true);
    await frame();
    const first = find("HTML5"),
      flash = find("Flash"),
      fixed = find("fixed"),
      owner = find("owner");
    const originalAnimations = [first, flash].map((element) => {
      const animation = element.getAnimations()[0];
      if (!animation) throw new Error("Missing initial CSS animation");
      return animation;
    });
    const originalStyles = [first, flash].map(
      (element) => element.style.animation,
    );
    const fixedStyle = fixed.style.cssText;
    const normalInitially = !nc.needsContinuousCSSDraw();
    nc.setPlaybackSpeed(2);
    const deferred =
      [first, flash].every(
        (element, index) => element.style.animation === originalStyles[index],
      ) &&
      originalAnimations.every(
        (animation) => animation.playState === "running",
      );
    const drewSameVpos = nc.drawCanvas(100);
    const retired = originalAnimations.map((animation) => ({
      state: animation.playState,
      timeline: animation.timeline !== null,
    }));
    const at100 = x(first);
    const frameState = internal.cssRenderer.frameDrivenElements.get(first);
    if (!frameState) throw new Error("Missing frame handoff state");
    const logicalAt100 = frameState.lastX;
    nc.drawCanvas(100.125);
    const atFraction = x(first);
    const c = internal.comments.find((comment) => comment.content === "HTML5");
    if (!c) throw new Error("Missing parsed HTML5 fixture");
    const cfg = internal.ctx.config;
    const horizontalSpeed =
      ((cfg.commentDrawRange + c.width * cfg.nakaCommentSpeedOffset) /
        (c.long + 100)) *
      cfg.scrollSpeed;
    const fractionalError = Math.abs(
      at100 - atFraction - (0.125 * horizontalSpeed * 720) / 1080,
    );
    const fractionalLogicalError = Math.abs(
      logicalAt100 - frameState.lastX - 0.125 * horizontalSpeed,
    );
    nc.drawCanvas(500.125);
    const bornDuringBoost = find("boost-born");
    const bornE =
      internal.cssRenderer.frameDrivenElements.has(bornDuringBoost) &&
      bornDuringBoost.style.animationName === "none" &&
      bornDuringBoost.getAnimations().length === 0;
    nc.setPlaybackSpeed(1);
    nc.drawCanvas(500.125);
    nc.drawCanvas(900.125);
    const normalBorn = find("normal-born");
    const sticky = [first, flash, owner, bornDuringBoost].every(
      (element) =>
        internal.cssRenderer.frameDrivenElements.has(element) &&
        element.style.animationName === "none",
    );
    const normalNew =
      !internal.cssRenderer.frameDrivenElements.has(normalBorn) &&
      normalBorn.style.animationName === "dm-scroll";
    const beforePaused = x(first);
    nc.pauseCSS();
    nc.drawCanvas(900.125);
    await frame();
    const pausedError = Math.abs(x(first) - beforePaused);
    const fixedStable =
      find("fixed") === fixed && fixed.style.cssText === fixedStyle;
    const state = {
      banActive: false,
      reverseActiveOwner: false,
      reverseActiveViewer: false,
    };
    internal.cssRenderer.updateComments([], 100_000, state);
    const drained =
      !nc.needsContinuousCSSDraw() &&
      internal.cssRenderer.frameDrivenElements.size === 0;
    nc.destroy();
    return {
      normalInitially,
      deferred,
      drewSameVpos,
      retired,
      fractionalError,
      fractionalLogicalError,
      bornE,
      sticky,
      normalNew,
      pausedError,
      fixedStable,
      drained,
    };
  });
  expect(result.normalInitially).toBe(true);
  expect(result.deferred).toBe(true);
  expect(result.drewSameVpos).toBe(true);
  expect(result.retired).toEqual([
    { state: "idle", timeline: false },
    { state: "idle", timeline: false },
  ]);
  expect(result.fractionalLogicalError).toBeLessThan(1e-8);
  expect(result.fractionalError).toBeLessThan(0.01);
  expect(result.bornE).toBe(true);
  expect(result.sticky).toBe(true);
  expect(result.normalNew).toBe(true);
  expect(result.pausedError).toBeLessThan(0.001);
  expect(result.fixedStable).toBe(true);
  expect(result.drained).toBe(true);
});

test("frame nodes follow Canvas coordinates, reverse, limits and pooled-node cleanup", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const Engine = (
      window as typeof window & {
        NiconiComments: typeof import("@/main").default;
      }
    ).NiconiComments;
    const rows = [
      {
        id: 1,
        vpos: 0,
        content: "motion",
        date: 1700000000,
        date_usec: 0,
        owner: false,
        premium: false,
        mail: ["naka", "@20"],
        user_id: 1,
        layer: -1,
        is_my_post: false,
      },
    ];
    const nc = new Engine(
      document.getElementById("canvas") as HTMLCanvasElement,
      rows,
      { format: "formatted", mode: "css" },
    );
    const internal = nc as unknown as {
      comments: import("@/@types").IComment[];
      ctx: {
        config: import("@/@types").BaseConfig;
        viewport: { width: number; offsetX: number };
      };
      cssRenderer: {
        frameDrivenElements: Map<HTMLDivElement, { lastX: number }>;
        updateComments(
          comments: import("@/@types").IComment[],
          vpos: number,
          state: import("@/@types").FrameActiveState,
        ): void;
      };
    };
    nc.setPlaybackSpeed(0.5);
    nc.drawCanvas(100, true);
    const element = document.querySelector<HTMLDivElement>("[data-dm-comment]"),
      comment = internal.comments[0];
    if (!element || !comment) throw new Error("Missing motion fixture");
    const cfg = internal.ctx.config;
    const frame = internal.cssRenderer.frameDrivenElements.get(element);
    if (!frame) throw new Error("Missing frame motion state");
    const positionError = (expectedX: number) => ({
      logical: Math.abs(frame.lastX - expectedX),
      // getComputedStyle serializes the browser's rounded transform in CSS pixels.
      css: Math.abs(
        new DOMMatrix(getComputedStyle(element).transform).m41 -
          (expectedX * 720) / 1080,
      ),
    });
    const state = {
      banActive: false,
      reverseActiveOwner: false,
      reverseActiveViewer: false,
    };
    const expected =
      cfg.commentDrawPadding +
      cfg.commentDrawRange -
      (((100 - comment.vpos + 100) *
        (cfg.commentDrawRange + comment.width * cfg.nakaCommentSpeedOffset)) /
        (comment.long + 100)) *
        cfg.scrollSpeed +
      internal.ctx.viewport.offsetX;
    const xError = positionError(expected);
    internal.cssRenderer.updateComments([comment], 100, {
      ...state,
      reverseActiveViewer: true,
    });
    const reverseError = positionError(
      internal.ctx.viewport.width - comment.width - expected,
    );
    nc.drawCanvas(1000, true);
    nc.setScrollSpeed(0.5);
    nc.drawCanvas(1000, true);
    const relayoutE = element.style.animationName === "none";
    cfg.commentLimit = 0;
    nc.drawCanvas(1000, true);
    const limited =
      internal.cssRenderer.frameDrivenElements.size === 0 &&
      !document.querySelector("[data-dm-comment]");
    cfg.commentLimit = undefined;
    nc.setPlaybackSpeed(1);
    nc.drawCanvas(1000, true);
    const pooled = document.querySelector<HTMLDivElement>("[data-dm-comment]");
    if (!pooled) throw new Error("Missing reused fixture");
    const poolClean =
      pooled === element &&
      pooled.style.transform === "" &&
      pooled.style.animationName === "dm-scroll" &&
      !nc.needsContinuousCSSDraw();
    nc.destroy();
    return {
      xError,
      reverseError,
      relayoutE,
      limited,
      poolClean,
      long: comment.long,
    };
  });
  for (const error of [result.xError, result.reverseError]) {
    expect(error.logical).toBeLessThan(1e-8);
    expect(error.css).toBeLessThan(0.01);
  }
  expect(result.relayoutE, JSON.stringify(result)).toBe(true);
  expect(result.limited).toBe(true);
  expect(result.poolClean).toBe(true);
});

test("normal 1x uses the same CSS animation without per-frame style mutations or animation queries", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const Engine = (
      window as typeof window & {
        NiconiComments: typeof import("@/main").default;
      }
    ).NiconiComments;
    const nc = new Engine(
      document.getElementById("canvas") as HTMLCanvasElement,
      [
        {
          id: 1,
          vpos: 0,
          content: "normal",
          date: 1700000000,
          date_usec: 0,
          owner: false,
          premium: false,
          mail: ["naka", "@20"],
          user_id: 1,
          layer: -1,
          is_my_post: false,
        },
      ],
      { format: "formatted", mode: "css" },
    );
    nc.drawCanvas(100, true);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const element = document.querySelector<HTMLDivElement>("[data-dm-comment]");
    if (!element) throw new Error("Missing normal CSS fixture");
    const style = element.style.cssText,
      animation = element.getAnimations()[0];
    let mutations = 0,
      reads = 0;
    const observer = new MutationObserver(
      (records) => (mutations += records.length),
    );
    observer.observe(element, { attributes: true, attributeFilter: ["style"] });
    const getAnimations = Element.prototype.getAnimations;
    Element.prototype.getAnimations = function (...args) {
      reads++;
      return getAnimations.apply(this, args);
    };
    const skippedSameVpos = nc.drawCanvas(100) === false;
    for (let index = 1; index <= 30; index++) {
      nc.setPlaybackSpeed(1);
      nc.drawCanvas(100 + index * 0.125);
    }
    await Promise.resolve();
    observer.disconnect();
    Element.prototype.getAnimations = getAnimations;
    const same =
      element.style.cssText === style &&
      element.getAnimations()[0] === animation;
    const query = nc.needsContinuousCSSDraw();
    nc.destroy();
    return { mutations, reads, skippedSameVpos, same, query };
  });
  expect(result.mutations).toBe(0);
  expect(result.reads).toBe(0);
  expect(result.skippedSameVpos).toBe(true);
  expect(result.same).toBe(true);
  expect(result.query).toBe(false);
});
