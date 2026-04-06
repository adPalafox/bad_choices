import { getScenarioNode, getScenarioPack } from "@/lib/content";
import { chooseNextNodeId, resolveScenarioNode } from "@/lib/scenario-engine";
import type {
  ApiRoomState,
  Choice,
  GameEventRecord,
  GamePhase,
  PublicPlayer,
  ResolutionType,
  RoomRecord,
  VoteRecord
} from "@/lib/types";

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 3;
export const VOTE_DURATION_SECONDS = 15;
export const REVEAL_DURATION_SECONDS = 5;
export const START_MIN_PLAYERS = process.env.NODE_ENV === "production" ? MIN_PLAYERS : 1;

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createSessionId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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

  const rankedChoices = choices.map((choice) => ({
    choice,
    count: voteSnapshot[choice.id] ?? 0
  }));
  const bestCount = rankedChoices.reduce((highest, entry) => Math.max(highest, entry.count), 0);
  const tiedChoices = rankedChoices
    .filter((entry) => entry.count === bestCount)
    .map((entry) => entry.choice);
  const totalVotes = votes.length;
  const resolutionType: ResolutionType =
    totalVotes === 0 ? "indecision_no_vote" : tiedChoices.length > 1 ? "indecision_tie" : "majority";
  const candidateChoices = totalVotes === 0 ? choices : tiedChoices;
  const winningChoice = candidateChoices[Math.floor(Math.random() * candidateChoices.length)];

  return {
    winningChoice,
    voteSnapshot,
    resolutionType
  };
}

function getResolutionLabel(resolutionType: ResolutionType) {
  switch (resolutionType) {
    case "indecision_tie":
      return "Indecision event";
    case "indecision_no_vote":
      return "Silence event";
    case "majority":
    default:
      return "Majority decided";
  }
}

function getResolutionLead(resolutionType: ResolutionType, winningChoice: Choice) {
  switch (resolutionType) {
    case "indecision_tie":
      return `The room split itself in half, so chaos cut in and slammed everyone into "${winningChoice.label}".`;
    case "indecision_no_vote":
      return `Nobody committed, so the room triggered a special event and got shoved into "${winningChoice.label}".`;
    case "majority":
    default:
      return `The room chose "${winningChoice.label}".`;
  }
}

export function buildEventRecord(room: RoomRecord, votes: VoteRecord[], events: GameEventRecord[] = []) {
  const pack = getScenarioPack(room.scenario_pack);
  const node = resolveScenarioNode(pack, room.current_node_id, events);

  if (!node) {
    throw new Error("Missing current node while building game event.");
  }

  const { winningChoice, voteSnapshot, resolutionType } = tallyVotes(node.choices, votes);
  const nextNodeId = chooseNextNodeId(pack, room.round, node.id, winningChoice.id, resolutionType, events);

  return {
    round: room.round,
    node,
    winningChoice,
    voteSnapshot,
    resolutionType,
    nextNodeId,
    resolutionLabel: getResolutionLabel(resolutionType),
    resolutionLead: getResolutionLead(resolutionType, winningChoice),
    resultText:
      winningChoice.resultText ??
      node.resultText ??
      `Everyone commits to "${winningChoice.label}" and pays for it immediately.`
  };
}

export function createGameEventInsert(room: RoomRecord, votes: VoteRecord[], events: GameEventRecord[] = []) {
  const event = buildEventRecord(room, votes, events);

  return {
    room_id: room.id,
    round: room.round,
    node_id: event.node.id,
    prompt: event.node.prompt,
    selected_choice_id: event.winningChoice.id,
    selected_choice_label: event.winningChoice.label,
    next_node_id: event.nextNodeId,
    result_text: event.resultText,
    resolution_type: event.resolutionType,
    resolution_label: event.resolutionLabel,
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

export type PostGameArtifact = {
  headline: string;
  subhead: string;
  caption: string;
  path: string;
  pathSteps: string[];
  chaosMoments: number;
  shareMessage: string;
};

function buildChaosLine(chaosMoments: number) {
  if (chaosMoments === 0) {
    return "Shockingly, the room made every call without a chaos intervention.";
  }

  if (chaosMoments === 1) {
    return "Chaos had to step in once because the room couldn't hold itself together.";
  }

  return `Chaos had to intervene ${chaosMoments} times because the room kept fumbling the assignment.`;
}

export function buildPostGameArtifact(state: ApiRoomState): PostGameArtifact {
  const rounds = state.events.length;
  const players = state.players.length;
  const pathSegments = state.events.map((event) => event.selected_choice_label);
  const path = pathSegments.join(" -> ");
  const chaosMoments = state.events.filter((event) => event.resolution_type !== "majority").length;
  const headline = state.currentNode?.prompt ?? "The room survived, technically.";
  const caption = buildChaosLine(chaosMoments);
  const subhead = `${state.pack.title} | ${players} players | ${rounds} decisions`;
  const shareMessage = `We just imploded our way through "${state.pack.title}" in Bad Choices. ${headline}`;

  return {
    headline,
    subhead,
    caption,
    path,
    pathSteps: pathSegments,
    chaosMoments,
    shareMessage
  };
}
