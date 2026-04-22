import { useSyncExternalStore } from "react";

import { readSoundEnabled, writeSoundEnabled } from "@/lib/room-session";

export type AudioSettings = {
  enabled: boolean;
  hydrated: boolean;
};

const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  enabled: false,
  hydrated: false
};

let audioSettings = DEFAULT_AUDIO_SETTINGS;
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function updateAudioSettings(nextSettings: Partial<AudioSettings>) {
  audioSettings = {
    ...audioSettings,
    ...nextSettings
  };
  emitChange();
}

export function subscribeToAudioSettings(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAudioSettingsSnapshot() {
  return audioSettings;
}

export function hydrateAudioSettings() {
  if (typeof window === "undefined") {
    return;
  }

  updateAudioSettings({
    enabled: readSoundEnabled(),
    hydrated: true
  });
}

export function setAudioEnabled(enabled: boolean) {
  const nextEnabled = Boolean(enabled);
  writeSoundEnabled(nextEnabled);
  updateAudioSettings({
    enabled: nextEnabled,
    hydrated: true
  });
}

export function useAudioSettingsStore() {
  return useSyncExternalStore(subscribeToAudioSettings, getAudioSettingsSnapshot, () => DEFAULT_AUDIO_SETTINGS);
}
