import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8135";
const port = new URL(baseURL).port || "8135";
export default defineConfig({
  testDir: "./src/__tests__",
  testMatch: [
    "scroll-speed.spec.ts",
    "ca-layer-policy.spec.ts",
    "css-surface.spec.ts",
    "css-animation-retirement.spec.ts",
    "sticky-css-motion.spec.ts",
  ],
  use: { browserName: "webkit", headless: true, baseURL },
  reporter: "list",
  webServer: {
    command: `node node_modules/http-server/bin/http-server -p ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
