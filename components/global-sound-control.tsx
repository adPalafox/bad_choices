"use client";

import { SoundOffIcon, SoundOnIcon } from "@/components/ui-icons";
import { useAudioSettings } from "@/components/audio-settings-provider";

export function GlobalSoundControl() {
  const { enabled, setEnabled } = useAudioSettings();

  return (
    <div className="sound-control">
      <button
        aria-pressed={enabled}
        className={`sound-control-button ${enabled ? "is-enabled" : ""}`}
        onClick={() => void setEnabled(!enabled)}
        type="button"
      >
        {enabled ? <SoundOnIcon className="button-icon" /> : <SoundOffIcon className="button-icon" />}
        <span>{enabled ? "Mute sound" : "Unmute sound"}</span>
      </button>
    </div>
  );
}
