import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packsDir = path.join(__dirname, "..", "content", "packs");

const TEMPLATE_IDS = new Set(["scapegoat", "prediction", "confession"]);
const PRIVATE_INPUT_TYPES = new Set(["player_target", "choice_option"]);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readPacks() {
  return fs
    .readdirSync(packsDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => JSON.parse(fs.readFileSync(path.join(packsDir, fileName), "utf8")));
}

function collectReferenceNodeIds(pack) {
  const referenceNodeIds = new Set([pack.startNodeId]);

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

function getRawNode(pack, nodeId) {
  return pack.nodes.find((node) => node.id === nodeId) ?? null;
}

function getMinimumEndingDepth(pack, nodeId, depth = 0, seen = new Set()) {
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
    ...node.choices.flatMap((choice) => [
      choice.nextNodeId,
      ...(choice.wildcardNodeIds ?? []),
      ...(choice.specialEventNodeIds ?? [])
    ]),
    ...(node.audienceInterventionNodeIds ?? [])
  ].map((nextNodeId) => getMinimumEndingDepth(pack, nextNodeId, depth + 1, nextSeen));

  return candidateDepths.length ? Math.min(...candidateDepths) : Number.POSITIVE_INFINITY;
}

function validateStringField(value, label) {
  if (value !== undefined) {
    assert(typeof value === "string", `${label} must be a string.`);
  }
}

function validateSocialPrompt(pack, node) {
  if (!node.socialPrompt) {
    return;
  }

  validateStringField(node.socialPrompt.key, `Pack "${pack.packId}" node "${node.id}" socialPrompt.key`);
  validateStringField(node.socialPrompt.prompt, `Pack "${pack.packId}" node "${node.id}" socialPrompt.prompt`);
  validateStringField(node.socialPrompt.voteIntro, `Pack "${pack.packId}" node "${node.id}" socialPrompt.voteIntro`);
  validateStringField(node.socialPrompt.receiptTemplate, `Pack "${pack.packId}" node "${node.id}" socialPrompt.receiptTemplate`);
}

function validateRoundTemplate(pack, node) {
  const template = node.roundTemplate;

  if (!template) {
    return;
  }

  assert(!node.ending, `Pack "${pack.packId}" node "${node.id}" cannot define roundTemplate on an ending node.`);
  assert(TEMPLATE_IDS.has(template.id), `Pack "${pack.packId}" node "${node.id}" has invalid roundTemplate.id "${template.id}".`);

  if (template.privateInputType !== undefined) {
    assert(
      PRIVATE_INPUT_TYPES.has(template.privateInputType),
      `Pack "${pack.packId}" node "${node.id}" has invalid privateInputType "${template.privateInputType}".`
    );
  }

  validateStringField(template.privatePrompt, `Pack "${pack.packId}" node "${node.id}" roundTemplate.privatePrompt`);
  validateStringField(template.voteIntro, `Pack "${pack.packId}" node "${node.id}" roundTemplate.voteIntro`);
  validateStringField(template.receiptTemplate, `Pack "${pack.packId}" node "${node.id}" roundTemplate.receiptTemplate`);
  validateStringField(template.distributionIntro, `Pack "${pack.packId}" node "${node.id}" roundTemplate.distributionIntro`);

  if (template.betrayalEligible !== undefined) {
    assert(
      typeof template.betrayalEligible === "boolean",
      `Pack "${pack.packId}" node "${node.id}" roundTemplate.betrayalEligible must be boolean.`
    );
  }

  if (template.id === "confession") {
    if (template.privateInputType !== undefined) {
      assert(
        template.privateInputType === "choice_option",
        `Pack "${pack.packId}" node "${node.id}" confession template must use privateInputType "choice_option".`
      );
    }

    if (template.confessionOptions !== undefined) {
      assert(
        Array.isArray(template.confessionOptions) && template.confessionOptions.length > 0,
        `Pack "${pack.packId}" node "${node.id}" confessionOptions must be a non-empty array.`
      );

      const optionIds = new Set();

      for (const option of template.confessionOptions) {
        assert(typeof option.id === "string" && option.id.length > 0, `Pack "${pack.packId}" node "${node.id}" confession option id must be a non-empty string.`);
        assert(typeof option.label === "string" && option.label.length > 0, `Pack "${pack.packId}" node "${node.id}" confession option label must be a non-empty string.`);
        assert(!optionIds.has(option.id), `Pack "${pack.packId}" node "${node.id}" has duplicate confession option id "${option.id}".`);
        optionIds.add(option.id);
      }
    } else {
      assert(
        node.choices.length > 0,
        `Pack "${pack.packId}" node "${node.id}" confession template must expose public choices or explicit confessionOptions.`
      );
    }
  } else {
    if (template.privateInputType !== undefined) {
      assert(
        template.privateInputType === "player_target",
        `Pack "${pack.packId}" node "${node.id}" template "${template.id}" must use privateInputType "player_target".`
      );
    }

    assert(
      template.confessionOptions === undefined,
      `Pack "${pack.packId}" node "${node.id}" template "${template.id}" cannot define confessionOptions.`
    );
  }
}

function validateScenarioPack(pack) {
  const nodeIds = new Set();
  const endingCount = pack.nodes.filter((node) => node.ending).length;

  for (const node of pack.nodes) {
    assert(!nodeIds.has(node.id), `Pack "${pack.packId}" has duplicate node id "${node.id}".`);
    nodeIds.add(node.id);

    if (node.ending) {
      assert(node.choices.length === 0, `Pack "${pack.packId}" ending node "${node.id}" cannot define choices.`);
    } else {
      assert(node.choices.length > 0, `Pack "${pack.packId}" node "${node.id}" must define choices.`);
    }

    validateSocialPrompt(pack, node);
    validateRoundTemplate(pack, node);

    const choiceIds = new Set();

    for (const choice of node.choices) {
      assert(!choiceIds.has(choice.id), `Pack "${pack.packId}" node "${node.id}" has duplicate choice id "${choice.id}".`);
      choiceIds.add(choice.id);
    }
  }

  for (const nodeId of collectReferenceNodeIds(pack)) {
    assert(nodeIds.has(nodeId), `Pack "${pack.packId}" references missing node id "${nodeId}".`);
  }

  assert(pack.nodes.length >= 18, `Pack "${pack.packId}" needs at least 18 nodes.`);
  assert(endingCount >= 5, `Pack "${pack.packId}" needs at least 5 endings.`);

  const minimumEndingDepth = getMinimumEndingDepth(pack, pack.startNodeId);
  assert(
    Number.isFinite(minimumEndingDepth) && minimumEndingDepth >= 4,
    `Pack "${pack.packId}" reaches an ending too quickly.`
  );
}

function buildRunState(events) {
  const runState = {
    activeModifiers: new Set(),
    visitedNodeIds: new Set(),
    chaosMoments: 0
  };

  for (const event of events) {
    if (event.resolution_type !== "majority") {
      runState.chaosMoments += 1;
    }

    runState.visitedNodeIds.add(event.node_id);
    runState.visitedNodeIds.add(event.next_node_id);

    const node = getRawNode(event.pack, event.node_id);
    const choice = node?.choices.find((entry) => entry.id === event.selected_choice_id);

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

function passesGate(gate, runState) {
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

function applyTextVariants(baseText, variants, runState) {
  const matchedVariant = variants?.find((variant) => passesGate(variant.gate, runState));
  return matchedVariant?.text ?? baseText;
}

function resolveChoice(choice, runState) {
  if (!passesGate(choice.gate, runState)) {
    return null;
  }

  return {
    ...choice,
    label: applyTextVariants(choice.label, choice.labelVariants, runState)
  };
}

function resolveScenarioNode(pack, nodeId, events) {
  const rawNode = getRawNode(pack, nodeId);

  if (!rawNode) {
    return null;
  }

  const runState = buildRunState(events);

  if (!passesGate(rawNode.gate, runState)) {
    return null;
  }

  return {
    ...rawNode,
    prompt: applyTextVariants(rawNode.prompt, rawNode.promptVariants, runState),
    choices: rawNode.choices.map((choice) => resolveChoice(choice, runState)).filter(Boolean)
  };
}

function interpolateTemplate(text, spotlight = "someone", option = "something") {
  return String(text)
    .replaceAll("{{spotlight}}", spotlight)
    .replaceAll("{{they}}", spotlight)
    .replaceAll("{{them}}", spotlight)
    .replaceAll("{{their}}", `${spotlight}'s`)
    .replaceAll("{{option}}", option)
    .replaceAll("{{count}}", "2");
}

function createModifierHistory(pack) {
  const events = [];

  for (const node of pack.nodes) {
    for (const choice of node.choices) {
      if ((choice.effects ?? []).some((effect) => effect.type === "add_modifier")) {
        events.push({
          pack,
          node_id: node.id,
          selected_choice_id: choice.id,
          next_node_id: choice.nextNodeId,
          resolution_type: "majority"
        });
      }
    }
  }

  return events.slice(0, 3);
}

function createChaosHistory(pack) {
  const firstActionableNode = pack.nodes.find((node) => !node.ending && node.choices.length > 0);

  if (!firstActionableNode) {
    return [];
  }

  return [
    {
      pack,
      node_id: firstActionableNode.id,
      selected_choice_id: firstActionableNode.choices[0].id,
      next_node_id: firstActionableNode.choices[0].nextNodeId,
      resolution_type: "indecision_tie"
    }
  ];
}

function buildSimulationStates(pack) {
  return [
    { name: "baseline", events: [] },
    { name: "modifiers", events: createModifierHistory(pack) },
    { name: "chaos", events: createChaosHistory(pack) }
  ];
}

function getEffectiveTemplate(node) {
  const templateId = node.roundTemplate?.id ?? "scapegoat";
  const privateInputType =
    node.roundTemplate?.privateInputType ??
    (templateId === "confession" ? "choice_option" : "player_target");

  return {
    id: templateId,
    privateInputType
  };
}

function validateRuntimeCompatibility(pack, summary) {
  const states = buildSimulationStates(pack);

  for (const node of pack.nodes) {
    let resolvedSomewhere = false;
    let availableChoiceSomewhere = false;

    const effectiveTemplate = getEffectiveTemplate(node);

    if (node.roundTemplate) {
      if (effectiveTemplate.id === "confession") {
        const options = node.roundTemplate.confessionOptions ?? node.choices;
        assert(options.length > 0, `Pack "${pack.packId}" node "${node.id}" confession template has no private options.`);
      } else {
        assert(
          effectiveTemplate.privateInputType === "player_target",
          `Pack "${pack.packId}" node "${node.id}" template "${effectiveTemplate.id}" must accept player-target private input.`
        );
      }
    } else {
      assert(
        effectiveTemplate.id === "scapegoat" && effectiveTemplate.privateInputType === "player_target",
        `Pack "${pack.packId}" node "${node.id}" default template mapping is unsafe.`
      );
    }

    for (const state of states) {
      const resolvedNode = resolveScenarioNode(pack, node.id, state.events);

      if (!resolvedNode) {
        continue;
      }

      resolvedSomewhere = true;
      availableChoiceSomewhere = availableChoiceSomewhere || resolvedNode.choices.length > 0;
      summary.resolvedStates += 1;

      assert(typeof resolvedNode.prompt === "string", `Pack "${pack.packId}" node "${node.id}" prompt did not resolve to a string in ${state.name}.`);
      interpolateTemplate(resolvedNode.prompt);

      for (const choice of resolvedNode.choices) {
        assert(typeof choice.label === "string", `Pack "${pack.packId}" node "${node.id}" choice "${choice.id}" label did not resolve to a string in ${state.name}.`);
        interpolateTemplate(choice.label);
        summary.choiceEdges += 1;
      }
    }

    assert(resolvedSomewhere, `Pack "${pack.packId}" node "${node.id}" never resolves under baseline/modifier/chaos simulation.`);

    if (node.ending) {
      const resolvedNode = resolveScenarioNode(pack, node.id, []);
      assert(!resolvedNode || resolvedNode.choices.length === 0, `Pack "${pack.packId}" ending node "${node.id}" resolved with choices.`);
    } else {
      assert(
        availableChoiceSomewhere,
        `Pack "${pack.packId}" node "${node.id}" never produces a usable choice set under simulation.`
      );
    }

    for (const choice of node.choices) {
      const nextNode = getRawNode(pack, choice.nextNodeId);
      assert(nextNode, `Pack "${pack.packId}" node "${node.id}" choice "${choice.id}" points to missing next node "${choice.nextNodeId}".`);

      for (const targetId of choice.wildcardNodeIds ?? []) {
        assert(getRawNode(pack, targetId), `Pack "${pack.packId}" node "${node.id}" wildcard target "${targetId}" is missing.`);
        summary.detourEdges += 1;
      }

      for (const targetId of choice.specialEventNodeIds ?? []) {
        assert(getRawNode(pack, targetId), `Pack "${pack.packId}" node "${node.id}" special-event target "${targetId}" is missing.`);
        summary.detourEdges += 1;
      }
    }

    for (const targetId of node.audienceInterventionNodeIds ?? []) {
      assert(getRawNode(pack, targetId), `Pack "${pack.packId}" node "${node.id}" audience intervention target "${targetId}" is missing.`);
      summary.detourEdges += 1;
    }

    summary.nodes += 1;
  }
}

function main() {
  const packs = readPacks();
  const summary = {
    packs: 0,
    nodes: 0,
    choiceEdges: 0,
    detourEdges: 0,
    resolvedStates: 0
  };

  for (const pack of packs) {
    validateScenarioPack(pack);
    validateRuntimeCompatibility(pack, summary);
    summary.packs += 1;
  }

  console.log(
    `Pack compatibility passed: ${summary.packs} packs, ${summary.nodes} nodes, ${summary.choiceEdges} choice resolutions, ${summary.detourEdges} detour edges.`
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
