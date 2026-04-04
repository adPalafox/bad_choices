import chaoticFriends from "@/content/packs/chaotic-friends.json";
import cursedTeamBuilding from "@/content/packs/cursed-team-building.json";
import dateNightDisaster from "@/content/packs/date-night-disaster.json";
import type { ScenarioNode, ScenarioPack } from "@/lib/types";

const packs = [
  chaoticFriends,
  dateNightDisaster,
  cursedTeamBuilding
] as ScenarioPack[];

export function getScenarioPacks(): ScenarioPack[] {
  return packs;
}

export function getScenarioPack(packId: string): ScenarioPack {
  const pack = packs.find((entry) => entry.packId === packId);

  if (!pack) {
    throw new Error(`Unknown scenario pack: ${packId}`);
  }

  return pack;
}

export function getScenarioNode(packId: string, nodeId: string | null): ScenarioNode | null {
  if (!nodeId) {
    return null;
  }

  return getScenarioPack(packId).nodes.find((node) => node.id === nodeId) ?? null;
}
