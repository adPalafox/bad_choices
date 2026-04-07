import { expect, test } from "./fixtures";
import {
  advanceReveal,
  createRoom,
  expectRoster,
  getRecordedShareCalls,
  getRoomState,
  joinRoomFromInvite,
  joinRoomFromLanding,
  playRound,
  startRound,
  waitForPhase
} from "./support/room";

test("smoke lobby create, join, and start gating @smoke", async ({ host, playerA, playerB }) => {
  const roomCode = await createRoom(host, "Chaotic Friends");

  await expect(host.page.getByTestId("start-round-button")).toBeDisabled();
  await joinRoomFromLanding(playerA, roomCode);
  await expectRoster(host.page, [host.name, playerA.name]);
  await expect(host.page.getByTestId("start-round-button")).toBeDisabled();

  await joinRoomFromInvite(playerB, roomCode);
  await expectRoster(host.page, [host.name, playerA.name, playerB.name]);
  await expect(host.page.getByTestId("start-round-button")).toBeEnabled();
});

test("smoke full game reaches artifact, share, and rematch @smoke", async ({ host, playerA, playerB }) => {
  const players = [host, playerA, playerB];
  const roomCode = await createRoom(host, "Cursed Team-Building");

  await joinRoomFromLanding(playerA, roomCode);
  await joinRoomFromInvite(playerB, roomCode);
  await startRound(host, roomCode);

  await playRound(roomCode, players, {
    privateSelections: [playerA.name, playerA.name, playerA.name],
    publicVoteIndices: [2, 2, 2]
  });
  await advanceReveal(host.page, roomCode);

  await playRound(roomCode, players, {
    privateSelections: [playerA.name, playerA.name, playerA.name],
    publicVoteIndices: [1, 1, 1]
  });
  await advanceReveal(host.page, roomCode);

  await playRound(roomCode, players, {
    privateSelections: [0, 0, 0],
    publicVoteIndices: [0, 0, 0]
  });
  await advanceReveal(host.page, roomCode);

  await playRound(roomCode, players, {
    privateSelections: [playerB.name, playerB.name, playerB.name],
    publicVoteIndices: [0, 0, 0]
  });

  await advanceReveal(host.page, roomCode);
  await waitForPhase(host.page, roomCode, "ended");

  await expect(host.page.getByTestId("artifact-card")).toBeVisible();
  await host.page.getByTestId("share-artifact-button").click();

  await expect
    .poll(async () => (await getRecordedShareCalls(host.page)).length)
    .toBe(1);

  const shareCalls = await getRecordedShareCalls(host.page);
  const firstShare = shareCalls[0] as { title?: string; files?: unknown[]; url?: string };

  expect(firstShare.title).toContain("Cursed Team-Building");
  expect(firstShare.url).toContain("http://127.0.0.1:3000");
  expect(firstShare.files?.length).toBe(1);

  await host.page.getByTestId("rematch-pack-button").click();
  await waitForPhase(host.page, roomCode, "lobby");

  const lobbyState = await getRoomState(host.page, roomCode);
  expect(lobbyState.room.code).toBe(roomCode);
  await expect(host.page.getByTestId("room-code-value")).toHaveText(roomCode);
  await expect(host.page.getByTestId("start-round-button")).toBeEnabled();
});

