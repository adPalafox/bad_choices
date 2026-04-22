import { clampVolume } from "@/lib/room-session";
import { getAudioSettingsSnapshot } from "@/lib/audio-settings";

type AudioFileExtension = "ogg" | "wav";
type SoundAssetPath = `/sounds/${string}.${AudioFileExtension}`;

export type SoundCueId =
  | "private_pick_locked"
  | "public_vote_locked"
  | "countdown_tick"
  | "final_countdown_tick"
  | "reveal_transition"
  | "chaos_reveal"
  | "clean_outcome"
  | "post_game_artifact_handoff"
  | "copy_share_success"
  | "advance_round";

type SoundCandidate = {
  src: SoundAssetPath;
};

type SoundManifest = Record<SoundCueId, readonly [SoundCandidate, ...SoundCandidate[]]>;

const soundManifest: SoundManifest = {
  private_pick_locked: [{ src: "/sounds/private-pick-locked.ogg" }],
  public_vote_locked: [{ src: "/sounds/public-vote-locked.ogg" }],
  countdown_tick: [
    { src: "/sounds/countdown-urgency-tick-1.wav" }
  ],
  final_countdown_tick: [
    { src: "/sounds/final-countdown-tick-2.wav" }
  ],
  reveal_transition: [
    { src: "/sounds/reveal-transition-2.ogg" }
  ],
  chaos_reveal: [{ src: "/sounds/chaos-reveal-1.ogg" }],
  clean_outcome: [{ src: "/sounds/clean-outcome.ogg" }],
  post_game_artifact_handoff: [{ src: "/sounds/post-game-artifact-handoff.ogg" }],
  copy_share_success: [
    { src: "/sounds/copy-share-success-2.ogg" }
  ],
  advance_round: [{ src: "/sounds/advance-round-1.ogg" }]
};

const audioCache = new Map<string, HTMLAudioElement>();
let audioUnlocked = false;

function pickCandidate(cue: SoundCueId, variant?: number) {
  const candidates = soundManifest[cue];

  if (typeof variant === "number" && Number.isInteger(variant)) {
    return candidates[Math.max(0, Math.min(candidates.length - 1, variant))];
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

function getCachedAudio(src: string) {
  const cachedAudio = audioCache.get(src);

  if (cachedAudio) {
    return cachedAudio;
  }

  const audio = new Audio(src);
  audio.preload = "auto";
  audioCache.set(src, audio);
  return audio;
}

export function preloadEnabledSounds() {
  if (typeof window === "undefined") {
    return;
  }

  const { enabled } = getAudioSettingsSnapshot();

  if (!enabled) {
    return;
  }

  const frequentCues: SoundCueId[] = [
    "private_pick_locked",
    "public_vote_locked",
    "countdown_tick",
    "final_countdown_tick",
    "reveal_transition"
  ];

  for (const cue of frequentCues) {
    for (const candidate of soundManifest[cue]) {
      getCachedAudio(candidate.src).load();
    }
  }
}

export async function unlockAudioPlayback() {
  if (typeof window === "undefined" || audioUnlocked) {
    return;
  }

  const unlockTone = new Audio(
    "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
  );
  unlockTone.volume = 0;

  try {
    await unlockTone.play();
    unlockTone.pause();
    unlockTone.currentTime = 0;
    audioUnlocked = true;
  } catch {
    audioUnlocked = false;
  }
}

export function playSound(cue: SoundCueId, options?: { volume?: number; variant?: number }) {
  if (typeof window === "undefined") {
    return;
  }

  const { enabled } = getAudioSettingsSnapshot();

  if (!enabled) {
    return;
  }

  const candidate = pickCandidate(cue, options?.variant);
  const baseAudio = getCachedAudio(candidate.src);
  const playbackVolume = clampVolume(options?.volume ?? 1);

  if (playbackVolume <= 0) {
    return;
  }

  const playbackAudio = baseAudio.cloneNode(true) as HTMLAudioElement;
  playbackAudio.volume = playbackVolume;

  const playbackAttempt = playbackAudio.play();
  if (playbackAttempt && typeof playbackAttempt.catch === "function") {
    void playbackAttempt.catch(() => undefined);
  }
}
