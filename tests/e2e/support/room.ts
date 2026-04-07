import { expect, type Page } from "@playwright/test";

import { expireCurrentPhase } from "./admin";
import type { TestPlayer } from "../fixtures";

type RoomState = {
  room: {
    code: string;
    phase: "lobby" | "private_input" | "voting" | "reveal" | "ended";
    round: number;
  };
  players: Array<{
    id: string;
    nickname: string;
    is_host: boolean;
  }>;
  currentNode: {
    id: string;
    choices: Array<{
      id: string;
      label: string;
    }>;
  } | null;
  pendingRoundContext: {
    templateId: string;
    privateInputType: "player_target" | "choice_option";
    privateOptions: Array<{
      id: string;
      label: string;
    }>;
  } | null;
  resolvedRoundContext: {
    templateId: string;
    spotlightLabel: string | null;
    distributionLine: string | null;
  } | null;
  lastEvent: {
    selected_choice_id: string;
    resolution_type: string;
    resolution_label: string;
    power_holder_player_id: string | null;
    power_altered_outcome: boolean;
  } | null;
};

type RoundInput = {
  privateSelections: Array<string | number | null>;
  publicVoteIndices: Array<number | null>;
};

const PACK_IDS: Record<string, string> = {
  "Chaotic Friends": "chaotic-friends",
  "Date Night Disaster": "date-night-disaster",
  "Cursed Team-Building": "cursed-team-building"
};

export async function getRoomState(page: Page, code: string): Promise<RoomState> {
  const response = await page.request.get(`/api/rooms/${code}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

export async function waitForPhase(page: Page, code: string, phase: RoomState["room"]["phase"]) {
  await expect
    .poll(async () => (await getRoomState(page, code)).room.phase, {
      message: `Expected room ${code} to reach ${phase}`
    })
    .toBe(phase);

  return getRoomState(page, code);
}

export async function waitForCurrentNode(page: Page, code: string, nodeId: string) {
  await expect
    .poll(async () => (await getRoomState(page, code)).currentNode?.id ?? null, {
      message: `Expected room ${code} to reach node ${nodeId}`
    })
    .toBe(nodeId);

  return getRoomState(page, code);
}

export async function createRoom(host: TestPlayer, packTitle: string) {
  await host.page.goto("/");
  const createForm = host.page.getByTestId("create-room-form");

  await expect(createForm).toBeVisible();
  await createForm.getByTestId("host-name-input").fill(host.name);
  const packId = PACK_IDS[packTitle];

  if (!packId) {
    throw new Error(`Unknown pack title: ${packTitle}`);
  }

  await createForm.getByTestId("pack-select").selectOption(packId);
  await createForm.getByTestId("create-room-submit").click();
  await host.page.waitForURL(/\/room\/[A-Z0-9]{4}$/u);

  const roomCode = host.page.url().split("/").at(-1)?.toUpperCase();

  if (!roomCode) {
    throw new Error("Failed to capture room code from URL.");
  }

  await expect(host.page.getByTestId("room-code-value")).toHaveText(roomCode);
  return roomCode;
}

export async function joinRoomFromLanding(player: TestPlayer, roomCode: string) {
  await player.page.goto("/");
  await player.page.getByTestId("join-code-input").fill(roomCode);
  await player.page.getByTestId("join-name-input").fill(player.name);
  await player.page.getByTestId("join-room-submit").click();
  await player.page.waitForURL(new RegExp(`/room/${roomCode}$`, "u"));
}

export async function joinRoomFromInvite(player: TestPlayer, roomCode: string) {
  await player.page.goto(`/room/${roomCode}`);
  await player.page.getByTestId("inline-join-name-input").fill(player.name);
  await player.page.getByTestId("inline-join-room-submit").click();
  await player.page.waitForURL(new RegExp(`/room/${roomCode}$`, "u"));
}

export async function expectRoster(page: Page, names: string[]) {
  const list = page.getByTestId("player-list");

  await expect(list).toBeVisible();

  for (const name of names) {
    await expect(list).toContainText(name);
  }
}

export async function startRound(host: TestPlayer, roomCode: string) {
  await expect(host.page.getByTestId("start-round-button")).toBeEnabled();
  await host.page.getByTestId("start-round-button").click();
  return waitForPhase(host.page, roomCode, "private_input");
}

export async function resolveExpiredPhase(page: Page, roomCode: string) {
  await expireCurrentPhase(roomCode);

  const response = await page.request.post(`/api/rooms/${roomCode}/resolve`);
  expect(response.ok()).toBeTruthy();
}

export async function advanceReveal(page: Page, roomCode: string) {
  await waitForPhase(page, roomCode, "reveal");
  await resolveExpiredPhase(page, roomCode);

  await expect
    .poll(async () => {
      const state = await getRoomState(page, roomCode);
      return state.room.phase;
    })
    .not.toBe("reveal");

  return getRoomState(page, roomCode);
}

export async function playRound(roomCode: string, players: TestPlayer[], roundInput: RoundInput) {
  const privateState = await waitForPhase(players[0].page, roomCode, "private_input");

  for (const [index, selection] of roundInput.privateSelections.entries()) {
    if (selection === null) {
      continue;
    }

    await selectPrivateChoice(players[index], privateState, selection);
  }

  if (roundInput.privateSelections.some((selection) => selection === null)) {
    await resolveExpiredPhase(players[0].page, roomCode);
  }

  const votingState = await waitForPhase(players[0].page, roomCode, "voting");

  for (const [index, selection] of roundInput.publicVoteIndices.entries()) {
    if (selection === null) {
      continue;
    }

    await players[index].page
      .getByTestId("public-choice-list")
      .getByRole("button")
      .nth(selection)
      .click();
  }

  if (roundInput.publicVoteIndices.some((selection) => selection === null)) {
    await resolveExpiredPhase(players[0].page, roomCode);
  }

  await waitForPhase(players[0].page, roomCode, "reveal");
  await expect(players[0].page.getByTestId("reveal-summary")).toBeVisible();
  return votingState;
}

export async function getRecordedShareCalls(page: Page) {
  return page.evaluate(() => (window as Window & { __badChoicesShareCalls?: unknown[] }).__badChoicesShareCalls ?? []);
}

async function selectPrivateChoice(player: TestPlayer, state: RoomState, selection: string | number) {
  const choiceList = player.page.getByTestId("private-choice-list");

  if (state.pendingRoundContext?.privateInputType === "player_target") {
    if (typeof selection !== "string") {
      throw new Error("Player-target private rounds require nickname-based selections.");
    }

    await choiceList.getByRole("button", { name: selection, exact: true }).click();
    return;
  }

  if (typeof selection === "number") {
    await choiceList.getByRole("button").nth(selection).click();
    return;
  }

  await choiceList.getByRole("button", { name: selection, exact: true }).click();
}
