import type { RoomSession } from "@/lib/types";

const STORAGE_PREFIX = "bad-choices-room";

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
