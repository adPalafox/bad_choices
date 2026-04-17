import { expect, test } from "./fixtures";
import { advanceReveal, createRoom, getRoomState, joinRoomFromInvite, joinRoomFromLanding, playRound, readStoredRoomSession, startRound, waitForCurrentNode, waitForPhase } from "./support/room";
import { expireCurrentPhase, getRoomSnapshot } from "./support/admin";

test("majority resolution keeps the majority-picked choice", async ({ host, playerA, playerB }) => {
  const players = [host, playerA, playerB];
  const roomCode = await createRoom(host, "Chaotic Friends");

  await joinRoomFromLanding(playerA, roomCode);
  await joinRoomFromInvite(playerB, roomCode);
  const startedState = await startRound(host, roomCode);
  const winningChoiceId = startedState.currentNode?.choices[0]?.id;

  await playRound(roomCode, players, {
    privateSelections: [playerA.name, playerA.name, playerA.name],
    publicVoteIndices: [0, 0, 1]
  });

  const revealState = await getRoomState(host.page, roomCode);
  expect(revealState.lastEvent?.resolution_type).toBe("majority");
  expect(revealState.lastEvent?.selected_choice_id).toBe(winningChoiceId);
});

test("ties fall back to stable choice order", async ({ host, playerA, playerB }) => {
  const players = [host, playerA, playerB];
  const roomCode = await createRoom(host, "Chaotic Friends");

  await joinRoomFromLanding(playerA, roomCode);
  await joinRoomFromInvite(playerB, roomCode);
  const startedState = await startRound(host, roomCode);
  const fallbackChoiceId = startedState.currentNode?.choices[0]?.id;

  await playRound(roomCode, players, {
    privateSelections: [playerA.name, playerA.name, playerA.name],
    publicVoteIndices: [0, 1, 2]
  });

  const revealState = await getRoomState(host.page, roomCode);
  expect(revealState.lastEvent?.resolution_type).toBe("indecision_tie");
  expect(revealState.lastEvent?.selected_choice_id).toBe(fallbackChoiceId);
});

test("no-vote rounds route into audience intervention nodes", async ({ host, playerA, playerB }) => {
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
  await waitForCurrentNode(host.page, roomCode, "team_4");

  const privateState = await waitForPhase(host.page, roomCode, "private_input");
  expect(privateState.currentNode?.id).toBe("team_4");

  await playRound(roomCode, players, {
    privateSelections: [playerA.name, playerA.name, playerA.name],
    publicVoteIndices: [null, null, null]
  });

  const revealState = await getRoomState(host.page, roomCode);
  expect(revealState.lastEvent?.resolution_type).toBe("indecision_no_vote");

  await advanceReveal(host.page, roomCode);
  const nextState = await waitForPhase(host.page, roomCode, "private_input");
  expect(nextState.currentNode?.id).toBe("team_15");
});

test("betrayal ties let the power holder break the outcome", async ({ host, playerA, playerB }) => {
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

  const betrayalState = await waitForCurrentNode(host.page, roomCode, "team_11");
  const secondChoiceId = betrayalState.currentNode?.choices[1]?.id;

  await waitForPhase(host.page, roomCode, "private_input");
  await playRound(roomCode, players, {
    privateSelections: [playerB.name, playerB.name, playerB.name],
    publicVoteIndices: [0, null, 1]
  });

  const revealState = await getRoomState(host.page, roomCode);
  const snapshot = await getRoomSnapshot(roomCode);
  const playerBravo = snapshot.players.find((player) => player.nickname === playerB.name);

  expect(revealState.lastEvent?.resolution_type).toBe("indecision_tie");
  expect(revealState.lastEvent?.power_altered_outcome).toBe(true);
  expect(revealState.lastEvent?.selected_choice_id).toBe(secondChoiceId);
  expect(revealState.lastEvent?.power_holder_player_id).toBe(playerBravo?.id ?? null);
});

test("reveal waits for the host to advance even after the hold timer expires", async ({ host, playerA, playerB }) => {
  const players = [host, playerA, playerB];
  const roomCode = await createRoom(host, "Chaotic Friends");

  await joinRoomFromLanding(playerA, roomCode);
  await joinRoomFromInvite(playerB, roomCode);
  const startedState = await startRound(host, roomCode);
  const firstNodeId = startedState.currentNode?.id;

  await playRound(roomCode, players, {
    privateSelections: [playerA.name, playerA.name, playerA.name],
    publicVoteIndices: [0, 0, 1]
  });

  await expect(host.page.getByTestId("reveal-summary")).toBeVisible();
  await expect(host.page.getByTestId("reveal-headline")).toContainText(`The room picked ${playerA.name}.`);
  await expect(host.page.getByTestId("reveal-micro-prompt")).toBeVisible();
  await expect(host.page.getByTestId("advance-reveal-button")).toBeDisabled();
  await expect(playerA.page.getByText("Waiting for the host to move on")).toBeVisible();

  await expireCurrentPhase(roomCode);

  await expect
    .poll(async () => (await getRoomState(host.page, roomCode)).room.phase, {
      message: `Expected room ${roomCode} to remain in reveal until the host advances`
    })
    .toBe("reveal");

  await expect(host.page.getByTestId("advance-reveal-button")).toBeEnabled();

  await host.page.getByTestId("advance-reveal-button").click();

  await expect(host.page.getByTestId("reveal-summary")).toBeHidden();
  await expect(host.page.getByTestId("private-choice-list")).toBeVisible();

  const nextState = await getRoomState(host.page, roomCode);
  expect(nextState.currentNode?.id).not.toBe(firstNodeId);
});

test("non-host advance attempts are rejected", async ({ host, playerA, playerB }) => {
  const players = [host, playerA, playerB];
  const roomCode = await createRoom(host, "Chaotic Friends");

  await joinRoomFromLanding(playerA, roomCode);
  await joinRoomFromInvite(playerB, roomCode);
  await startRound(host, roomCode);

  await playRound(roomCode, players, {
    privateSelections: [playerA.name, playerA.name, playerA.name],
    publicVoteIndices: [0, 0, 1]
  });

  await expireCurrentPhase(roomCode);
  const playerSession = await readStoredRoomSession(playerA.page, roomCode);
  const response = await playerA.page.request.post(`/api/rooms/${roomCode}/advance`, {
    data: {
      sessionId: playerSession.sessionId
    }
  });

  expect(response.ok()).toBeFalsy();
  await expect
    .poll(async () => (await getRoomState(host.page, roomCode)).room.phase)
    .toBe("reveal");
});
