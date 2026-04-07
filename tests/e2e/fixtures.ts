import { test as base, type BrowserContext, type Page } from "@playwright/test";

import { resetDatabase } from "./support/admin";

export type TestPlayer = {
  name: string;
  context: BrowserContext;
  page: Page;
};

async function createPlayer(context: BrowserContext, name: string) {
  await context.addInitScript(() => {
    const shareCalls: unknown[] = [];
    (window as Window & { __badChoicesShareCalls?: unknown[] }).__badChoicesShareCalls = shareCalls;

    const assignNavigatorMethod = (methodName: "canShare" | "share", value: unknown) => {
      try {
        Object.defineProperty(navigator, methodName, {
          configurable: true,
          writable: true,
          value
        });
      } catch {
        // Ignore browsers that keep these properties locked down.
      }
    };

    assignNavigatorMethod("canShare", () => true);
    assignNavigatorMethod("share", async (payload: unknown) => {
      shareCalls.push(payload);
    });
  });

  const page = await context.newPage();
  return { name, context, page };
}

export const test = base.extend<{
  host: TestPlayer;
  playerA: TestPlayer;
  playerB: TestPlayer;
  _databaseReset: void;
}>({
  _databaseReset: [
    async ({}, runFixture) => {
      await resetDatabase();
      await runFixture();
      await resetDatabase();
    },
    { auto: true }
  ],
  host: async ({ browser }, runFixture) => {
    const context = await browser.newContext();
    const host = await createPlayer(context, "Host Hazard");
    await runFixture(host);
    await context.close();
  },
  playerA: async ({ browser }, runFixture) => {
    const context = await browser.newContext();
    const player = await createPlayer(context, "Player Alpha");
    await runFixture(player);
    await context.close();
  },
  playerB: async ({ browser }, runFixture) => {
    const context = await browser.newContext();
    const player = await createPlayer(context, "Player Bravo");
    await runFixture(player);
    await context.close();
  }
});

export { expect } from "@playwright/test";
