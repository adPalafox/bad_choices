"use client";

import { FormEvent, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import badChoicesArt from "@/bad_choices.webp";
import { DoorIcon, PlusIcon } from "@/components/ui-icons";
import { createSessionId, MAX_PLAYERS, START_MIN_PLAYERS, VOTE_DURATION_SECONDS } from "@/lib/game";
import { readSavedNickname, writeRoomSession, writeSavedNickname } from "@/lib/room-session";
import type { ScenarioPack } from "@/lib/types";

type LandingPageProps = {
  packs: ScenarioPack[];
};

type LandingMode = "join" | "create";

export function LandingPage({ packs }: LandingPageProps) {
  const router = useRouter();
  const savedNickname = useSyncExternalStore(
    () => () => undefined,
    readSavedNickname,
    () => ""
  );
  const [mode, setMode] = useState<LandingMode>("join");
  const [hostName, setHostName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [packId, setPackId] = useState(packs[0]?.packId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const effectiveHostName = hostName || savedNickname;
  const effectiveJoinName = joinName || savedNickname;

  async function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    setMode("create");

    const sessionId = createSessionId();
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        hostName: effectiveHostName,
        packId,
        sessionId
      })
    });

    const payload = await response.json();

    setBusy(null);

    if (!response.ok) {
      setError(payload.error ?? "Failed to create room.");
      return;
    }

    writeRoomSession(payload.roomCode, {
      sessionId,
      playerId: payload.playerId,
      nickname: effectiveHostName.trim()
    });
    writeSavedNickname(effectiveHostName);
    router.push(`/room/${payload.roomCode}`);
  }

  async function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("join");
    setError(null);
    setMode("join");

    const normalizedCode = joinCode.trim().toUpperCase();
    const sessionId = createSessionId();
    const response = await fetch(`/api/rooms/${normalizedCode}/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        nickname: effectiveJoinName,
        sessionId
      })
    });

    const payload = await response.json();

    setBusy(null);

    if (!response.ok) {
      setError(payload.error ?? "Failed to join room.");
      return;
    }

    writeRoomSession(normalizedCode, {
      sessionId,
      playerId: payload.playerId,
      nickname: payload.nickname
    });
    writeSavedNickname(payload.nickname);
    router.push(`/room/${normalizedCode}`);
  }

  return (
    <main className="shell landing-shell">
      <section className="hero-card landing-hero">
        <div className="landing-hero-grid">
          <div className="landing-hero-copy">
            <div className="eyebrow">Secret nominations. Public fallout.</div>
            <div className="landing-logo-lockup">
              <Image
                className="landing-logo"
                src={badChoicesArt}
                alt="Bad Choices logo art"
                priority
                sizes="(max-width: 840px) 180px, 220px"
              />
              <div className="landing-brand-copy">
                <h1>
                  <span>Bad</span>
                  <span>Choices</span>
                </h1>
              </div>
            </div>
            <p className="hero-copy">
              Pick privately who gets spotlighted, then vote publicly on what happens next.
              Every round ends with someone wearing the blame in front of the whole room.
            </p>
            <div className="hero-stats">
              <span>{START_MIN_PLAYERS}-{MAX_PLAYERS} players</span>
              <span>{VOTE_DURATION_SECONDS}-second rounds</span>
              <span>3 launch packs</span>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-actions">
        <div className="landing-actions-copy">
          <div className="section-tag">Start here</div>
          <h2>Got a code? Jump in. Starting a round of secret nominations? Create a room.</h2>
          <p>
            Most players arrive to join a live room, so that path comes first. Hosting stays one tap away.
          </p>
        </div>

        <div className="landing-switch" role="tablist" aria-label="Landing mode">
          <button
            className={`landing-switch-button ${mode === "join" ? "active" : ""}`}
            onClick={() => setMode("join")}
            role="tab"
            aria-selected={mode === "join"}
            type="button"
          >
            Join
          </button>
          <button
            className={`landing-switch-button ${mode === "create" ? "active" : ""}`}
            onClick={() => setMode("create")}
            role="tab"
            aria-selected={mode === "create"}
            type="button"
          >
            Create room
          </button>
        </div>

        <div className="landing-cards">
          <form
            className={`panel landing-card landing-card-join ${mode === "join" ? "focused" : "muted"}`}
            onSubmit={handleJoinRoom}
            data-testid="join-room-form"
          >
            <div className="section-tag">Join a room</div>
            <h3>Use a code or invite link</h3>
            <p>Zero login. Enter a nickname, paste the code, and jump into the private nomination.</p>

            <label className="field">
              <span>Room code</span>
              <input
                data-testid="join-code-input"
                maxLength={4}
                minLength={4}
                placeholder="ABCD"
                required
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              />
            </label>

            <label className="field">
              <span>Your nickname</span>
              <input
                data-testid="join-name-input"
                maxLength={24}
                minLength={2}
                placeholder="Moral Liability"
                required
                value={effectiveJoinName}
                onChange={(event) => setJoinName(event.target.value)}
              />
            </label>

            <button
              className="button-primary landing-cta"
              data-testid="join-room-submit"
              disabled={busy === "join"}
              type="submit"
            >
              <span className="button-content">
                <DoorIcon className="button-icon" />
                <span>{busy === "join" ? "Joining..." : "Join room"}</span>
              </span>
            </button>
          </form>

          <form
            className={`panel landing-card landing-card-create ${mode === "create" ? "focused" : "muted"}`}
            onSubmit={handleCreateRoom}
            data-testid="create-room-form"
          >
            <div className="section-tag">Host a room</div>
            <h3>Start fast</h3>
            <p>Pick a pack, name yourself, and get a room code you can drop into chat instantly.</p>

            <label className="field">
              <span>Your nickname</span>
              <input
                data-testid="host-name-input"
                maxLength={24}
                minLength={2}
                placeholder="Captain Bad Idea"
                required
                value={effectiveHostName}
                onChange={(event) => setHostName(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Scenario pack</span>
              <select data-testid="pack-select" value={packId} onChange={(event) => setPackId(event.target.value)}>
                {packs.map((pack) => (
                  <option key={pack.packId} value={pack.packId}>
                    {pack.title} · {pack.theme}
                  </option>
                ))}
              </select>
            </label>

            <button
              className="button-ghost"
              data-testid="create-room-submit"
              disabled={busy === "create"}
              type="submit"
            >
              <span className="button-content">
                <PlusIcon className="button-icon" />
                <span>{busy === "create" ? "Creating room..." : "Create room"}</span>
              </span>
            </button>
          </form>
        </div>
      </section>

      {error ? <p className="error-banner">{error}</p> : null}
    </main>
  );
}
