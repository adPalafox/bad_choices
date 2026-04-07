import { expect, test } from "./fixtures";
import { createRoom, expectRoster, getRoomState, joinRoomFromInvite, joinRoomFromLanding, startRound } from "./support/room";

test("reconnect restores the saved seat and disconnected players stop counting toward start", async ({ host, playerA, playerB }) => {
  const roomCode = await createRoom(host, "Chaotic Friends");

  await joinRoomFromLanding(playerA, roomCode);
  await joinRoomFromInvite(playerB, roomCode);
  await expect(host.page.getByTestId("start-round-button")).toBeEnabled();

  await playerB.page.close();

  await expect
    .poll(async () => (await getRoomState(host.page, roomCode)).players.length)
    .toBe(2);
  await expect(host.page.getByTestId("start-round-button")).toBeDisabled();

  playerB.page = await playerB.context.newPage();
  await playerB.page.goto(`/room/${roomCode}`);
  await expect(playerB.page.getByText("Restoring your seat in the room")).toBeVisible();

  await expect
    .poll(async () => (await getRoomState(host.page, roomCode)).players.length)
    .toBe(3);
  await expect(host.page.getByTestId("start-round-button")).toBeEnabled();
  await expectRoster(host.page, [host.name, playerA.name, playerB.name]);
});

test("late joins are blocked once the round is already underway", async ({ host, playerA, playerB }) => {
  const roomCode = await createRoom(host, "Chaotic Friends");

  await joinRoomFromLanding(playerA, roomCode);
  await joinRoomFromInvite(playerB, roomCode);
  await startRound(host, roomCode);

  const lateContext = await host.context.browser()?.newContext();

  if (!lateContext) {
    throw new Error("Missing browser context for late join test.");
  }

  const latePage = await lateContext.newPage();
  await latePage.goto(`/room/${roomCode}`);

  await expect(latePage.getByText("This round is already underway. New players can jump in on the next rematch.")).toBeVisible();
  await lateContext.close();
});
