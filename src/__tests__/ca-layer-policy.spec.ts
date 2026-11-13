import path from "node:path";
import { expect, test } from "@playwright/test";
import type { IComment } from "@/@types";
import type NiconiComments from "@/main";

for (const mode of ["css", "default"] as const)
  test(`CA layer preservation without a second dedupe pass (${mode})`, async ({
    page,
  }) => {
    await page.setContent(
      '<div style="position:relative;width:1280px;height:720px"><canvas id="canvas" width="1920" height="1080" style="width:1280px;height:720px"></canvas></div>',
    );
    await page.addScriptTag({ path: path.resolve("dist/bundle.js") });
    const results = await page.evaluate((mode) => {
      const Engine = (
        window as unknown as { NiconiComments: typeof NiconiComments }
      ).NiconiComments;
      return [true, false].map((dedupeCA) => {
        const rows = Array.from({ length: 4 }, (_, index) => ({
          id: index,
          vpos: 100 + index * 50,
          date: 1700000000 + (index % 2) * 3600,
          owner: index >= 2,
          user_id: index >= 2 ? 2 : 1,
          content: index >= 2 ? "owner" : "same CA",
          mail: index >= 2 ? [] : ["ca"],
          premium: true,
        }));
        const nc = new Engine(
          document.getElementById("canvas") as HTMLCanvasElement,
          rows,
          { format: "formatted", mode, keepCA: true, dedupeCA },
        );
        nc.pauseCSS();
        nc.drawCanvas(200, true);
        const state = nc as unknown as {
          comments: IComment[];
          timeline: Record<number, IComment[]>;
        };
        const result = {
          ids: state.comments.map((c) => c.comment.id),
          layers: state.comments.map((c) => c.layer),
          active: (state.timeline[200] || []).map((c) => c.comment.id).sort(),
          dom: document.querySelectorAll("[data-dm-comment]").length,
        };
        nc.destroy();
        return result;
      });
    }, mode);
    expect(results[0]?.ids).toEqual([0, 2]);
    expect(results[1]?.ids).toEqual([0, 1, 2, 3]);
    expect(results[1]?.layers).toEqual([0, 1, -1, -1]);
    expect(results[1]?.active).toEqual([0, 1, 2, 3]);
    if (mode === "css") expect(results[1]?.dom).toBe(4);
  });
