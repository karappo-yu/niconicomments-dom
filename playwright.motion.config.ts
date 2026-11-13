import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./src/__tests__",
  testMatch: ["scroll-speed.spec.ts", "ca-layer-policy.spec.ts"],
  use: { browserName: "webkit", headless: true },
  reporter: "list",
});
