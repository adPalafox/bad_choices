import assert from "node:assert/strict";
import test from "node:test";

import { canStartRoomWithConnectedPlayers, didPlayerSelectPrivateOption, hasLobbyCapacity, hydrateSavedNickname } from "../lib/regression-helpers.ts";
import { tallyVotes } from "../lib/vote-resolution.ts";
import type { Choice, PrivateSubmissionRecord, VoteRecord } from "../lib/types.ts";

const choices: Choice[] = [
  { id: "a", label: "Option A", nextNodeId: "node-a" },
  { id: "b", label: "Option B", nextNodeId: "node-b" },
  { id: "c", label: "Option C", nextNodeId: "node-c" }
];

function createVote(playerId: string, selectedChoiceId: string): VoteRecord {
  return {
    id: `${playerId}-${selectedChoiceId}`,
    room_id: "room-1",
    player_id: playerId,
    round: 1,
    node_id: "node-1",
    selected_choice_id: selectedChoiceId,
    created_at: "2026-04-07T00:00:00.000Z"
  };
}

function createPrivateSubmission(selectedOptionId: string | null): PrivateSubmissionRecord {
  return {
    id: `submission-${selectedOptionId ?? "none"}`,
    room_id: "room-1",
    player_id: "player-1",
    round: 1,
    node_id: "node-1",
    prompt_key: "prompt",
    target_player_id: null,
    selected_option_id: selectedOptionId,
    created_at: "2026-04-07T00:00:00.000Z"
  };
}

test("tallyVotes keeps majority behavior unchanged", () => {
  const result = tallyVotes(choices, [createVote("p1", "a"), createVote("p2", "a"), createVote("p3", "b")]);

  assert.equal(result.resolutionType, "majority");
  assert.equal(result.winningChoice.id, "a");
  assert.deepEqual(result.voteSnapshot, { a: 2, b: 1, c: 0 });
});

test("tallyVotes resolves ties by stable choice order", () => {
  const result = tallyVotes(choices, [createVote("p1", "a"), createVote("p2", "b")]);

  assert.equal(result.resolutionType, "indecision_tie");
  assert.equal(result.winningChoice.id, "a");
  assert.equal(result.powerAlteredOutcome, false);
});

test("tallyVotes resolves no-vote rounds by stable choice order", () => {
  const result = tallyVotes(choices, []);

  assert.equal(result.resolutionType, "indecision_no_vote");
  assert.equal(result.winningChoice.id, "a");
});

test("tallyVotes still lets the power holder break eligible ties", () => {
  const result = tallyVotes(choices, [createVote("p1", "a"), createVote("p2", "b")], "p2");

  assert.equal(result.resolutionType, "indecision_tie");
  assert.equal(result.winningChoice.id, "b");
  assert.equal(result.powerAlteredOutcome, true);
});

test("start gating only counts connected players", () => {
  const players = [{ connected: true }, { connected: true }, { connected: false }];

  assert.equal(canStartRoomWithConnectedPlayers(players, 3), false);
  assert.equal(canStartRoomWithConnectedPlayers(players, 2), true);
});

test("lobby capacity ignores disconnected stale seats", () => {
  const playersWithSpace = [
    { connected: true },
    { connected: true },
    { connected: true },
    { connected: true },
    { connected: true },
    { connected: true },
    { connected: true },
    { connected: false },
    { connected: false }
  ];
  const fullLiveLobby = Array.from({ length: 8 }, () => ({ connected: true }));

  assert.equal(hasLobbyCapacity(playersWithSpace, 8), true);
  assert.equal(hasLobbyCapacity(fullLiveLobby, 8), false);
});

test("private option selection only marks the chosen option", () => {
  const submissions = [createPrivateSubmission("b")];

  assert.equal(didPlayerSelectPrivateOption(submissions, "player-1", "a"), false);
  assert.equal(didPlayerSelectPrivateOption(submissions, "player-1", "b"), true);
});

test("saved nickname hydration fills empty drafts without overwriting typed input", () => {
  assert.equal(hydrateSavedNickname("", "  Moral Liability  "), "Moral Liability");
  assert.equal(hydrateSavedNickname("Existing Draft", "Moral Liability"), "Existing Draft");
});
