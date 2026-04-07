import type { Choice, ResolutionType, VoteRecord } from "./types";

function pickFirstChoice(choices: Choice[]) {
  if (choices.length === 0) {
    throw new Error("Cannot resolve votes without available choices.");
  }

  return choices[0];
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
      winningChoice = pickFirstChoice(tiedChoices);
    }
  } else {
    const candidateChoices = totalVotes === 0 ? choices : tiedChoices;
    winningChoice = pickFirstChoice(candidateChoices);
  }

  return {
    winningChoice,
    voteSnapshot,
    resolutionType,
    powerAlteredOutcome
  };
}
