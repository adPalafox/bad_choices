"use client";

import { createContext, useContext, useEffect, useMemo } from "react";

import { hydrateAudioSettings, setAudioEnabled, useAudioSettingsStore } from "@/lib/audio-settings";
import { preloadEnabledSounds, unlockAudioPlayback } from "@/lib/sound";

type AudioSettingsContextValue = {
  enabled: boolean;
  hydrated: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
};

const AudioSettingsContext = createContext<AudioSettingsContextValue | null>(null);

export function AudioSettingsProvider({ children }: React.PropsWithChildren) {
  const settings = useAudioSettingsStore();

  useEffect(() => {
    hydrateAudioSettings();
  }, []);

  useEffect(() => {
    if (!settings.enabled) {
      return;
    }

    preloadEnabledSounds();
  }, [settings.enabled]);

  const value = useMemo<AudioSettingsContextValue>(
    () => ({
      enabled: settings.enabled,
      hydrated: settings.hydrated,
      async setEnabled(enabled: boolean) {
        if (enabled) {
          await unlockAudioPlayback();
        }

        setAudioEnabled(enabled);
      }
    }),
    [settings.enabled, settings.hydrated]
  );

  return <AudioSettingsContext.Provider value={value}>{children}</AudioSettingsContext.Provider>;
}

export function useAudioSettings() {
  const context = useContext(AudioSettingsContext);

  if (!context) {
    throw new Error("useAudioSettings must be used within AudioSettingsProvider.");
  }

  return context;
}
