import { expect, test } from "./fixtures";
import { advanceReveal, createRoom, joinRoomFromInvite, joinRoomFromLanding, playRound, startRound, waitForCurrentNode } from "./support/room";

test("scapegoat template uses player-target private nominations", async ({ host, playerA, playerB }) => {
  const roomCode = await createRoom(host, "Chaotic Friends");

  await joinRoomFromLanding(playerA, roomCode);
  await joinRoomFromInvite(playerB, roomCode);
  const state = await startRound(host, roomCode);

  expect(state.pendingRoundContext?.templateId).toBe("scapegoat");
  expect(state.pendingRoundContext?.privateInputType).toBe("player_target");
  await expect(host.page.getByTestId("private-choice-list").getByRole("button")).toHaveCount(3);
});

test("prediction template reveals a predicted player before the public vote", async ({ host, playerA, playerB }) => {
  const players = [host, playerA, playerB];
  const roomCode = await createRoom(host, "Chaotic Friends");

  await joinRoomFromLanding(playerA, roomCode);
  await joinRoomFromInvite(playerB, roomCode);
  await startRound(host, roomCode);

  await playRound(roomCode, players, {
    privateSelections: [playerA.name, playerA.name, playerA.name],
    publicVoteIndices: [1, 1, 1]
  });
  await advanceReveal(host.page, roomCode);

  const predictionState = await waitForCurrentNode(host.page, roomCode, "friends_3");
  expect(predictionState.pendingRoundContext?.templateId).toBe("prediction");

  await playRound(roomCode, players, {
    privateSelections: [playerB.name, playerB.name, playerB.name],
    publicVoteIndices: [0, 0, 0]
  });

  await expect(host.page.getByText("Predicted player")).toBeVisible();
});

test("confession template keeps private reads option-based", async ({ host, playerA, playerB }) => {
  const players = [host, playerA, playerB];
  const roomCode = await createRoom(host, "Chaotic Friends");

  await joinRoomFromLanding(playerA, roomCode);
  await joinRoomFromInvite(playerB, roomCode);
  await startRound(host, roomCode);

  await playRound(roomCode, players, {
    privateSelections: [playerA.name, playerA.name, playerA.name],
    publicVoteIndices: [1, 1, 1]
  });
  await advanceReveal(host.page, roomCode);

  await playRound(roomCode, players, {
    privateSelections: [playerB.name, playerB.name, playerB.name],
    publicVoteIndices: [0, 0, 0]
  });
  await advanceReveal(host.page, roomCode);

  await playRound(roomCode, players, {
    privateSelections: [playerA.name, playerA.name, playerA.name],
    publicVoteIndices: [1, 1, 1]
  });
  await advanceReveal(host.page, roomCode);

  const confessionState = await waitForCurrentNode(host.page, roomCode, "friends_14");
  expect(confessionState.pendingRoundContext?.templateId).toBe("confession");
  expect(confessionState.pendingRoundContext?.privateInputType).toBe("choice_option");

  const votingState = await playRound(roomCode, players, {
    privateSelections: [0, 1, 1],
    publicVoteIndices: [0, 0, 0]
  });

  expect(votingState.resolvedRoundContext?.distributionLine).toBeTruthy();
  await expect(host.page.getByText("Private read")).toBeVisible();
});

test("secret agenda template exposes the hidden-agenda private phase", async ({ host, playerA, playerB }) => {
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

  const agendaState = await waitForCurrentNode(host.page, roomCode, "team_10");
  expect(agendaState.pendingRoundContext?.templateId).toBe("secret_agenda");
  expect(agendaState.pendingRoundContext?.privateInputType).toBe("choice_option");
  await expect(host.page.getByText("Lock a hidden agenda in private.")).toBeVisible();
});

test("betrayal template shows a public scapegoat and hidden leverage copy", async ({ host, playerA, playerB }) => {
  const players = [host, playerA, playerB];
  const roomCode = await createRoom(host, "Date Night Disaster");

  await joinRoomFromLanding(playerA, roomCode);
  await joinRoomFromInvite(playerB, roomCode);
  await startRound(host, roomCode);

  await playRound(roomCode, players, {
    privateSelections: [playerA.name, playerA.name, playerA.name],
    publicVoteIndices: [0, 0, 0]
  });
  await advanceReveal(host.page, roomCode);

  await playRound(roomCode, players, {
    privateSelections: [playerA.name, playerA.name, playerA.name],
    publicVoteIndices: [1, 1, 1]
  });
  await advanceReveal(host.page, roomCode);

  await playRound(roomCode, players, {
    privateSelections: [playerA.name, playerA.name, playerA.name],
    publicVoteIndices: [0, 0, 0]
  });
  await advanceReveal(host.page, roomCode);

  const betrayalState = await waitForCurrentNode(host.page, roomCode, "date_11");
  expect(betrayalState.pendingRoundContext?.templateId).toBe("betrayal");

  await playRound(roomCode, players, {
    privateSelections: [playerB.name, playerB.name, playerB.name],
    publicVoteIndices: [0, 0, 0]
  });

  await expect(host.page.getByText("Public scapegoat")).toBeVisible();
  await expect(host.page.getByText("Hidden power")).toBeVisible();
});
