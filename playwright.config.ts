import { defineConfig, devices } from "@playwright/test";

const port = 3000;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "npm run build:e2e && npm run start:e2e",
    url: baseURL,
    timeout: 180000,
    reuseExistingServer: !process.env.CI
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    },
    {
      name: "firefox-smoke",
      grep: /@smoke/u,
      use: {
        ...devices["Desktop Firefox"]
      }
    },
    {
      name: "webkit-smoke",
      grep: /@smoke/u,
      use: {
        ...devices["Desktop Safari"]
      }
    }
  ]
});

