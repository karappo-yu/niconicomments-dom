import { expect, test } from "@playwright/test";

for (const operation of ["clear", "destroy", "speed", "motion", "reverse"]) {
  test(`CSS renderer detaches exposed native animations on ${operation}`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.addScriptTag({ url: "/dist/bundle.js" });

    const result = await page.evaluate(async (action) => {
      const global = window as typeof window & {
        NiconiComments: typeof import("@/main").default;
      };
      const canvas = document.createElement("canvas");
      canvas.width = 1920;
      canvas.height = 1080;
      document.body.appendChild(canvas);
      const nc = new global.NiconiComments(
        canvas,
        [
          {
            id: 1,
            vpos: 0,
            content: "scrolling comment",
            date: 1_700_000_000,
            date_usec: 0,
            owner: false,
            premium: false,
            mail: ["naka"],
            user_id: 1,
            layer: -1,
            is_my_post: false,
          },
        ],
        { format: "formatted", mode: "css" },
      );
      const internals = nc as unknown as {
        cssRenderer: import("@/renderer/css").CSSRenderer;
        comments: import("@/@types").IComment[];
      };
      const original = Element.prototype.getAnimations;
      const exposed: Animation[] = [];
      Element.prototype.getAnimations = function (options) {
        const animations = original.call(this, options);
        if (this.hasAttribute("data-dm-comment")) exposed.push(...animations);
        return animations;
      };
      try {
        nc.drawCanvas(0, true);
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        const state = {
          banActive: false,
          reverseActiveOwner: false,
          reverseActiveViewer: false,
        };
        // Exercise the renderer's own off-window lifetime check while the
        // browser animation is running. Its wrapper is the WebKit 318856
        // trigger; no test-side getAnimations() call creates extra wrappers.
        internals.cssRenderer.updateComments([], 1, state);
        const element =
          document.querySelector<HTMLElement>("[data-dm-comment]");
        const previousName = element?.style.animationName;
        const before = exposed.map((animation) => ({
          state: animation.playState,
          hasTimeline: animation.timeline !== null,
        }));
        if (action === "clear") nc.clear();
        else if (action === "destroy") nc.destroy();
        else if (action === "speed") nc.setPlaybackSpeed(2);
        else if (action === "motion") {
          nc.setScrollSpeed(0.5);
          nc.drawCanvas(1, true);
        } else {
          internals.cssRenderer.updateComments(internals.comments, 2, {
            ...state,
            reverseActiveViewer: true,
          });
        }
        return {
          before,
          after: exposed.map((animation) => ({
            state: animation.playState,
            hasTimeline: animation.timeline !== null,
          })),
          sameElement: document.querySelector("[data-dm-comment]") === element,
          replacedName: element?.style.animationName !== previousName,
          oldCommentReleased: !(
            element as HTMLElement & { __dmComment?: unknown }
          )?.__dmComment,
        };
      } finally {
        Element.prototype.getAnimations = original;
        nc.destroy();
        canvas.remove();
      }
    }, operation);

    expect(result.before).toEqual([{ state: "running", hasTimeline: true }]);
    expect(result.after).toEqual([{ state: "idle", hasTimeline: false }]);
    if (operation === "clear" || operation === "destroy") {
      expect(result.sameElement).toBe(false);
      expect(result.oldCommentReleased).toBe(true);
    } else {
      expect(result.sameElement).toBe(true);
      expect(result.replacedName).toBe(true);
    }
  });
}
