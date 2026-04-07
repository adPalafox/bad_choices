type DetourKind = "audience" | "special" | "wildcard";

const forcedDetours = new Set(
  (process.env.BAD_CHOICES_TEST_FORCE_DETOURS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
);

function hashToUnitInterval(value: string) {
  let hash = 2166136261;

  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

export function buildDetourKey(nodeId: string, kind: DetourKind) {
  return `${nodeId}:${kind}`;
}

export function shouldTakeDetour(
  detourKey: string,
  chance: number | undefined,
  entropy: string
) {
  if (forcedDetours.has(detourKey)) {
    return true;
  }

  if (typeof chance !== "number") {
    return true;
  }

  const seed = process.env.BAD_CHOICES_TEST_RANDOM_SEED;

  if (!seed) {
    return Math.random() <= chance;
  }

  return hashToUnitInterval(`${seed}:${detourKey}:${entropy}`) <= chance;
}
