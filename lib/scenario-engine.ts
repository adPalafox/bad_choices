import type {
  Choice,
  GameEventRecord,
  ModifierGate,
  ResolutionType,
  ScenarioNode,
  ScenarioPack,
  TextVariant
} from "@/lib/types";

type RunState = {
  activeModifiers: Set<string>;
  visitedNodeIds: Set<string>;
  chaosMoments: number;
};

function getRawNode(pack: ScenarioPack, nodeId: string | null) {
  if (!nodeId) {
    return null;
  }

  return pack.nodes.find((node) => node.id === nodeId) ?? null;
}

function passesGate(gate: ModifierGate | undefined, runState: RunState) {
  if (!gate) {
    return true;
  }

  if (gate.requiredModifiers?.some((modifierId) => !runState.activeModifiers.has(modifierId))) {
    return false;
  }

  if (gate.blockedModifiers?.some((modifierId) => runState.activeModifiers.has(modifierId))) {
    return false;
  }

  if (gate.requiredVisitedNodeIds?.some((nodeId) => !runState.visitedNodeIds.has(nodeId))) {
    return false;
  }

  if (gate.blockedVisitedNodeIds?.some((nodeId) => runState.visitedNodeIds.has(nodeId))) {
    return false;
  }

  if (typeof gate.minChaosMoments === "number" && runState.chaosMoments < gate.minChaosMoments) {
    return false;
  }

  if (typeof gate.maxChaosMoments === "number" && runState.chaosMoments > gate.maxChaosMoments) {
    return false;
  }

  return true;
}

function applyTextVariants(baseText: string, variants: TextVariant[] | undefined, runState: RunState) {
  const matchedVariant = variants?.find((variant) => passesGate(variant.gate, runState));
  return matchedVariant?.text ?? baseText;
}

function chooseDetourNodeId(
  roomRound: number,
  chance: number | undefined,
  nodeIds: string[] | undefined
) {
  if (!nodeIds?.length) {
    return null;
  }

  if (typeof chance === "number" && Math.random() > chance) {
    return null;
  }

  const index = (roomRound + nodeIds.length) % nodeIds.length;
  return nodeIds[index];
}

export function buildRunState(pack: ScenarioPack, events: GameEventRecord[]): RunState {
  const runState: RunState = {
    activeModifiers: new Set<string>(),
    visitedNodeIds: new Set<string>(),
    chaosMoments: 0
  };

  for (const event of events) {
    const node = getRawNode(pack, event.node_id);
    const choice = node?.choices.find((entry) => entry.id === event.selected_choice_id);

    if (event.resolution_type !== "majority") {
      runState.chaosMoments += 1;
    }

    runState.visitedNodeIds.add(event.node_id);
    runState.visitedNodeIds.add(event.next_node_id);

    for (const effect of choice?.effects ?? []) {
      if (effect.type === "add_modifier") {
        runState.activeModifiers.add(effect.modifierId);
      }

      if (effect.type === "remove_modifier") {
        runState.activeModifiers.delete(effect.modifierId);
      }
    }
  }

  return runState;
}

function resolveChoice(choice: Choice, runState: RunState): Choice | null {
  if (!passesGate(choice.gate, runState)) {
    return null;
  }

  return {
    ...choice,
    label: applyTextVariants(choice.label, choice.labelVariants, runState)
  };
}

export function resolveScenarioNode(
  pack: ScenarioPack,
  nodeId: string | null,
  events: GameEventRecord[]
): ScenarioNode | null {
  const rawNode = getRawNode(pack, nodeId);

  if (!rawNode) {
    return null;
  }

  const runState = buildRunState(pack, events);

  if (!passesGate(rawNode.gate, runState)) {
    return null;
  }

  return {
    ...rawNode,
    prompt: applyTextVariants(rawNode.prompt, rawNode.promptVariants, runState),
    choices: rawNode.choices
      .map((choice) => resolveChoice(choice, runState))
      .filter((choice): choice is Choice => Boolean(choice))
  };
}

export function chooseNextNodeId(
  pack: ScenarioPack,
  roomRound: number,
  currentNodeId: string,
  winningChoiceId: string,
  resolutionType: ResolutionType,
  events: GameEventRecord[]
) {
  const currentNode = getRawNode(pack, currentNodeId);

  if (!currentNode) {
    throw new Error("Missing current node while calculating next node.");
  }

  const runState = buildRunState(pack, events);
  const rawWinningChoice = currentNode.choices.find((choice) => choice.id === winningChoiceId);

  if (!rawWinningChoice) {
    throw new Error("Winning choice does not exist on the current node.");
  }

  const winningChoice = resolveChoice(rawWinningChoice, runState);

  if (!winningChoice) {
    throw new Error("Winning choice became unavailable.");
  }

  if (resolutionType !== "majority") {
    const interventionNodeId = chooseDetourNodeId(
      roomRound,
      1,
      currentNode.audienceInterventionNodeIds
    );

    if (interventionNodeId) {
      return interventionNodeId;
    }
  }

  const specialEventNodeId = chooseDetourNodeId(
    roomRound,
    currentNode.specialEventChance,
    winningChoice.specialEventNodeIds
  );

  if (specialEventNodeId) {
    return specialEventNodeId;
  }

  const wildcardNodeId = chooseDetourNodeId(
    roomRound,
    currentNode.wildcardChance,
    winningChoice.wildcardNodeIds
  );

  if (wildcardNodeId) {
    return wildcardNodeId;
  }

  return winningChoice.nextNodeId;
}

function collectReferenceNodeIds(pack: ScenarioPack) {
  const referenceNodeIds = new Set<string>([pack.startNodeId]);

  for (const node of pack.nodes) {
    for (const choice of node.choices) {
      referenceNodeIds.add(choice.nextNodeId);

      for (const nodeId of choice.wildcardNodeIds ?? []) {
        referenceNodeIds.add(nodeId);
      }

      for (const nodeId of choice.specialEventNodeIds ?? []) {
        referenceNodeIds.add(nodeId);
      }
    }

    for (const nodeId of node.audienceInterventionNodeIds ?? []) {
      referenceNodeIds.add(nodeId);
    }
  }

  return referenceNodeIds;
}

function getMinimumEndingDepth(pack: ScenarioPack, nodeId: string, depth = 0, seen = new Set<string>()): number {
  const node = getRawNode(pack, nodeId);

  if (!node || seen.has(nodeId)) {
    return Number.POSITIVE_INFINITY;
  }

  if (node.ending) {
    return depth;
  }

  const nextSeen = new Set(seen);
  nextSeen.add(nodeId);

  const candidateDepths = [
    ...node.choices.flatMap((choice) => [choice.nextNodeId, ...(choice.wildcardNodeIds ?? []), ...(choice.specialEventNodeIds ?? [])]),
    ...(node.audienceInterventionNodeIds ?? [])
  ].map((nextNodeId) => getMinimumEndingDepth(pack, nextNodeId, depth + 1, nextSeen));

  return candidateDepths.length ? Math.min(...candidateDepths) : Number.POSITIVE_INFINITY;
}

export function validateScenarioPack(pack: ScenarioPack) {
  const nodeIds = new Set<string>();
  const endingCount = pack.nodes.filter((node) => node.ending).length;

  for (const node of pack.nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`Pack "${pack.packId}" has a duplicate node id: ${node.id}`);
    }

    nodeIds.add(node.id);

    if (node.ending && node.choices.length > 0) {
      throw new Error(`Ending node "${node.id}" in pack "${pack.packId}" cannot define choices.`);
    }

    if (!node.ending && node.choices.length === 0) {
      throw new Error(`Non-ending node "${node.id}" in pack "${pack.packId}" must define choices.`);
    }

    const choiceIds = new Set<string>();

    for (const choice of node.choices) {
      if (choiceIds.has(choice.id)) {
        throw new Error(`Node "${node.id}" in pack "${pack.packId}" has a duplicate choice id: ${choice.id}`);
      }

      choiceIds.add(choice.id);
    }
  }

  for (const nodeId of collectReferenceNodeIds(pack)) {
    if (!nodeIds.has(nodeId)) {
      throw new Error(`Pack "${pack.packId}" references a missing node id: ${nodeId}`);
    }
  }

  if (pack.nodes.length < 18) {
    throw new Error(`Pack "${pack.packId}" needs at least 18 nodes for replayable depth.`);
  }

  if (endingCount < 5) {
    throw new Error(`Pack "${pack.packId}" needs at least 5 endings.`);
  }

  const minimumEndingDepth = getMinimumEndingDepth(pack, pack.startNodeId);

  if (!Number.isFinite(minimumEndingDepth) || minimumEndingDepth < 4) {
    throw new Error(`Pack "${pack.packId}" reaches an ending too quickly. Minimum ending depth must be at least 4.`);
  }
}
