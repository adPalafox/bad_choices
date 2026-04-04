import { randomUUID } from "node:crypto";

import { getScenarioNode, getScenarioPack } from "@/lib/content";
import type {
  Choice,
  GameEventRecord,
  GamePhase,
  PublicPlayer,
  RoomRecord,
  VoteRecord
} from "@/lib/types";

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 3;
export const VOTE_DURATION_SECONDS = 15;
export const REVEAL_DURATION_SECONDS = 5;

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createSessionId() {
  return randomUUID();
}

export function createRoomCode() {
  return Array.from({ length: 4 }, () => {
    const index = Math.floor(Math.random() * ROOM_ALPHABET.length);
    return ROOM_ALPHABET[index];
  }).join("");
}

export function getPhaseDeadline(secondsFromNow: number) {
  return new Date(Date.now() + secondsFromNow * 1000).toISOString();
}

export function canResolveVotingPhase(room: RoomRecord, players: PublicPlayer[], votes: VoteRecord[]) {
  if (room.phase !== "voting" || room.status !== "active") {
    return false;
  }

  if (!room.phase_deadline) {
    return true;
  }

  const activePlayers = players.filter((player) => player.connected);

  return (
    votes.length >= activePlayers.length ||
    new Date(room.phase_deadline).getTime() <= Date.now()
  );
}

export function canAdvanceRevealPhase(room: RoomRecord) {
  return room.phase === "reveal" && room.phase_deadline
    ? new Date(room.phase_deadline).getTime() <= Date.now()
    : false;
}

export function tallyVotes(choices: Choice[], votes: VoteRecord[]) {
  const voteSnapshot = Object.fromEntries(choices.map((choice) => [choice.id, 0]));

  for (const vote of votes) {
    voteSnapshot[vote.selected_choice_id] = (voteSnapshot[vote.selected_choice_id] ?? 0) + 1;
  }

  let winningChoice = choices[0];
  let bestCount = voteSnapshot[winningChoice.id] ?? 0;

  for (const choice of choices) {
    const count = voteSnapshot[choice.id] ?? 0;

    if (count > bestCount) {
      winningChoice = choice;
      bestCount = count;
    }
  }

  return {
    winningChoice,
    voteSnapshot
  };
}

export function buildEventRecord(room: RoomRecord, votes: VoteRecord[]) {
  const node = getScenarioNode(room.scenario_pack, room.current_node_id);

  if (!node) {
    throw new Error("Missing current node while building game event.");
  }

  const { winningChoice, voteSnapshot } = tallyVotes(node.choices, votes);

  return {
    round: room.round,
    node,
    winningChoice,
    voteSnapshot,
    resultText: node.resultText ?? `Everyone commits to "${winningChoice.label}" and pays for it immediately.`
  };
}

export function createGameEventInsert(room: RoomRecord, votes: VoteRecord[]) {
  const event = buildEventRecord(room, votes);

  return {
    room_id: room.id,
    round: room.round,
    node_id: event.node.id,
    prompt: event.node.prompt,
    selected_choice_id: event.winningChoice.id,
    selected_choice_label: event.winningChoice.label,
    next_node_id: event.winningChoice.nextNodeId,
    result_text: event.resultText,
    vote_snapshot: event.voteSnapshot
  };
}

export function getNextPhaseAfterReveal(room: RoomRecord, lastEvent: GameEventRecord) {
  const nextNode = getScenarioNode(room.scenario_pack, lastEvent.next_node_id);

  if (!nextNode) {
    throw new Error("Resolved node points to a missing next node.");
  }

  if (nextNode.ending) {
    return {
      status: "ended" as const,
      phase: "ended" as GamePhase,
      currentNodeId: nextNode.id,
      pendingNodeId: null,
      round: room.round,
      phaseDeadline: null
    };
  }

  return {
    status: "active" as const,
    phase: "voting" as GamePhase,
    currentNodeId: nextNode.id,
    pendingNodeId: null,
    round: room.round + 1,
    phaseDeadline: getPhaseDeadline(VOTE_DURATION_SECONDS)
  };
}

export function getPackSummary(packId: string) {
  const pack = getScenarioPack(packId);

  return {
    packId: pack.packId,
    title: pack.title,
    theme: pack.theme,
    startNodeId: pack.startNodeId,
    nodeCount: pack.nodes.length
  };
}
