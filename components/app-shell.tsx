"use client";

import { AudioSettingsProvider } from "@/components/audio-settings-provider";
import { GlobalSoundControl } from "@/components/global-sound-control";

export function AppShell({ children }: React.PropsWithChildren) {
  return (
    <AudioSettingsProvider>
      {children}
      <GlobalSoundControl />
    </AudioSettingsProvider>
  );
}
