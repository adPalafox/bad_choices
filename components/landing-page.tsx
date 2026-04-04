"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createSessionId, MIN_PLAYERS } from "@/lib/game";
import { writeRoomSession } from "@/lib/room-session";
import type { ScenarioPack } from "@/lib/types";

type LandingPageProps = {
  packs: ScenarioPack[];
};

export function LandingPage({ packs }: LandingPageProps) {
  const router = useRouter();
  const [hostName, setHostName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [packId, setPackId] = useState(packs[0]?.packId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

  async function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    setError(null);

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
    router.push(`/room/${payload.roomCode}`);
  }

  async function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("join");
    setError(null);

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
    router.push(`/room/${normalizedCode}`);
  }

  return (
    <main className="shell">
      <section className="hero-card">
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

      <section className="grid-two">
        <form className="panel" onSubmit={handleCreateRoom}>
          <div className="section-tag">Host a room</div>
          <h2>Start fast</h2>
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

          <button className="button-primary" disabled={busy === "create"} type="submit">
            {busy === "create" ? "Creating room..." : "Create room"}
          </button>
        </form>

        <form className="panel" onSubmit={handleJoinRoom}>
          <div className="section-tag">Join a room</div>
          <h2>Use a code or invite link</h2>
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

          <button className="button-secondary" disabled={busy === "join"} type="submit">
            {busy === "join" ? "Joining..." : "Join room"}
          </button>
        </form>
      </section>

      {error ? <p className="error-banner">{error}</p> : null}
    </main>
  );
}
