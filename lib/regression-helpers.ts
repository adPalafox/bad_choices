import type { PrivateSubmissionRecord } from "./types";

type ConnectedPlayerLike = {
  connected: boolean;
};

export function countConnectedPlayers<T extends ConnectedPlayerLike>(players: T[]) {
  return players.filter((player) => player.connected).length;
}

export function canStartRoomWithConnectedPlayers<T extends ConnectedPlayerLike>(players: T[], minPlayers: number) {
  return countConnectedPlayers(players) >= minPlayers;
}

export function hasLobbyCapacity<T extends ConnectedPlayerLike>(players: T[], maxPlayers: number) {
  return countConnectedPlayers(players) < maxPlayers;
}

export function didPlayerSelectPrivateOption(
  privateSubmissions: PrivateSubmissionRecord[],
  playerId: string | undefined,
  optionId: string
) {
  if (!playerId) {
    return false;
  }

  return privateSubmissions.some(
    (submission) => submission.player_id === playerId && submission.selected_option_id === optionId
  );
}

export function hydrateSavedNickname(currentValue: string, savedNickname: string) {
  const normalizedSavedNickname = savedNickname.trim();
  return currentValue || normalizedSavedNickname;
}
