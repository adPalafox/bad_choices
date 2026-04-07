import { expect, test, type TestPlayer } from "./fixtures";
import { advanceReveal, createRoom, joinRoomFromInvite, joinRoomFromLanding, playRound, startRound } from "./support/room";

async function reachEndingForPack(
  packTitle: string,
  roundInputs: Array<{ privateSelections: Array<string | number | null>; publicVoteIndices: Array<number | null> }>,
  host: TestPlayer,
  playerA: TestPlayer,
  playerB: TestPlayer
) {
  const players = [host, playerA, playerB];
  const roomCode = await createRoom(host, packTitle);

  await joinRoomFromLanding(playerA, roomCode);
  await joinRoomFromInvite(playerB, roomCode);
  await startRound(host, roomCode);

  for (const [index, roundInput] of roundInputs.entries()) {
    await playRound(roomCode, players, roundInput);
    const nextState = await advanceReveal(host.page, roomCode);

    if (index === roundInputs.length - 1) {
      expect(nextState.room.phase).toBe("ended");
    }
  }

  await expect(host.page.getByTestId("artifact-card")).toBeVisible();
}

test("chaotic friends reaches an ending through its canonical path", async ({ host, playerA, playerB }) => {
  await reachEndingForPack(
    "Chaotic Friends",
    [
      {
        privateSelections: [playerA.name, playerA.name, playerA.name],
        publicVoteIndices: [1, 1, 1]
      },
      {
        privateSelections: [playerB.name, playerB.name, playerB.name],
        publicVoteIndices: [0, 0, 0]
      },
      {
        privateSelections: [playerA.name, playerA.name, playerA.name],
        publicVoteIndices: [1, 1, 1]
      },
      {
        privateSelections: [0, 1, 1],
        publicVoteIndices: [0, 0, 0]
      }
    ],
    host,
    playerA,
    playerB
  );
});

test("date night disaster reaches an ending through its canonical path", async ({ host, playerA, playerB }) => {
  await reachEndingForPack(
    "Date Night Disaster",
    [
      {
        privateSelections: [playerA.name, playerA.name, playerA.name],
        publicVoteIndices: [0, 0, 0]
      },
      {
        privateSelections: [playerA.name, playerA.name, playerA.name],
        publicVoteIndices: [1, 1, 1]
      },
      {
        privateSelections: [playerA.name, playerA.name, playerA.name],
        publicVoteIndices: [0, 0, 0]
      },
      {
        privateSelections: [playerB.name, playerB.name, playerB.name],
        publicVoteIndices: [0, 0, 0]
      }
    ],
    host,
    playerA,
    playerB
  );
});

test("cursed team-building reaches an ending through its canonical path", async ({ host, playerA, playerB }) => {
  await reachEndingForPack(
    "Cursed Team-Building",
    [
      {
        privateSelections: [playerA.name, playerA.name, playerA.name],
        publicVoteIndices: [2, 2, 2]
      },
      {
        privateSelections: [playerA.name, playerA.name, playerA.name],
        publicVoteIndices: [1, 1, 1]
      },
      {
        privateSelections: [0, 0, 0],
        publicVoteIndices: [0, 0, 0]
      },
      {
        privateSelections: [playerB.name, playerB.name, playerB.name],
        publicVoteIndices: [0, 0, 0]
      }
    ],
    host,
    playerA,
    playerB
  );
});
