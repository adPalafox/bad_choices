import type { RoomSession } from "@/lib/types";

const STORAGE_PREFIX = "bad-choices-room";
const NICKNAME_STORAGE_KEY = "bad-choices:nickname";
const SOUND_ENABLED_STORAGE_KEY = "bad-choices:sound-enabled";

function clampVolume(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(0, Math.min(1, value));
}

export function getRoomStorageKey(roomCode: string) {
  return `${STORAGE_PREFIX}:${roomCode.toUpperCase()}`;
}

export function readRoomSession(roomCode: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(getRoomStorageKey(roomCode));

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as RoomSession;
  } catch {
    return null;
  }
}

export function writeRoomSession(roomCode: string, session: RoomSession) {
  window.localStorage.setItem(getRoomStorageKey(roomCode), JSON.stringify(session));
}

export function readSavedNickname() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(NICKNAME_STORAGE_KEY) ?? "";
}

export function writeSavedNickname(nickname: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(NICKNAME_STORAGE_KEY, nickname.trim());
}

export function readSoundEnabled() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(SOUND_ENABLED_STORAGE_KEY) === "true";
}

export function writeSoundEnabled(enabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SOUND_ENABLED_STORAGE_KEY, enabled ? "true" : "false");
}

export { clampVolume };
