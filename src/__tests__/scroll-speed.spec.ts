import path from "node:path";
import { expect, test } from "@playwright/test";
import type { BaseConfig, IComment } from "@/@types";
import type NiconiComments from "@/main";

test("live CSS speed reuses nodes, preserves pause and fixed positions, and matches Canvas motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(
    '<div style="position:relative;width:1280px;height:720px"><canvas id="canvas" width="1920" height="1080" style="width:1280px;height:720px"></canvas></div>',
  );
  await page.addScriptTag({ path: path.resolve("dist/bundle.js") });
  const result = await page.evaluate(() => {
    const Engine = (
      window as unknown as { NiconiComments: typeof NiconiComments }
    ).NiconiComments;
    const rows = [
      {
        id: 1,
        vpos: 100,
        content: "scrollx2",
        mail: [],
        comboSuffix: "x2",
        comboSuffixColor: "#ff8080",
      },
      { id: 2, vpos: 100, content: "bottom", mail: ["shita"] },
      { id: 3, vpos: 100, content: "custom", mail: ["@7"] },
    ].map((c) => ({ date: 1767196800, premium: true, ...c }));
    const canvas = document.getElementById("canvas") as HTMLCanvasElement;
    const nc = new Engine(canvas, rows, { format: "formatted", mode: "css" });
    const internal = nc as unknown as {
      comments: IComment[];
      ctx: { config: BaseConfig };
    };
    nc.pauseCSS();
    nc.drawCanvas(200, true);
    const nodes = Array.from(
      document.querySelectorAll("[data-dm-comment]"),
    ) as HTMLElement[];
    const bottom = nodes.find((el) => el.textContent === "bottom");
    if (!bottom) throw new Error("Missing bottom comment");
    const initialTop = bottom.style.top;
    const scroll = nodes.find((el) => el.textContent === "scrollx2");
    if (!scroll) throw new Error("Missing scrolling comment");
    const initialDuration = parseFloat(scroll.style.animationDuration);
    const suffixColor = (scroll.querySelector("span") as HTMLElement)?.style
      .color;
    const instances = internal.comments.slice();
    nc.setScrollSpeed(0.5);
    nc.drawCanvas(200, true);
    const current = Array.from(document.querySelectorAll("[data-dm-comment]"));
    const changedDuration = parseFloat(scroll.style.animationDuration);
    const fromX = Number(scroll.style.getPropertyValue("--dm-from"));
    const c = internal.comments[0];
    if (!c) throw new Error("Missing comment instance");
    const motionExpected =
      internal.ctx.config.commentDrawPadding +
      internal.ctx.config.commentDrawRange -
      (((200 - c.vpos + 100) *
        (internal.ctx.config.commentDrawRange +
          c.width * internal.ctx.config.nakaCommentSpeedOffset)) /
        (c.long + 100)) *
        0.5;
    const output = {
      sameNodes: nodes.every((el) => current.includes(el)),
      sameInstances: instances.every((c, i) => internal.comments[i] === c),
      bottomStable: bottom.style.top === initialTop,
      paused: getComputedStyle(scroll).animationPlayState,
      durationGrew: changedDuration > initialDuration,
      xError: Math.abs(fromX - motionExpected),
      suffixColor,
      longs: internal.comments.map((c) => c.long),
    };
    nc.setPlaybackSpeed(4);
    nc.drawCanvas(220, true);
    nc.destroy();
    return output;
  });
  expect(result.sameNodes).toBe(true);
  expect(result.sameInstances).toBe(true);
  expect(result.bottomStable).toBe(true);
  expect(result.paused).toBe("paused");
  expect(result.durationGrew).toBe(true);
  expect(result.xError).toBeLessThan(0.01);
  expect(result.suffixColor).toBe("rgb(255, 128, 128)");
  expect(result.longs).toEqual([300, 300, 700]);
});
