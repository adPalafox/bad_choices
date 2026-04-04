"use client";

import { startTransition, useCallback, useEffect, useState } from "react";

import { MIN_PLAYERS, REVEAL_DURATION_SECONDS, VOTE_DURATION_SECONDS } from "@/lib/game";
import { getBrowserSupabaseClient } from "@/lib/supabase";
import { readRoomSession, writeRoomSession } from "@/lib/room-session";
import type { ApiRoomState, RoomSession } from "@/lib/types";

type RoomPageClientProps = {
  code: string;
};

type JoinState = {
  nickname: string;
  busy: boolean;
  error: string | null;
};

export function RoomPageClient({ code }: RoomPageClientProps) {
  const [state, setState] = useState<ApiRoomState | null>(null);
  const [session, setSession] = useState<RoomSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [joinState, setJoinState] = useState<JoinState>({
    nickname: "",
    busy: false,
    error: null
  });

  const refreshState = useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/${code}`, {
        cache: "no-store"
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load room.");
      }

      startTransition(() => {
        setState(payload);
        setError(null);
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load room.");
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    setSession(readRoomSession(code));
    refreshState();
  }, [code, refreshState]);

  useEffect(() => {
    if (!state?.room.id) {
      return;
    }

    const supabase = getBrowserSupabaseClient();

    if (!supabase) {
      return;
    }

    const channel = supabase
      .channel(`room:${state.room.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${state.room.id}` },
        refreshState
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_id=eq.${state.room.id}` },
        refreshState
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "votes", filter: `room_id=eq.${state.room.id}` },
        refreshState
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_events", filter: `room_id=eq.${state.room.id}` },
        refreshState
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refreshState, state?.room.id]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!state?.room.phase_deadline || (state.room.phase !== "voting" && state.room.phase !== "reveal")) {
      return;
    }

    const interval = window.setInterval(() => {
      if (new Date(state.room.phase_deadline ?? "").getTime() > Date.now()) {
        return;
      }

      void fetch(`/api/rooms/${code}/resolve`, {
        method: "POST"
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [code, state?.room.phase, state?.room.phase_deadline]);

  const me = session && state ? state.players.find((player) => player.id === session.playerId) ?? null : null;

  const hasVoted = Boolean(
    me && state?.currentNode && state.votes.some((vote) => vote.player_id === me.id && vote.node_id === state.currentNode?.id)
  );

  const visibleVoteSnapshot =
    state?.room.phase === "reveal" || state?.room.phase === "ended" ? state.lastEvent?.vote_snapshot ?? null : null;

  const secondsRemaining = state?.room.phase_deadline
    ? Math.max(0, Math.ceil((new Date(state.room.phase_deadline).getTime() - now) / 1000))
    : 0;

  async function handleJoinRoom() {
    setJoinState((current) => ({
      ...current,
      busy: true,
      error: null
    }));

    try {
      const sessionId = crypto.randomUUID();
      const response = await fetch(`/api/rooms/${code}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          nickname: joinState.nickname,
          sessionId
        })
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to join room.");
      }

      const nextSession = {
        sessionId,
        playerId: payload.playerId,
        nickname: payload.nickname
      };

      writeRoomSession(code, nextSession);
      setSession(nextSession);
      setJoinState({
        nickname: payload.nickname,
        busy: false,
        error: null
      });
      await refreshState();
    } catch (joinError) {
      setJoinState((current) => ({
        ...current,
        busy: false,
        error: joinError instanceof Error ? joinError.message : "Failed to join room."
      }));
    }
  }

  async function postToRoom(path: string, body: Record<string, string> = {}) {
    if (!session) {
      setError("Missing local player session.");
      return;
    }

    const response = await fetch(`/api/rooms/${code}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sessionId: session.sessionId,
        playerId: session.playerId,
        ...body
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(payload.error ?? "Request failed.");
      return;
    }

    await refreshState();
  }

  if (loading) {
    return <main className="room-shell">Loading room...</main>;
  }

  if (error || !state) {
    return <main className="room-shell error-banner">{error ?? "Room not found."}</main>;
  }

  const inviteUrl =
    typeof window === "undefined" ? "" : `${window.location.origin}/room/${state.room.code}`;

  return (
    <main className="room-shell">
      <section className="room-header panel">
        <div>
          <div className="section-tag">Room {state.room.code}</div>
          <h1>{state.pack.title}</h1>
          <p>{state.pack.theme}</p>
        </div>
        <div className="room-meta">
          <span>{state.players.length} players</span>
          <span>Round {state.room.round || 0}</span>
          <span>{state.room.phase}</span>
        </div>
      </section>

      {!me ? (
        <section className="grid-two">
          <div className="panel">
            <div className="section-tag">Invite</div>
            <h2>Share the code</h2>
            <p>Room code: {state.room.code}</p>
            <p>{inviteUrl}</p>
          </div>

          <div className="panel">
            <div className="section-tag">Join</div>
            <h2>Claim a seat</h2>
            {state.room.phase === "lobby" ? (
              <>
                <label className="field">
                  <span>Nickname</span>
                  <input
                    value={joinState.nickname}
                    maxLength={24}
                    minLength={2}
                    onChange={(event) =>
                      setJoinState((current) => ({
                        ...current,
                        nickname: event.target.value
                      }))
                    }
                  />
                </label>
                <button
                  className="button-primary"
                  disabled={joinState.busy || joinState.nickname.trim().length < 2}
                  onClick={handleJoinRoom}
                  type="button"
                >
                  {joinState.busy ? "Joining..." : "Join room"}
                </button>
                {joinState.error ? <p className="error-inline">{joinState.error}</p> : null}
              </>
            ) : (
              <p>This game already started. New players can join on the next rematch.</p>
            )}
          </div>
        </section>
      ) : null}

      <section className="grid-two">
        <div className="panel">
          <div className="section-tag">Players</div>
          <h2>Lobby roster</h2>
          <ul className="player-list">
            {state.players.map((player) => (
              <li key={player.id}>
                <span>{player.nickname}</span>
                <span>{player.is_host ? "host" : "crew"}</span>
              </li>
            ))}
          </ul>

          {state.room.phase === "lobby" ? (
            <>
              <p className="helper-text">
                Need {MIN_PLAYERS}+ players to start. Everyone joins anonymously with a nickname only.
              </p>
              {me?.is_host ? (
                <button
                  className="button-primary"
                  disabled={state.players.length < MIN_PLAYERS}
                  onClick={() => postToRoom("/start")}
                  type="button"
                >
                  Start round one
                </button>
              ) : (
                <p className="helper-text">Waiting for the host to start the chaos.</p>
              )}
            </>
          ) : null}

          {state.room.phase === "ended" && me?.is_host ? (
            <button className="button-secondary" onClick={() => postToRoom("/rematch")} type="button">
              Rematch this pack
            </button>
          ) : null}
        </div>

        <div className="panel stage-panel">
          {state.room.phase === "lobby" ? (
            <>
              <div className="section-tag">How it works</div>
              <h2>Fast rounds, instant blame</h2>
              <ol className="number-list">
                <li>Read the scenario beat in under five seconds.</li>
                <li>Vote before the {VOTE_DURATION_SECONDS}-second clock runs out.</li>
                <li>Watch the majority choice create a worse situation.</li>
                <li>Repeat until the room reaches a chaotic ending.</li>
              </ol>
            </>
          ) : null}

          {state.room.phase === "voting" && state.currentNode ? (
            <>
              <div className="section-tag">Vote now</div>
              <h2>{state.currentNode.prompt}</h2>
              <p className="timer-chip">{secondsRemaining}s left</p>
              <div className="choice-list">
                {state.currentNode.choices.map((choice) => {
                  const selected =
                    me && state.votes.some((vote) => vote.player_id === me.id && vote.selected_choice_id === choice.id);

                  return (
                    <button
                      key={choice.id}
                      className={`choice-button ${selected ? "selected" : ""}`}
                      disabled={hasVoted}
                      onClick={() => postToRoom("/vote", { choiceId: choice.id })}
                      type="button"
                    >
                      {choice.label}
                    </button>
                  );
                })}
              </div>
              <p className="helper-text">
                {hasVoted ? "Vote locked. Waiting for the rest of the room." : "Pick one fast. No speeches."}
              </p>
            </>
          ) : null}

          {state.room.phase === "reveal" && state.lastEvent ? (
            <>
              <div className="section-tag">Majority decided</div>
              <h2>{state.lastEvent.selected_choice_label}</h2>
              <p className="timer-chip">{secondsRemaining}s until the next mess</p>
              <p className="result-card">{state.lastEvent.result_text}</p>
              <div className="vote-bar-group">
                {Object.entries(visibleVoteSnapshot ?? {}).map(([choiceId, count]) => {
                  const choiceLabel =
                    state.currentNode?.choices.find((choice) => choice.id === choiceId)?.label ?? choiceId;

                  return (
                    <div className="vote-bar" key={choiceId}>
                      <span>{choiceLabel}</span>
                      <strong>{count}</strong>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}

          {state.room.phase === "ended" ? (
            <>
              <div className="section-tag">Ending</div>
              <h2>{state.currentNode?.prompt ?? "The room survived, technically."}</h2>
              <p className="result-card">
                Final recap from {state.events.length} decisions. The room can rematch immediately or switch packs.
              </p>
              <div className="recap-grid">
                <article className="recap-card">
                  <span>Path taken</span>
                  <strong>{state.events.map((event) => event.selected_choice_label).join(" → ")}</strong>
                </article>
                <article className="recap-card">
                  <span>Participation</span>
                  <strong>{state.players.length} players blamed each other</strong>
                </article>
                <article className="recap-card">
                  <span>Rounds completed</span>
                  <strong>{state.events.length}</strong>
                </article>
              </div>
            </>
          ) : null}
        </div>
      </section>

      {state.room.phase === "ended" ? (
        <section className="panel">
          <div className="section-tag">Decision trail</div>
          <div className="timeline">
            {state.events.map((event) => (
              <article className="timeline-item" key={event.id}>
                <span>Round {event.round}</span>
                <h3>{event.prompt}</h3>
                <p>{event.selected_choice_label}</p>
                <small>{event.result_text}</small>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="footnote-row">
        <span>Vote timer: {VOTE_DURATION_SECONDS}s</span>
        <span>Reveal timer: {REVEAL_DURATION_SECONDS}s</span>
        <span>Invite friends with room code {state.room.code}</span>
      </section>
    </main>
  );
}
