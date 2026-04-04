"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { DoorIcon, PlusIcon } from "@/components/ui-icons";
import { createSessionId, MIN_PLAYERS } from "@/lib/game";
import { readSavedNickname, writeRoomSession, writeSavedNickname } from "@/lib/room-session";
import type { ScenarioPack } from "@/lib/types";

type LandingPageProps = {
  packs: ScenarioPack[];
};

type LandingMode = "join" | "create";

export function LandingPage({ packs }: LandingPageProps) {
  const router = useRouter();
  const savedNickname = readSavedNickname();
  const [mode, setMode] = useState<LandingMode>("join");
  const [hostName, setHostName] = useState(savedNickname);
  const [joinName, setJoinName] = useState(savedNickname);
  const [joinCode, setJoinCode] = useState("");
  const [packId, setPackId] = useState(packs[0]?.packId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

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
        hostName,
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
      nickname: hostName.trim()
    });
    writeSavedNickname(hostName);
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
        nickname: joinName,
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
        <div className="eyebrow">Social chaos in under 10 minutes</div>
        <h1>Bad Choices</h1>
        <p className="hero-copy">
          Read a ridiculous setup, argue for five seconds, lock a vote, then watch the room
          blame the majority. Built for friends, dates, teams, Discord calls, and stream chat.
        </p>
        <div className="hero-stats">
          <span>{MIN_PLAYERS}-8 players</span>
          <span>15-second rounds</span>
          <span>3 launch packs</span>
        </div>
      </section>

      <section className="landing-actions">
        <div className="landing-actions-copy">
          <div className="section-tag">Start here</div>
          <h2>Got a code? Jump in. Starting the chaos? Create a room.</h2>
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
          >
            <div className="section-tag">Join a room</div>
            <h3>Use a code or invite link</h3>
            <p>Zero login. Enter a nickname, paste the code, and jump straight into the vote.</p>

            <label className="field">
              <span>Room code</span>
              <input
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
                maxLength={24}
                minLength={2}
                placeholder="Moral Liability"
                required
                value={joinName}
                onChange={(event) => setJoinName(event.target.value)}
              />
            </label>

            <button className="button-primary landing-cta" disabled={busy === "join"} type="submit">
              <span className="button-content">
                <DoorIcon className="button-icon" />
                <span>{busy === "join" ? "Joining..." : "Join room"}</span>
              </span>
            </button>
          </form>

          <form
            className={`panel landing-card landing-card-create ${mode === "create" ? "focused" : "muted"}`}
            onSubmit={handleCreateRoom}
          >
            <div className="section-tag">Host a room</div>
            <h3>Start fast</h3>
            <p>Pick a tone, name yourself, and get a room code you can drop into chat instantly.</p>

            <label className="field">
              <span>Your nickname</span>
              <input
                maxLength={24}
                minLength={2}
                placeholder="Captain Bad Idea"
                required
                value={hostName}
                onChange={(event) => setHostName(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Scenario pack</span>
              <select value={packId} onChange={(event) => setPackId(event.target.value)}>
                {packs.map((pack) => (
                  <option key={pack.packId} value={pack.packId}>
                    {pack.title} · {pack.theme}
                  </option>
                ))}
              </select>
            </label>

            <button className="button-ghost" disabled={busy === "create"} type="submit">
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
