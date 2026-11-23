import path from "node:path";
import { expect, test } from "@playwright/test";

test("playback speed preserves animation model phase, pause, reuse and cleanup", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(
    '<div style="position:relative;width:1280px;height:720px"><canvas id="canvas" width="1920" height="1080" style="width:1280px;height:720px"></canvas></div>',
  );
  await page.addScriptTag({ path: path.resolve("dist/bundle.js") });
  const result = await page.evaluate(async () => {
    const Engine = (
      window as typeof window & {
        NiconiComments: typeof import("@/main").default;
      }
    ).NiconiComments;
    const frame = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    const delay = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    const rows = [
      { id: 1, content: "HTML5", date: 1700000000, mail: ["naka", "@20"] },
      { id: 2, content: "Flash", date: 1300000000, mail: ["naka", "@20"] },
      { id: 3, content: "fixed", date: 1700000000, mail: ["ue"] },
    ].map((row) => ({
      vpos: 0,
      date_usec: 0,
      owner: false,
      premium: false,
      user_id: row.id,
      layer: -1,
      is_my_post: false,
      ...row,
    }));
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    const nc = new Engine(canvas, rows, { format: "formatted", mode: "css" });
    nc.drawCanvas(100, true);
    await frame();
    const elements = [
      ...document.querySelectorAll<HTMLDivElement>("[data-dm-comment]"),
    ];
    const scrolling = elements.filter(
      (element) => element.textContent !== "fixed",
    );
    const fixed = elements.find((element) => element.textContent === "fixed");
    const original = scrolling.map(
      (element) => element.getAnimations()[0] as CSSAnimation,
    );
    const names = scrolling.map((element) => element.style.animation);
    const fixedStyle = fixed?.style.cssText;
    await delay(220);
    const beforeSpeed = original.map((animation) =>
      Number(animation.currentTime),
    );
    nc.setPlaybackSpeed(2);
    await Promise.all(original.map((animation) => animation.ready));
    const afterSpeed = original.map((animation) =>
      Number(animation.currentTime),
    );
    const speedRates = original.map((animation) => animation.playbackRate);
    await delay(220);
    const beforeRestore = original.map((animation) =>
      Number(animation.currentTime),
    );
    nc.setPlaybackSpeed(1);
    await Promise.all(original.map((animation) => animation.ready));
    const afterRestore = original.map((animation) =>
      Number(animation.currentTime),
    );
    const restoreRates = original.map((animation) => animation.playbackRate);
    nc.pauseCSS();
    await frame();
    const pausedTimes = original.map((animation) =>
      Number(animation.currentTime),
    );
    nc.setPlaybackSpeed(4);
    await frame();
    const afterPausedSpeed = original.map((animation) =>
      Number(animation.currentTime),
    );
    const pausedStates = original.map((animation) => animation.playState);
    const sameAnimations = scrolling.every(
      (element, index) => element.getAnimations()[0] === original[index],
    );
    const sameStyles = scrolling.every(
      (element, index) => element.style.animation === names[index],
    );
    const fixedStable = fixed?.style.cssText === fixedStyle;
    nc.clear();
    const retired = original.map((animation) => ({
      state: animation.playState,
      timeline: animation.timeline !== null,
    }));
    nc.setPlaybackSpeed(2);
    nc.drawCanvas(100, true);
    await frame();
    const reused = [
      ...document.querySelectorAll<HTMLDivElement>("[data-dm-comment]"),
    ];
    const newScroll = reused.filter(
      (element) => element.textContent !== "fixed",
    );
    const newAnimations = newScroll.map(
      (element) => element.getAnimations()[0] as CSSAnimation,
    );
    const initialReusedRates = newAnimations.map(
      (animation) => animation.playbackRate,
    );
    nc.setPlaybackSpeed(1);
    await frame();
    const reusedRates = newAnimations.map(
      (animation) => animation.playbackRate,
    );
    nc.destroy();
    const reusedRetired = newAnimations.map((animation) => ({
      state: animation.playState,
      timeline: animation.timeline !== null,
    }));
    return {
      beforeSpeed,
      afterSpeed,
      speedRates,
      beforeRestore,
      afterRestore,
      restoreRates,
      pausedTimes,
      afterPausedSpeed,
      pausedStates,
      sameAnimations,
      sameStyles,
      fixedStable,
      retired,
      initialReusedRates,
      reusedRates,
      reusedRetired,
    };
  });
  expect(result.sameAnimations).toBe(true);
  expect(result.sameStyles).toBe(true);
  expect(result.fixedStable).toBe(true);
  expect(result.speedRates).toEqual([2, 2]);
  expect(result.restoreRates).toEqual([1, 1]);
  for (let index = 0; index < 2; index++) {
    expect(result.afterSpeed[index]).toBeGreaterThanOrEqual(
      result.beforeSpeed[index] ?? 0,
    );
    expect(result.afterRestore[index]).toBeGreaterThanOrEqual(
      result.beforeRestore[index] ?? 0,
    );
    expect(result.afterPausedSpeed[index]).toBeCloseTo(
      result.pausedTimes[index] ?? 0,
      2,
    );
  }
  expect(result.pausedStates).toEqual(["paused", "paused"]);
  expect(result.retired).toEqual([
    { state: "idle", timeline: false },
    { state: "idle", timeline: false },
  ]);
  expect(result.initialReusedRates).toEqual([1, 1]);
  expect(result.reusedRates).toEqual([0.5, 0.5]);
  expect(result.reusedRetired).toEqual([
    { state: "idle", timeline: false },
    { state: "idle", timeline: false },
  ]);
});
