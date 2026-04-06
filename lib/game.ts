import { getScenarioNode, getScenarioPack } from "@/lib/content";
import { chooseNextNodeId, resolveScenarioNode } from "@/lib/scenario-engine";
import type {
  ApiRoomState,
  AsymmetryBehavior,
  Choice,
  GameEventRecord,
  GamePhase,
  PendingPrivateRoundContext,
  PrivateInputType,
  PrivateOption,
  PrivateSubmissionRecord,
  PublicPlayer,
  ResolutionType,
  ResolvedPublicRoundContext,
  RoundTemplateConfig,
  RoundSocialObject,
  ScenarioNode,
  SocialPromptConfig,
  SocialResolutionType,
  RoomRecord,
  VoteRecord
} from "@/lib/types";

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 3;
export const PRIVATE_INPUT_DURATION_SECONDS = 12;
export const VOTE_DURATION_SECONDS = 15;
export const REVEAL_DURATION_SECONDS = 5;
export const START_MIN_PLAYERS = process.env.NODE_ENV === "production" ? MIN_PLAYERS : 1;

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type ResolvedTemplateContext = ResolvedPublicRoundContext & {
  powerHolderPlayerId: string | null;
  powerHolderLabel: string | null;
};

type SubmissionResolution = {
  privateVoteSnapshot: Record<string, number>;
  privateResolutionType: SocialResolutionType;
  spotlightPlayerId: string | null;
  spotlightLabel: string | null;
  instigatorPlayerIds: string[];
  leadingPrivateOptionId: string | null;
  leadingPrivateOptionLabel: string | null;
  distributionLine: string | null;
};

export type PostGameArtifact = {
  headline: string;
  subhead: string;
  caption: string;
  path: string;
  pathSteps: string[];
  receiptHighlights: string[];
  chaosMoments: number;
  shareMessage: string;
};

export type SocialRecapStat = {
  label: string;
  valueText: string;
};

function hashString(value: string) {
  return Array.from(value).reduce((sum, character) => sum + character.charCodeAt(0), 0);
}

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

function buildDefaultSocialPrompt(): SocialPromptConfig {
  return {
    key: "spotlight_nomination",
    prompt: "Who in this room makes this worse?",
    voteIntro: "The room picked {{spotlight}}. Decide how the group commits.",
    receiptTemplate: "{{count}} players said {{spotlight}} would make this worse."
  };
}

function buildDefaultRoundTemplate(templateId: RoundTemplateConfig["id"] = "scapegoat"): RoundTemplateConfig {
  switch (templateId) {
    case "prediction":
      return {
        id: "prediction",
        privateInputType: "player_target",
        privatePrompt: "Who in this room could actually carry this plan?",
        voteIntro: "The room thinks {{spotlight}} can carry this. Decide how they try.",
        receiptTemplate: "{{count}} players privately said {{spotlight}} could carry this.",
        socialObject: "spotlight",
        asymmetryBehavior: "none",
        betrayalEligible: false
      };
    case "confession":
      return {
        id: "confession",
        privateInputType: "choice_option",
        privatePrompt: "Privately, what would you actually do?",
        voteIntro: "Privately, the room leaned {{option}}. Now decide what the group actually commits to.",
        receiptTemplate: "{{count}} players privately picked {{option}} before the room made it public.",
        distributionIntro: "{{count}} private votes landed on {{option}} before the room had to commit.",
        socialObject: "distribution",
        asymmetryBehavior: "none",
        betrayalEligible: false
      };
    case "secret_agenda":
      return {
        id: "secret_agenda",
        privateInputType: "choice_option",
        privatePrompt: "Choose the hidden agenda you want to push.",
        voteIntro: "Hidden agendas are locked. Decide what the room actually commits to.",
        receiptTemplate: "{{count}} players secretly pushed {{option}} before the public vote landed.",
        distributionIntro: "{{count}} players quietly pushed {{option}} before the room voted in public.",
        socialObject: "hidden_role",
        asymmetryBehavior: "none",
        betrayalEligible: false
      };
    case "betrayal":
      return {
        id: "betrayal",
        privateInputType: "player_target",
        privatePrompt: "Who in this room should be left holding the bag if this turns ugly?",
        voteIntro: "The room picked {{spotlight}}. Decide how hard to sell them out.",
        receiptTemplate: "{{count}} players quietly pushed {{spotlight}} toward the blast radius.",
        socialObject: "hidden_role",
        asymmetryBehavior: "tie_break",
        betrayalEligible: true
      };
    case "scapegoat":
    default:
      return {
        id: "scapegoat",
        privateInputType: "player_target",
        privatePrompt: buildDefaultSocialPrompt().prompt,
        voteIntro: buildDefaultSocialPrompt().voteIntro,
        receiptTemplate: buildDefaultSocialPrompt().receiptTemplate,
        socialObject: "spotlight",
        asymmetryBehavior: "none",
        betrayalEligible: false
      };
  }
}

function interpolateTemplate(
  template: string,
  fields: {
    spotlight?: string | null;
    count?: number;
    option?: string | null;
  }
) {
  return template
    .replaceAll("{{spotlight}}", fields.spotlight ?? "")
    .replaceAll("{{they}}", fields.spotlight ?? "")
    .replaceAll("{{them}}", fields.spotlight ?? "")
    .replaceAll("{{their}}", fields.spotlight ? `${fields.spotlight}'s` : "")
    .replaceAll("{{count}}", String(fields.count ?? 0))
    .replaceAll("{{option}}", fields.option ?? "");
}

export function applySpotlightTemplate(text: string | undefined, spotlightLabel: string | null) {
  if (!text) {
    return text;
  }

  return interpolateTemplate(text, { spotlight: spotlightLabel ?? "someone" });
}

export function applyTemplateFallbacks(
  text: string | undefined,
  fields?: {
    spotlight?: string | null;
    option?: string | null;
  }
) {
  if (!text) {
    return text;
  }

  return interpolateTemplate(text, {
    spotlight: fields?.spotlight ?? "someone",
    option: fields?.option ?? "one move",
    count: 0
  });
}

export function getNodeRoundTemplate(node: Pick<ScenarioNode, "roundTemplate" | "socialPrompt" | "choices">) {
  const templateId = node.roundTemplate?.id ?? "scapegoat";
  const baseTemplate = buildDefaultRoundTemplate(templateId);
  const socialPrompt = node.socialPrompt ? { ...buildDefaultSocialPrompt(), ...node.socialPrompt } : null;
  const template = {
    ...baseTemplate,
    ...node.roundTemplate,
    privatePrompt: node.roundTemplate?.privatePrompt ?? socialPrompt?.prompt ?? baseTemplate.privatePrompt,
    voteIntro: node.roundTemplate?.voteIntro ?? socialPrompt?.voteIntro ?? baseTemplate.voteIntro,
    receiptTemplate: node.roundTemplate?.receiptTemplate ?? socialPrompt?.receiptTemplate ?? baseTemplate.receiptTemplate
  } satisfies RoundTemplateConfig;

  return {
    ...template,
    privateInputType:
      template.privateInputType ??
      (template.id === "confession" || template.id === "secret_agenda" ? "choice_option" : "player_target"),
    socialObject: template.socialObject ?? buildDefaultRoundTemplate(template.id).socialObject ?? "spotlight",
    asymmetryBehavior:
      template.asymmetryBehavior ?? buildDefaultRoundTemplate(template.id).asymmetryBehavior ?? "none",
    betrayalEligible:
      template.betrayalEligible ?? (template.id === "betrayal" || template.asymmetryBehavior === "tie_break")
  };
}

function getPrivateOptions(node: ScenarioNode, template: ReturnType<typeof getNodeRoundTemplate>): PrivateOption[] {
  if (template.privateInputType !== "choice_option") {
    return [];
  }

  return template.privateOptions?.length
    ? template.privateOptions
    : template.confessionOptions?.length
    ? template.confessionOptions
    : node.choices.map((choice) => ({
        id: choice.id,
        label: choice.label
      }));
}

export function applyRoundContextToNode(
  node: ScenarioNode | null,
  roundContext: ResolvedPublicRoundContext | null
): ScenarioNode | null {
  if (!node) {
    return null;
  }

  const optionLabel = roundContext?.leadingPrivateOptionLabel ?? null;

  return {
    ...node,
    prompt:
      interpolateTemplate(node.prompt, {
        spotlight: roundContext?.spotlightLabel ?? null,
        option: optionLabel
      }) ?? node.prompt,
    resultText: node.resultText
      ? interpolateTemplate(node.resultText, {
          spotlight: roundContext?.spotlightLabel ?? null,
          option: optionLabel
        })
      : undefined,
    choices: node.choices.map((choice) => ({
      ...choice,
      label:
        interpolateTemplate(choice.label, {
          spotlight: roundContext?.spotlightLabel ?? null,
          option: optionLabel
        }) ?? choice.label,
      resultText: choice.resultText
        ? interpolateTemplate(choice.resultText, {
            spotlight: roundContext?.spotlightLabel ?? null,
            option: optionLabel
          })
        : undefined
    }))
  };
}

function createSnapshotFromPlayers(players: PublicPlayer[]) {
  return Object.fromEntries(players.map((player) => [player.id, 0])) as Record<string, number>;
}

function createSnapshotFromOptions(options: PrivateOption[]) {
  return Object.fromEntries(options.map((option) => [option.id, 0])) as Record<string, number>;
}

function choosePowerHolder(
  room: RoomRecord,
  node: ScenarioNode,
  players: PublicPlayer[],
  betrayalEligible: boolean
) {
  if (!betrayalEligible) {
    return null;
  }

  const activePlayers = players.filter((player) => player.connected);

  if (!activePlayers.length) {
    return null;
  }

  const index = (room.round + hashString(node.id)) % activePlayers.length;
  return activePlayers[index] ?? null;
}

function resolvePlayerTargetSubmissions(
  room: RoomRecord,
  players: PublicPlayer[],
  privateSubmissions: PrivateSubmissionRecord[]
): SubmissionResolution {
  const activePlayers = players.filter((player) => player.connected);
  const privateVoteSnapshot = createSnapshotFromPlayers(activePlayers);

  for (const submission of privateSubmissions) {
    if (submission.target_player_id) {
      privateVoteSnapshot[submission.target_player_id] =
        (privateVoteSnapshot[submission.target_player_id] ?? 0) + 1;
    }
  }

  if (!activePlayers.length) {
    return {
      privateVoteSnapshot,
      privateResolutionType: "silence",
      spotlightPlayerId: null,
      spotlightLabel: null,
      instigatorPlayerIds: [],
      leadingPrivateOptionId: null,
      leadingPrivateOptionLabel: null,
      distributionLine: null
    };
  }

  const rankedPlayers = activePlayers.map((player, index) => ({
    player,
    index,
    count: privateVoteSnapshot[player.id] ?? 0
  }));
  const bestCount = rankedPlayers.reduce((highest, entry) => Math.max(highest, entry.count), 0);

  if (bestCount === 0) {
    const fallbackIndex = Math.max(0, (room.round - 1) % activePlayers.length);
    const fallbackPlayer = activePlayers[fallbackIndex];

    return {
      privateVoteSnapshot,
      privateResolutionType: "silence",
      spotlightPlayerId: fallbackPlayer.id,
      spotlightLabel: fallbackPlayer.nickname,
      instigatorPlayerIds: [],
      leadingPrivateOptionId: null,
      leadingPrivateOptionLabel: null,
      distributionLine: null
    };
  }

  const tiedPlayers = rankedPlayers
    .filter((entry) => entry.count === bestCount)
    .sort((left, right) => left.index - right.index);
  const chosenPlayer = tiedPlayers[0]?.player ?? activePlayers[0];

  return {
    privateVoteSnapshot,
    privateResolutionType: tiedPlayers.length > 1 ? "split" : "majority",
    spotlightPlayerId: chosenPlayer.id,
    spotlightLabel: chosenPlayer.nickname,
    instigatorPlayerIds: privateSubmissions
      .filter((submission) => submission.target_player_id === chosenPlayer.id)
      .map((submission) => submission.player_id),
    leadingPrivateOptionId: null,
    leadingPrivateOptionLabel: null,
    distributionLine: null
  };
}

function resolveOptionSubmissions(
  options: PrivateOption[],
  privateSubmissions: PrivateSubmissionRecord[]
): SubmissionResolution {
  const privateVoteSnapshot = createSnapshotFromOptions(options);

  for (const submission of privateSubmissions) {
    if (submission.selected_option_id) {
      privateVoteSnapshot[submission.selected_option_id] =
        (privateVoteSnapshot[submission.selected_option_id] ?? 0) + 1;
    }
  }

  const rankedOptions = options.map((option, index) => ({
    option,
    index,
    count: privateVoteSnapshot[option.id] ?? 0
  }));
  const bestCount = rankedOptions.reduce((highest, entry) => Math.max(highest, entry.count), 0);

  if (bestCount === 0) {
    return {
      privateVoteSnapshot,
      privateResolutionType: "silence",
      spotlightPlayerId: null,
      spotlightLabel: null,
      instigatorPlayerIds: [],
      leadingPrivateOptionId: null,
      leadingPrivateOptionLabel: null,
      distributionLine: "Nobody committed privately, so the room goes in cold."
    };
  }

  const tiedOptions = rankedOptions
    .filter((entry) => entry.count === bestCount)
    .sort((left, right) => left.index - right.index);
  const chosenOption = tiedOptions[0]?.option ?? options[0] ?? null;

  return {
    privateVoteSnapshot,
    privateResolutionType: tiedOptions.length > 1 ? "split" : "majority",
    spotlightPlayerId: null,
    spotlightLabel: null,
    instigatorPlayerIds: privateSubmissions
      .filter((submission) => submission.selected_option_id === chosenOption?.id)
      .map((submission) => submission.player_id),
    leadingPrivateOptionId: chosenOption?.id ?? null,
    leadingPrivateOptionLabel: chosenOption?.label ?? null,
    distributionLine: chosenOption
      ? `${bestCount}/${privateSubmissions.length || bestCount} players privately leaned "${chosenOption.label}".`
      : null
  };
}

function buildVoteIntro(
  template: ReturnType<typeof getNodeRoundTemplate>,
  resolution: SubmissionResolution
) {
  if (template.id === "confession") {
    if (resolution.leadingPrivateOptionLabel) {
      return interpolateTemplate(
        template.voteIntro ?? "Privately, the room leaned {{option}}. Now choose what the group actually commits to.",
        { option: resolution.leadingPrivateOptionLabel }
      );
    }

    return "Privately, nobody committed. Now decide what the group actually does.";
  }

  if (template.id === "secret_agenda") {
    if (resolution.leadingPrivateOptionLabel) {
      return interpolateTemplate(
        template.voteIntro ?? "Hidden agendas are locked. Decide whether the room follows {{option}} or rebels against it.",
        { option: resolution.leadingPrivateOptionLabel }
      );
    }

    return "Hidden agendas are locked, but nobody showed a clear lean. Decide what the room actually does.";
  }

  return interpolateTemplate(
    template.voteIntro ?? "The room picked {{spotlight}}. Decide how the group commits.",
    { spotlight: resolution.spotlightLabel }
  );
}

function buildDistributionLine(
  template: ReturnType<typeof getNodeRoundTemplate>,
  resolution: SubmissionResolution
) {
  if (template.id !== "confession" && template.id !== "secret_agenda") {
    return null;
  }

  if (!resolution.leadingPrivateOptionLabel) {
    return resolution.distributionLine;
  }

  return interpolateTemplate(
    template.distributionIntro ??
      (template.id === "secret_agenda"
        ? "{{count}} players secretly pushed {{option}} before the room voted in public."
        : "{{count}} private votes landed on {{option}} before the room had to commit in public."),
    {
      count: resolution.instigatorPlayerIds.length,
      option: resolution.leadingPrivateOptionLabel
    }
  );
}

function buildPromptKey(template: ReturnType<typeof getNodeRoundTemplate>) {
  return template.privateInputType === "choice_option" ? `${template.id}_choice` : `${template.id}_nomination`;
}

export function getPendingRoundContext(
  room: RoomRecord,
  node: ScenarioNode | null
): PendingPrivateRoundContext | null {
  if (!node || room.phase === "lobby" || room.phase === "ended") {
    return null;
  }

  const template = getNodeRoundTemplate(node);

  return {
    templateId: template.id,
    privateInputType: template.privateInputType as PrivateInputType,
    promptKey: buildPromptKey(template),
    privatePrompt: template.privatePrompt ?? buildDefaultRoundTemplate(template.id).privatePrompt ?? "",
    privateOptions: getPrivateOptions(node, template),
    socialObject: template.socialObject as RoundSocialObject,
    asymmetryBehavior: template.asymmetryBehavior as AsymmetryBehavior,
    betrayalActive: Boolean(template.betrayalEligible)
  };
}

function resolveRoundContext(
  room: RoomRecord,
  node: ScenarioNode | null,
  players: PublicPlayer[],
  privateSubmissions: PrivateSubmissionRecord[]
): ResolvedTemplateContext | null {
  if (!node || room.phase === "lobby" || room.phase === "ended") {
    return null;
  }

  const template = getNodeRoundTemplate(node);
  const privateOptions = getPrivateOptions(node, template);
  const submissionResolution =
    template.privateInputType === "choice_option"
      ? resolveOptionSubmissions(privateOptions, privateSubmissions)
      : resolvePlayerTargetSubmissions(room, players, privateSubmissions);
  const powerHolder = choosePowerHolder(room, node, players, Boolean(template.betrayalEligible));

  return {
    templateId: template.id,
    privateInputType: template.privateInputType as PrivateInputType,
    voteIntro: buildVoteIntro(template, submissionResolution),
    spotlightPlayerId: submissionResolution.spotlightPlayerId,
    spotlightLabel: submissionResolution.spotlightLabel,
    privateVoteSnapshot: submissionResolution.privateVoteSnapshot,
    instigatorPlayerIds: submissionResolution.instigatorPlayerIds,
    privateResolutionType: submissionResolution.privateResolutionType,
    privateOptions,
    leadingPrivateOptionId: submissionResolution.leadingPrivateOptionId,
    leadingPrivateOptionLabel: submissionResolution.leadingPrivateOptionLabel,
    distributionLine: buildDistributionLine(template, submissionResolution),
    socialObject: template.socialObject as RoundSocialObject,
    asymmetryBehavior: template.asymmetryBehavior as AsymmetryBehavior,
    betrayalActive: Boolean(template.betrayalEligible),
    powerHolderPlayerId: powerHolder?.id ?? null,
    powerHolderLabel: powerHolder?.nickname ?? null
  };
}

export function getResolvedRoundContext(
  room: RoomRecord,
  node: ScenarioNode | null,
  players: PublicPlayer[],
  privateSubmissions: PrivateSubmissionRecord[]
): ResolvedPublicRoundContext | null {
  const resolved = resolveRoundContext(room, node, players, privateSubmissions);

  if (!resolved) {
    return null;
  }

  return {
    templateId: resolved.templateId,
    privateInputType: resolved.privateInputType,
    voteIntro: resolved.voteIntro,
    spotlightPlayerId: resolved.spotlightPlayerId,
    spotlightLabel: resolved.spotlightLabel,
    privateVoteSnapshot: resolved.privateVoteSnapshot,
    instigatorPlayerIds: resolved.instigatorPlayerIds,
    privateResolutionType: resolved.privateResolutionType,
    privateOptions: resolved.privateOptions,
    leadingPrivateOptionId: resolved.leadingPrivateOptionId,
    leadingPrivateOptionLabel: resolved.leadingPrivateOptionLabel,
    distributionLine: resolved.distributionLine,
    socialObject: resolved.socialObject,
    asymmetryBehavior: resolved.asymmetryBehavior,
    betrayalActive: resolved.betrayalActive
  };
}

export function getPromptKeyForNode(node: ScenarioNode | null) {
  if (!node) {
    return null;
  }

  return buildPromptKey(getNodeRoundTemplate(node));
}

export function canResolvePrivateInputPhase(
  room: RoomRecord,
  players: PublicPlayer[],
  privateSubmissions: PrivateSubmissionRecord[]
) {
  if (room.phase !== "private_input" || room.status !== "active") {
    return false;
  }

  if (!room.phase_deadline) {
    return true;
  }

  const activePlayers = players.filter((player) => player.connected);

  return (
    privateSubmissions.length >= activePlayers.length ||
    new Date(room.phase_deadline).getTime() <= Date.now()
  );
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

export function tallyVotes(
  choices: Choice[],
  votes: VoteRecord[],
  powerHolderPlayerId: string | null = null
) {
  const voteSnapshot = Object.fromEntries(choices.map((choice) => [choice.id, 0])) as Record<string, number>;

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

  let powerAlteredOutcome = false;
  let winningChoice: Choice;

  if (resolutionType === "indecision_tie" && powerHolderPlayerId) {
    const holderVote = votes.find(
      (vote) =>
        vote.player_id === powerHolderPlayerId &&
        tiedChoices.some((choice) => choice.id === vote.selected_choice_id)
    );

    if (holderVote) {
      winningChoice = tiedChoices.find((choice) => choice.id === holderVote.selected_choice_id) ?? tiedChoices[0];
      powerAlteredOutcome = true;
    } else {
      winningChoice = tiedChoices[Math.floor(Math.random() * tiedChoices.length)];
    }
  } else {
    const candidateChoices = totalVotes === 0 ? choices : tiedChoices;
    winningChoice = candidateChoices[Math.floor(Math.random() * candidateChoices.length)];
  }

  return {
    winningChoice,
    voteSnapshot,
    resolutionType,
    powerAlteredOutcome
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

function buildReceiptLine(
  template: ReturnType<typeof getNodeRoundTemplate>,
  roundContext: ResolvedTemplateContext,
  instigatorCount: number
) {
  if (template.id === "confession" || template.id === "secret_agenda") {
    if (roundContext.leadingPrivateOptionLabel) {
      return interpolateTemplate(
        template.receiptTemplate ??
          (template.id === "secret_agenda"
            ? "{{count}} players secretly pushed {{option}} before the public vote landed."
            : "{{count}} players privately picked {{option}} before the public vote flipped the room into action."),
        {
          count: instigatorCount,
          option: roundContext.leadingPrivateOptionLabel
        }
      );
    }

    return template.id === "secret_agenda"
      ? "Nobody showed a clear hidden agenda, so the room had to improvise its betrayal in public."
      : "Nobody showed their hand privately, so the room had to perform certainty from scratch.";
  }

  if (template.id === "betrayal" && roundContext.powerHolderLabel) {
    return roundContext.powerHolderPlayerId && roundContext.powerHolderPlayerId !== roundContext.spotlightPlayerId
      ? `${roundContext.powerHolderLabel} held the betrayal card while ${roundContext.spotlightLabel} took the visible heat.`
      : `${roundContext.powerHolderLabel} held the betrayal card while the room made ${roundContext.spotlightLabel} own the fallout.`;
  }

  if (roundContext.privateResolutionType === "silence") {
    return `Nobody named anyone, so chaos shoved ${roundContext.spotlightLabel} into the spotlight.`;
  }

  if (roundContext.privateResolutionType === "split") {
    return `The room split on the read, but ${roundContext.spotlightLabel} still took the heat with ${instigatorCount} nominations.`;
  }

  return interpolateTemplate(
    template.receiptTemplate ?? "{{count}} players said {{spotlight}} would make this worse.",
    {
      spotlight: roundContext.spotlightLabel,
      count: instigatorCount
    }
  );
}

export function buildEventRecord(
  room: RoomRecord,
  players: PublicPlayer[],
  privateSubmissions: PrivateSubmissionRecord[],
  votes: VoteRecord[],
  events: GameEventRecord[] = []
) {
  const pack = getScenarioPack(room.scenario_pack);
  const node = resolveScenarioNode(pack, room.current_node_id, events);

  if (!node) {
    throw new Error("Missing current node while building game event.");
  }

  const template = getNodeRoundTemplate(node);
  const roundContext = resolveRoundContext(room, node, players, privateSubmissions);
  const {
    winningChoice,
    voteSnapshot,
    resolutionType,
    powerAlteredOutcome
  } = tallyVotes(node.choices, votes, roundContext?.powerHolderPlayerId ?? null);
  const nextNodeId = chooseNextNodeId(pack, room.round, node.id, winningChoice.id, resolutionType, events);
  const spotlightLabel = roundContext?.spotlightLabel ?? null;
  const optionLabel = roundContext?.leadingPrivateOptionLabel ?? null;
  const consequenceBase = getResolutionLead(resolutionType, winningChoice);
  const consequenceLine =
    template.id === "confession" || template.id === "secret_agenda"
      ? `${consequenceBase} The room had privately leaned "${optionLabel ?? "something else"}" before committing in public.`
      : template.id === "betrayal"
        ? `${consequenceBase} ${spotlightLabel ?? "Someone"} takes the blame while someone else quietly held the knife.`
        : `${consequenceBase} ${spotlightLabel ?? "Someone"} now owns the fallout.`;
  const resultText =
    interpolateTemplate(
      winningChoice.resultText ?? node.resultText ?? `Everyone commits to "${winningChoice.label}" and pays for it immediately.`,
      {
        spotlight: spotlightLabel,
        option: optionLabel
      }
    ) ?? winningChoice.resultText ?? node.resultText ?? `Everyone commits to "${winningChoice.label}" and pays for it immediately.`;

  return {
    round: room.round,
    node,
    winningChoice,
    voteSnapshot,
    resolutionType,
    nextNodeId,
    resolutionLabel: getResolutionLabel(resolutionType),
    resolutionLead: consequenceBase,
    resultText,
    templateId: template.id,
    spotlightPlayerId: roundContext?.spotlightPlayerId ?? null,
    spotlightLabel,
    privateVoteSnapshot: roundContext?.privateVoteSnapshot ?? {},
    instigatorPlayerIds: roundContext?.instigatorPlayerIds ?? [],
    privateResolutionType: roundContext?.privateResolutionType ?? "silence",
    leadingPrivateOptionId: roundContext?.leadingPrivateOptionId ?? null,
    leadingPrivateOptionLabel: optionLabel,
    distributionLine: roundContext?.distributionLine ?? null,
    powerHolderPlayerId: roundContext?.powerHolderPlayerId ?? null,
    powerHolderLabel: roundContext?.powerHolderLabel ?? null,
    powerAlteredOutcome,
    consequenceLine,
    receiptLine: buildReceiptLine(
      template,
      roundContext ?? {
        templateId: template.id,
        privateInputType: template.privateInputType as PrivateInputType,
        voteIntro: template.voteIntro ?? "",
        spotlightPlayerId: null,
        spotlightLabel: null,
        privateVoteSnapshot: {},
        instigatorPlayerIds: [],
        privateResolutionType: "silence",
        privateOptions: [],
        leadingPrivateOptionId: null,
        leadingPrivateOptionLabel: null,
        distributionLine: null,
        socialObject: template.socialObject as RoundSocialObject,
        asymmetryBehavior: template.asymmetryBehavior as AsymmetryBehavior,
        betrayalActive: Boolean(template.betrayalEligible),
        powerHolderPlayerId: null,
        powerHolderLabel: null
      },
      roundContext?.instigatorPlayerIds.length ?? 0
    )
  };
}

export function createGameEventInsert(
  room: RoomRecord,
  players: PublicPlayer[],
  privateSubmissions: PrivateSubmissionRecord[],
  votes: VoteRecord[],
  events: GameEventRecord[] = []
) {
  const event = buildEventRecord(room, players, privateSubmissions, votes, events);

  return {
    room_id: room.id,
    round: event.round,
    node_id: event.node.id,
    prompt: interpolateTemplate(event.node.prompt, {
      spotlight: event.spotlightLabel,
      option: event.leadingPrivateOptionLabel
    }),
    selected_choice_id: event.winningChoice.id,
    selected_choice_label: interpolateTemplate(event.winningChoice.label, {
      spotlight: event.spotlightLabel,
      option: event.leadingPrivateOptionLabel
    }),
    next_node_id: event.nextNodeId,
    result_text: event.resultText,
    resolution_type: event.resolutionType,
    resolution_label: event.resolutionLabel,
    vote_snapshot: event.voteSnapshot,
    template_id: event.templateId,
    spotlight_player_id: event.spotlightPlayerId,
    spotlight_label: event.spotlightLabel,
    private_vote_snapshot: event.privateVoteSnapshot,
    instigator_player_ids: event.instigatorPlayerIds,
    private_resolution_type: event.privateResolutionType,
    leading_private_option_id: event.leadingPrivateOptionId,
    leading_private_option_label: event.leadingPrivateOptionLabel,
    distribution_line: event.distributionLine,
    power_holder_player_id: event.powerHolderPlayerId,
    power_holder_label: event.powerHolderLabel,
    power_altered_outcome: event.powerAlteredOutcome,
    consequence_line: event.consequenceLine,
    receipt_line: event.receiptLine
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
    phase: "private_input" as GamePhase,
    currentNodeId: nextNode.id,
    pendingNodeId: null,
    round: room.round + 1,
    phaseDeadline: getPhaseDeadline(PRIVATE_INPUT_DURATION_SECONDS)
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
  const socialRecap = buildSocialRecapStats(state);
  const caption = socialRecap[0]?.valueText ?? buildChaosLine(chaosMoments);
  const subhead = `${state.pack.title} | ${players} players | ${rounds} decisions`;
  const shareMessage = `We just imploded our way through "${state.pack.title}" in Bad Choices. ${headline}`;

  return {
    headline,
    subhead,
    caption,
    path,
    pathSteps: pathSegments,
    receiptHighlights: socialRecap.slice(0, 3).map((stat) => `${stat.label}: ${stat.valueText}`),
    chaosMoments,
    shareMessage
  };
}

export function buildSocialRecapStats(state: ApiRoomState): SocialRecapStat[] {
  const blameCounts = new Map<string, number>();
  const instigatorCounts = new Map<string, number>();
  const spotlightCounts = new Map<string, number>();
  const trustCounts = new Map<string, number>();
  const sacrificeCounts = new Map<string, number>();
  const misreadCounts = new Map<string, number>();
  const powerRounds = new Map<string, number>();
  let strongestConfession:
    | {
        label: string;
        count: number;
      }
    | null = null;
  let biggestMismatch:
    | {
        round: number;
        privateLabel: string;
        publicLabel: string;
        weight: number;
      }
    | null = null;

  for (const event of state.events) {
    if (event.spotlight_player_id) {
      spotlightCounts.set(event.spotlight_player_id, (spotlightCounts.get(event.spotlight_player_id) ?? 0) + 1);
    }

    if (event.template_id === "prediction" && event.spotlight_player_id) {
      trustCounts.set(event.spotlight_player_id, (trustCounts.get(event.spotlight_player_id) ?? 0) + 1);
    }

    if (event.template_id === "scapegoat" && event.spotlight_player_id) {
      sacrificeCounts.set(event.spotlight_player_id, (sacrificeCounts.get(event.spotlight_player_id) ?? 0) + 1);
    }

    if (event.template_id === "betrayal" && event.spotlight_player_id) {
      sacrificeCounts.set(event.spotlight_player_id, (sacrificeCounts.get(event.spotlight_player_id) ?? 0) + 1);
    }

    if (
      event.template_id === "prediction" &&
      event.spotlight_player_id &&
      (event.private_resolution_type !== "majority" || event.resolution_type !== "majority")
    ) {
      misreadCounts.set(event.spotlight_player_id, (misreadCounts.get(event.spotlight_player_id) ?? 0) + 1);
    }

    for (const [key, count] of Object.entries(event.private_vote_snapshot ?? {})) {
      if (state.players.some((player) => player.id === key)) {
        blameCounts.set(key, (blameCounts.get(key) ?? 0) + Number(count));
      }
    }

    for (const playerId of event.instigator_player_ids ?? []) {
      instigatorCounts.set(playerId, (instigatorCounts.get(playerId) ?? 0) + 1);
    }

    if (event.power_holder_player_id && event.power_altered_outcome) {
      powerRounds.set(event.power_holder_player_id, (powerRounds.get(event.power_holder_player_id) ?? 0) + 1);
    }

    if (
      (event.template_id === "confession" || event.template_id === "secret_agenda") &&
      event.leading_private_option_label
    ) {
      const leanCount = Number(
        (event.leading_private_option_id && event.private_vote_snapshot?.[event.leading_private_option_id]) ?? 0
      );

      if (!strongestConfession || leanCount > strongestConfession.count) {
        strongestConfession = {
          label: `Round ${event.round} leaned ${event.leading_private_option_label}`,
          count: leanCount
        };
      }
    }

    if (
      (event.template_id === "confession" || event.template_id === "secret_agenda") &&
      event.leading_private_option_label &&
      event.leading_private_option_id &&
      event.leading_private_option_id !== event.selected_choice_id
    ) {
      const mismatchWeight = Number(event.private_vote_snapshot?.[event.leading_private_option_id] ?? 0);

      if (!biggestMismatch || mismatchWeight > biggestMismatch.weight) {
        biggestMismatch = {
          round: event.round,
          privateLabel: event.leading_private_option_label,
          publicLabel: event.selected_choice_label,
          weight: mismatchWeight
        };
      }
    }
  }

  const players = state.players;

  function topPlayer(map: Map<string, number>, label: string): SocialRecapStat {
    const ranked = players
      .map((player) => ({
        playerName: player.nickname,
        value: map.get(player.id) ?? 0
      }))
      .sort(
        (left, right) => right.value - left.value || left.playerName.localeCompare(right.playerName)
      );
    const winner = ranked[0] ?? { playerName: "Nobody", value: 0 };

    return {
      label,
      valueText: winner.value > 0 ? `${winner.playerName} · ${winner.value}` : "Nobody · 0"
    };
  }

  const stats: SocialRecapStat[] = [
    topPlayer(blameCounts, "Most blamed player"),
    topPlayer(instigatorCounts, "Biggest chaos instigator"),
    topPlayer(trustCounts, "Most trusted player"),
    topPlayer(spotlightCounts, "Most spotlighted player"),
    topPlayer(sacrificeCounts, "Most often sacrificed"),
    topPlayer(misreadCounts, "Most misread player"),
    topPlayer(powerRounds, "Hidden power rounds")
  ];

  if (strongestConfession) {
    stats.push({
      label: "Strongest confession lean",
      valueText: `${strongestConfession.label} · ${strongestConfession.count} private votes`
    });
  }

  if (biggestMismatch) {
    stats.push({
      label: "Biggest public/private mismatch",
      valueText: `Round ${biggestMismatch.round} · leaned ${biggestMismatch.privateLabel}, did ${biggestMismatch.publicLabel}`
    });
  }

  return stats;
}
