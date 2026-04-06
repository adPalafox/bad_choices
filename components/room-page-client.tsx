"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ClockIcon,
  CopyIcon,
  DoorIcon,
  EyeIcon,
  EyeOffIcon,
  LinkIcon,
  RotateIcon,
  ShareIcon,
  SparklesIcon,
  UsersIcon
} from "@/components/ui-icons";
import {
  applySpotlightTemplate,
  buildSocialRecapStats,
  buildPostGameArtifact,
  createSessionId,
  PRIVATE_INPUT_DURATION_SECONDS,
  REVEAL_DURATION_SECONDS,
  START_MIN_PLAYERS,
  VOTE_DURATION_SECONDS
} from "@/lib/game";
import { readRoomSession, readSavedNickname, writeRoomSession, writeSavedNickname } from "@/lib/room-session";
import { getBrowserSupabaseClient } from "@/lib/supabase";
import type { ApiRoomState, Choice, RoomSession, ScenarioPack } from "@/lib/types";

type RoomPageClientProps = {
  code: string;
  packs: ScenarioPack[];
};

type JoinState = {
  nickname: string;
  busy: boolean;
  error: string | null;
};

export function RoomPageClient({ code, packs }: RoomPageClientProps) {
  const router = useRouter();
  const artifactCardRef = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<ApiRoomState | null>(null);
  const [session, setSession] = useState<RoomSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presenceReady, setPresenceReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [showRoomPanel, setShowRoomPanel] = useState(false);
  const [copiedField, setCopiedField] = useState<"code" | "link" | null>(null);
  const [pendingPrivateSelectionId, setPendingPrivateSelectionId] = useState<string | null>(null);
  const [pendingChoiceId, setPendingChoiceId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"start" | "rematch" | null>(null);
  const [showPackPicker, setShowPackPicker] = useState(false);
  const [nextPackId, setNextPackId] = useState("");
  const [sharingArtifact, setSharingArtifact] = useState(false);
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

  const syncPresence = useCallback(
    async (nextConnected: boolean, activeSession: RoomSession) => {
      const response = await fetch(`/api/rooms/${code}/presence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sessionId: activeSession.sessionId,
          playerId: activeSession.playerId,
          connected: nextConnected
        }),
        keepalive: !nextConnected
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to sync presence.");
      }
    },
    [code]
  );

  useEffect(() => {
    setSession(readRoomSession(code));
    setPresenceReady(false);
    refreshState();
  }, [code, refreshState]);

  useEffect(() => {
    const savedNickname = readSavedNickname();

    if (savedNickname) {
      setJoinState((current) => ({
        ...current,
        nickname: current.nickname || savedNickname
      }));
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

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
        { event: "*", schema: "public", table: "private_submissions", filter: `room_id=eq.${state.room.id}` },
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
    if (
      !state?.room.phase_deadline ||
      (state.room.phase !== "private_input" && state.room.phase !== "voting" && state.room.phase !== "reveal")
    ) {
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

  useEffect(() => {
    if (!session) {
      setPresenceReady(true);
      return;
    }

    let cancelled = false;

    void syncPresence(true, session)
      .then(refreshState)
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setPresenceReady(true);
        }
      });

    const markDisconnected = () => {
      const payload = JSON.stringify({
        sessionId: session.sessionId,
        playerId: session.playerId,
        connected: false
      });

      if (navigator.sendBeacon) {
        navigator.sendBeacon(`/api/rooms/${code}/presence`, payload);
        return;
      }

      void fetch(`/api/rooms/${code}/presence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: payload,
        keepalive: true
      });
    };

    window.addEventListener("pagehide", markDisconnected);
    window.addEventListener("beforeunload", markDisconnected);

    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", markDisconnected);
      window.removeEventListener("beforeunload", markDisconnected);
    };
  }, [code, refreshState, session, syncPresence]);

  useEffect(() => {
    setShowRoomPanel(state?.room.phase === "lobby");
  }, [state?.room.phase]);

  useEffect(() => {
    if (!copiedField) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCopiedField(null);
    }, 1600);

    return () => window.clearTimeout(timeout);
  }, [copiedField]);

  useEffect(() => {
    if (state?.pack.packId) {
      setNextPackId(state.pack.packId);
    }
  }, [state?.pack.packId]);

  useEffect(() => {
    const activeNode = state?.currentNode;

    if (!activeNode) {
      setPendingPrivateSelectionId(null);
      setPendingChoiceId(null);
      return;
    }

    if (
      state?.privateSubmissions.some(
        (submission) => submission.player_id === session?.playerId && submission.node_id === activeNode.id
      )
    ) {
      setPendingPrivateSelectionId(null);
    }

    if (state?.votes.some((vote) => vote.player_id === session?.playerId && vote.node_id === activeNode.id)) {
      setPendingChoiceId(null);
    }
  }, [session?.playerId, state?.currentNode, state?.privateSubmissions, state?.votes]);

  useEffect(() => {
    if (state?.room.phase !== "lobby") {
      setPendingAction((current) => (current === "start" ? null : current));
    }

    if (state?.room.phase === "lobby") {
      setPendingAction((current) => (current === "rematch" ? null : current));
    }
  }, [state?.room.phase]);

  const me = session && state ? state.players.find((player) => player.id === session.playerId) ?? null : null;
  const isLobby = state?.room.phase === "lobby";
  const inviteUrl =
    typeof window === "undefined" || !state ? "" : `${window.location.origin}/room/${state.room.code}`;
  const siteUrl = typeof window === "undefined" ? "" : window.location.origin;
  const currentNode = state?.currentNode ?? null;
  const currentChoices = useMemo(() => currentNode?.choices ?? [], [currentNode]);
  const currentRoundContext = state?.currentRoundContext ?? null;
  const totalPrivateSubmissions =
    (state?.privateSubmissions.length ?? 0) +
    (pendingPrivateSelectionId &&
    !state?.privateSubmissions.some((submission) => submission.player_id === session?.playerId)
      ? 1
      : 0);
  const totalVotes =
    (state?.votes.length ?? 0) +
    (pendingChoiceId && !state?.votes.some((vote) => vote.player_id === session?.playerId) ? 1 : 0);
  const playerCount = state?.players.length ?? 0;

  const liveVoteCounts = useMemo(() => {
    const counts = Object.fromEntries(currentChoices.map((choice) => [choice.id, 0])) as Record<string, number>;

    for (const vote of state?.votes ?? []) {
      counts[vote.selected_choice_id] = (counts[vote.selected_choice_id] ?? 0) + 1;
    }

    if (pendingChoiceId && !state?.votes.some((vote) => vote.player_id === session?.playerId)) {
      counts[pendingChoiceId] = (counts[pendingChoiceId] ?? 0) + 1;
    }

    return counts;
  }, [currentChoices, pendingChoiceId, session?.playerId, state?.votes]);

  const socialRecapStats = useMemo(() => (state?.room.phase === "ended" ? buildSocialRecapStats(state) : []), [state]);
  const spotlightLabel = currentRoundContext?.spotlightLabel ?? state?.lastEvent?.spotlight_label ?? null;

  const hasSubmittedPrivate = Boolean(
    me &&
      currentNode &&
      state?.privateSubmissions.some(
        (submission) => submission.player_id === me.id && submission.node_id === currentNode.id
      )
  ) || Boolean(pendingPrivateSelectionId);
  const hasVoted = Boolean(
    me && currentNode && state?.votes.some((vote) => vote.player_id === me.id && vote.node_id === currentNode.id)
  ) || Boolean(pendingChoiceId);
  const showLiveVoteCounts = Boolean(me?.is_host && state?.room.phase === "voting");

  const visibleVoteSnapshot =
    state?.room.phase === "reveal" || state?.room.phase === "ended" ? state.lastEvent?.vote_snapshot ?? null : null;
  const postGameArtifact = useMemo(
    () => (state?.room.phase === "ended" ? buildPostGameArtifact(state) : null),
    [state]
  );
  const displayArtifact = useMemo(() => {
    if (!state || !postGameArtifact) {
      return null;
    }

    const eventLabels = state.events.map((event) => ({
      id: event.id,
      text: applySpotlightTemplate(event.selected_choice_label, event.spotlight_label) ?? event.selected_choice_label
    }));

    return {
      ...postGameArtifact,
      headline:
        applySpotlightTemplate(postGameArtifact.headline, state.events.at(-1)?.spotlight_label ?? null) ??
        postGameArtifact.headline,
      caption:
        applySpotlightTemplate(postGameArtifact.caption, state.events.at(-1)?.spotlight_label ?? null) ??
        postGameArtifact.caption,
      pathSteps: eventLabels.map((event) => event.text),
      path: eventLabels.map((event) => event.text).join(" -> "),
      shareMessage:
        applySpotlightTemplate(postGameArtifact.shareMessage, state.events.at(-1)?.spotlight_label ?? null) ??
        postGameArtifact.shareMessage
    };
  }, [postGameArtifact, state]);
  const socialShareTargets = useMemo(() => {
    if (!displayArtifact || !siteUrl) {
      return [];
    }

    const fullMessage = `${displayArtifact.shareMessage} Try it now: ${siteUrl}`;
    const encodedUrl = encodeURIComponent(siteUrl);
    const encodedMessage = encodeURIComponent(displayArtifact.shareMessage);
    const encodedFullMessage = encodeURIComponent(fullMessage);

    return [
      { label: "Messenger", href: `fb-messenger://share/?link=${encodedUrl}` },
      { label: "WhatsApp", href: `https://wa.me/?text=${encodedFullMessage}` },
      { label: "Telegram", href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedMessage}` },
      { label: "X", href: `https://twitter.com/intent/tweet?text=${encodedMessage}&url=${encodedUrl}` },
      { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedMessage}` },
      { label: "Reddit", href: `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedMessage}` }
    ];
  }, [displayArtifact, siteUrl]);

  const secondsRemaining = state?.room.phase_deadline
    ? Math.max(0, Math.ceil((new Date(state.room.phase_deadline).getTime() - now) / 1000))
    : 0;
  const phaseDurationSeconds =
    state?.room.phase === "private_input"
      ? PRIVATE_INPUT_DURATION_SECONDS
      : state?.room.phase === "voting"
      ? VOTE_DURATION_SECONDS
      : state?.room.phase === "reveal"
        ? REVEAL_DURATION_SECONDS
        : 0;
  const phaseProgressPercent =
    phaseDurationSeconds > 0
      ? Math.max(0, Math.min(100, ((phaseDurationSeconds - secondsRemaining) / phaseDurationSeconds) * 100))
      : 0;

  async function handleJoinRoom() {
    setJoinState((current) => ({
      ...current,
      busy: true,
      error: null
    }));

    try {
      const sessionId = createSessionId();
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
      writeSavedNickname(payload.nickname);
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

  async function postToRoom(
    path: string,
    body: Record<string, string> = {},
    options?: {
      optimisticPrivateSelectionId?: string;
      optimisticChoiceId?: string;
      optimisticAction?: "start" | "rematch";
    }
  ) {
    if (!session) {
      setError("Missing local player session.");
      return;
    }

    if (options?.optimisticPrivateSelectionId) {
      setPendingPrivateSelectionId(options.optimisticPrivateSelectionId);
    }

    if (options?.optimisticChoiceId) {
      setPendingChoiceId(options.optimisticChoiceId);
    }

    if (options?.optimisticAction) {
      setPendingAction(options.optimisticAction);
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
      if (options?.optimisticPrivateSelectionId) {
        setPendingPrivateSelectionId(null);
      }

      if (options?.optimisticChoiceId) {
        setPendingChoiceId(null);
      }

      if (options?.optimisticAction) {
        setPendingAction(null);
      }

      setError(payload.error ?? "Request failed.");
      return;
    }

    void refreshState();
  }

  async function copyValue(value: string, field: "code" | "link") {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
    } catch {
      setError(`Failed to copy ${field}.`);
    }
  }

  function inlineComputedStyles(source: HTMLElement, target: HTMLElement) {
    const computed = window.getComputedStyle(source);

    for (const property of computed) {
      target.style.setProperty(
        property,
        computed.getPropertyValue(property),
        computed.getPropertyPriority(property)
      );
    }

    target.style.setProperty("margin", computed.margin);
  }

  function cloneNodeWithInlineStyles(source: HTMLElement) {
    const clone = source.cloneNode(true) as HTMLElement;
    const sourceNodes = [source, ...Array.from(source.querySelectorAll<HTMLElement>("*"))];
    const cloneNodes = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))];

    sourceNodes.forEach((node, index) => {
      const cloneNode = cloneNodes[index];

      if (cloneNode) {
        inlineComputedStyles(node, cloneNode);
      }
    });

    return clone;
  }

  function createArtifactImageBlob() {
    const source = artifactCardRef.current;

    if (!source) {
      throw new Error("Missing artifact card.");
    }

    const rect = source.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    const clone = cloneNodeWithInlineStyles(source);
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");

    const serialized = new XMLSerializer().serializeToString(clone);
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <foreignObject width="100%" height="100%">${serialized}</foreignObject>
      </svg>
    `;
    return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  }

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function shareArtifact() {
    if (!state || !displayArtifact) {
      return;
    }

    const shareText = `We just torched "${state.pack.title}" in Bad Choices. Try it now: ${siteUrl}`;

    setSharingArtifact(true);
    setError(null);

    try {
      const blob = await createArtifactImageBlob();
      const file = new File([blob], `bad-choices-${state.room.code.toLowerCase()}-recap.svg`, {
        type: "image/svg+xml"
      });

      if (typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `${state.pack.title} recap`,
          text: shareText,
          url: siteUrl,
          files: [file]
        });
        return;
      }

      if (typeof navigator.share === "function") {
        downloadBlob(blob, file.name);
        await navigator.share({
          title: `${state.pack.title} recap`,
          text: shareText,
          url: siteUrl
        });
        return;
      }

      downloadBlob(blob, file.name);
      await navigator.clipboard.writeText(shareText);
      setCopiedField("link");
    } catch (shareError) {
      if (!(shareError instanceof DOMException && shareError.name === "AbortError")) {
        setError(shareError instanceof Error ? shareError.message : "Failed to share artifact.");
      }
    } finally {
      setSharingArtifact(false);
    }
  }

  function renderVoteRows(choices: Choice[], counts: Record<string, number>, reveal = false) {
    return choices.map((choice) => {
      const count = counts[choice.id] ?? 0;
      const selected = Boolean(
        me && state?.votes.some((vote) => vote.player_id === me.id && vote.selected_choice_id === choice.id)
      );
      const winner = reveal && state?.lastEvent?.selected_choice_id === choice.id;

      return (
        <div className={`vote-row ${winner ? "winner" : ""}`} key={choice.id}>
          <span>{renderSpotlightText(choice.label)}</span>
          <strong>{count}</strong>
          {selected && !reveal ? <em>Your vote</em> : null}
        </div>
      );
    });
  }

  function getPlayerName(playerId: string | null | undefined) {
    if (!playerId) {
      return "Nobody";
    }

    return state?.players.find((player) => player.id === playerId)?.nickname ?? "Someone";
  }

  function renderSpotlightText(text: string | null | undefined) {
    if (!text) {
      return "";
    }

    return applySpotlightTemplate(text, spotlightLabel) ?? text;
  }

  function renderTextWithSpotlight(text: string | null | undefined, localSpotlightLabel: string | null | undefined) {
    if (!text) {
      return "";
    }

    return applySpotlightTemplate(text, localSpotlightLabel ?? null) ?? text;
  }

  function renderPrivateChoiceLabel(optionId: string | null | undefined) {
    if (!optionId) {
      return "";
    }

    const optionLabel = currentRoundContext?.privateOptions.find((option) => option.id === optionId)?.label ?? optionId;
    return renderSpotlightText(optionLabel);
  }

  const revealInstigatorNames = (state?.lastEvent?.instigator_player_ids ?? []).map((playerId) => getPlayerName(playerId));
  const revealPowerHolderName = getPlayerName(state?.lastEvent?.power_holder_player_id);

  if (loading) {
    return <main className="room-shell">Loading room...</main>;
  }

  if (error || !state) {
    return <main className="room-shell error-banner">{error ?? "Room not found."}</main>;
  }

  const waitingForPresenceRestore = Boolean(session && !me && !presenceReady);

  return (
    <main className={`room-shell ${isLobby ? "mode-lobby" : "mode-game"}`}>
      {isLobby ? (
        <section className="share-utility panel">
          <div className="share-code-block">
            <div className="section-tag">Room code</div>
            <div className="share-code-value">{state.room.code}</div>
            <p>Send the code or copy the room link before the host starts.</p>
          </div>
          <div className="share-actions">
            <button
              className={`button-ghost ${copiedField === "code" ? "is-success" : ""}`}
              onClick={() => copyValue(state.room.code, "code")}
              type="button"
            >
              <span className="button-content">
                <CopyIcon className="button-icon" />
                <span>{copiedField === "code" ? "Code copied" : "Copy code"}</span>
              </span>
            </button>
            <button
              className={`button-secondary ${copiedField === "link" ? "is-success" : ""}`}
              onClick={() => copyValue(inviteUrl, "link")}
              type="button"
            >
              <span className="button-content">
                <LinkIcon className="button-icon" />
                <span>{copiedField === "link" ? "Link copied" : "Copy room link"}</span>
              </span>
            </button>
          </div>
        </section>
      ) : (
        <section className="compact-header panel">
          <div className="compact-header-main">
            <div className="section-tag">Live game</div>
            <div className="compact-title-row">
              <button className="button-ghost" onClick={() => setShowRoomPanel((current) => !current)} type="button">
                <span className="button-content">
                  {showRoomPanel ? <EyeOffIcon className="button-icon" /> : <EyeIcon className="button-icon" />}
                  <span>{showRoomPanel ? "Hide room details" : "Show room details"}</span>
                </span>
              </button>
            </div>
          </div>
          <div className="room-meta">
            <span>Code {state.room.code}</span>
            <span>Round {state.room.round || 0}</span>
            <span className="meta-with-icon">
              <UsersIcon className="meta-icon" />
              <span>{playerCount} players</span>
            </span>
          </div>
        </section>
      )}

      {!me && !waitingForPresenceRestore ? (
        <section className={`join-shell ${isLobby ? "join-lobby" : "join-inline"}`}>
          <div className="panel">
            <div className="section-tag">Join this room</div>
            <h2>{isLobby ? "Claim a seat" : "You are not in this room yet"}</h2>
            {state.room.phase === "lobby" ? (
              <>
                <p>Invite links drop you directly here. The only thing left is your nickname.</p>
                <label className="field">
                  <span>Nickname</span>
                  <input
                    value={joinState.nickname}
                    maxLength={24}
                    minLength={2}
                    placeholder="Moral Liability"
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
              <p>This round is already underway. New players can jump in on the next rematch.</p>
            )}
          </div>
        </section>
      ) : null}

      {waitingForPresenceRestore ? (
        <section className="join-shell join-inline">
          <div className="panel">
            <div className="section-tag">Reconnecting</div>
            <h2>Restoring your seat in the room</h2>
            <p>We found a saved room session and are reconnecting you now.</p>
          </div>
        </section>
      ) : null}

      <section
        className={`room-layout ${isLobby ? "lobby-layout" : "game-layout"} ${showRoomPanel ? "with-room-panel" : "without-room-panel"}`}
      >
        <div className="stage-column">
          <section className="panel stage-panel">
            {isLobby ? (
              <>
                <div className="section-tag">How it works</div>
                <h2>Secret picks, public blame</h2>
                <ol className="number-list">
                  <li>Read the scenario beat in under five seconds.</li>
                  <li>Secretly nominate who makes this worse before the {PRIVATE_INPUT_DURATION_SECONDS}-second clock runs out.</li>
                  <li>Vote on the spotlight dilemma before the {VOTE_DURATION_SECONDS}-second clock expires.</li>
                  <li>Watch the reveal name who caused it and who has to wear it.</li>
                  <li>Repeat until the room reaches a chaotic ending.</li>
                </ol>
                {me?.is_host ? (
                  <button
                    className="button-primary lobby-start-button"
                    disabled={playerCount < START_MIN_PLAYERS || pendingAction === "start"}
                    onClick={() => postToRoom("/start", {}, { optimisticAction: "start" })}
                    type="button"
                  >
                    {playerCount < START_MIN_PLAYERS
                      ? `Need ${START_MIN_PLAYERS}+ players`
                      : pendingAction === "start"
                        ? "Starting..."
                        : "Start round one"}
                  </button>
                ) : (
                  <p className="helper-text">Waiting for the host to start the chaos.</p>
                )}
              </>
            ) : null}

            {state.room.phase === "private_input" && state.currentNode ? (
              <>
                <div className="stage-header">
                  <div>
                    <div className="section-tag">Secret pick</div>
                    <h2>{renderSpotlightText(state.currentNode.prompt)}</h2>
                    <p>{currentRoundContext?.privatePrompt ?? "Who in this room makes this worse?"}</p>
                  </div>
                  <div className="stage-pills">
                    <span className="timer-chip meta-with-icon">
                      <ClockIcon className="meta-icon" />
                      <span>{secondsRemaining}s left</span>
                    </span>
                    <span className="timer-chip meta-with-icon">
                      <UsersIcon className="meta-icon" />
                      <span>{totalPrivateSubmissions}/{playerCount} submitted</span>
                    </span>
                  </div>
                </div>
                <div
                  aria-hidden="true"
                  className={`phase-progress ${secondsRemaining <= 5 ? "is-urgent" : ""}`}
                >
                  <div className="phase-progress-fill" style={{ width: `${phaseProgressPercent}%` }} />
                </div>

                <div className="choice-list">
                  {currentRoundContext?.privateInputType === "choice_option"
                    ? currentRoundContext.privateOptions.map((option) => {
                        const selected =
                          (me &&
                            state.privateSubmissions.some(
                              (submission) =>
                                submission.player_id === me.id && submission.selected_option_id === option.id
                            )) ||
                          pendingPrivateSelectionId === option.id;

                        return (
                          <button
                            key={option.id}
                            className={`choice-button ${selected ? "selected" : ""} ${hasSubmittedPrivate && !selected ? "locked" : ""}`}
                            disabled={hasSubmittedPrivate}
                            onClick={() =>
                              postToRoom(
                                "/private",
                                { optionId: option.id },
                                { optimisticPrivateSelectionId: option.id }
                              )
                            }
                            type="button"
                          >
                            <span className="choice-copy">{renderPrivateChoiceLabel(option.id)}</span>
                          </button>
                        );
                      })
                    : state.players.map((player) => {
                        const selected =
                          (me &&
                            state.privateSubmissions.some(
                              (submission) => submission.player_id === me.id && submission.target_player_id === player.id
                            )) ||
                          pendingPrivateSelectionId === player.id;

                        return (
                          <button
                            key={player.id}
                            className={`choice-button ${selected ? "selected" : ""} ${hasSubmittedPrivate && !selected ? "locked" : ""}`}
                            disabled={hasSubmittedPrivate}
                            onClick={() =>
                              postToRoom(
                                "/private",
                                { targetPlayerId: player.id },
                                { optimisticPrivateSelectionId: player.id }
                              )
                            }
                            type="button"
                          >
                            <span className="choice-copy">{player.nickname}</span>
                          </button>
                        );
                      })}
                </div>

                <p className="helper-text">
                  {hasSubmittedPrivate
                    ? "Secret pick locked. Nobody sees the private read until the room turns it into a public dilemma."
                    : currentRoundContext?.privateInputType === "choice_option"
                      ? "Pick what you would actually do. The room only sees the aggregate once private input closes."
                      : "Choose one player fast. The room only sees the result after private input closes."}
                </p>
              </>
            ) : null}

            {state.room.phase === "voting" && state.currentNode ? (
              <>
                <div className="stage-header">
                  <div>
                    <div className="section-tag">Spotlight vote</div>
                    <h2>{renderSpotlightText(state.currentNode.prompt)}</h2>
                    <p>{renderSpotlightText(currentRoundContext?.voteIntro ?? "Decide how the group commits.")}</p>
                  </div>
                  <div className="stage-pills">
                    <span className="timer-chip meta-with-icon">
                      <ClockIcon className="meta-icon" />
                      <span>{secondsRemaining}s left</span>
                    </span>
                    <span className="timer-chip meta-with-icon">
                      <UsersIcon className="meta-icon" />
                      <span>{totalVotes}/{playerCount} voted</span>
                    </span>
                  </div>
                </div>
                <div
                  aria-hidden="true"
                  className={`phase-progress ${secondsRemaining <= 5 ? "is-urgent" : ""}`}
                >
                  <div className="phase-progress-fill" style={{ width: `${phaseProgressPercent}%` }} />
                </div>

                {currentRoundContext?.spotlightLabel ? (
                  <section className="payoff-card">
                    <p className="payoff-kicker">
                      {currentRoundContext.templateId === "prediction" ? "Predicted player" : "Spotlight"}
                    </p>
                    <h2 className="payoff-headline">{currentRoundContext.spotlightLabel}</h2>
                    <p className="payoff-body">
                      {currentRoundContext.templateId === "prediction"
                        ? "The room privately decided this player should be the one to carry the plan."
                        : currentRoundContext.privateResolutionType === "silence"
                        ? "Nobody would volunteer, so chaos assigned the pressure."
                        : "The room quietly decided this player should own the fallout."}
                    </p>
                  </section>
                ) : null}
                {!currentRoundContext?.spotlightLabel && currentRoundContext?.distributionLine ? (
                  <section className="payoff-card">
                    <p className="payoff-kicker">Private read</p>
                    <h2 className="payoff-headline">
                      {currentRoundContext.leadingPrivateOptionLabel ?? "No consensus"}
                    </h2>
                    <p className="payoff-body">{renderSpotlightText(currentRoundContext.distributionLine)}</p>
                  </section>
                ) : null}

                <div className="choice-list">
                  {state.currentNode.choices.map((choice) => {
                    const selected =
                      (me && state.votes.some((vote) => vote.player_id === me.id && vote.selected_choice_id === choice.id)) ||
                      pendingChoiceId === choice.id;
                    const liveCount = liveVoteCounts[choice.id] ?? 0;

                    return (
                      <button
                        key={choice.id}
                        className={`choice-button ${selected ? "selected" : ""} ${hasVoted && !selected ? "locked" : ""}`}
                        disabled={hasVoted}
                        onClick={() => postToRoom("/vote", { choiceId: choice.id }, { optimisticChoiceId: choice.id })}
                        type="button"
                      >
                        <span className="choice-copy">{renderSpotlightText(choice.label)}</span>
                        {showLiveVoteCounts ? (
                          <span className="choice-meta">
                            <strong>{liveCount}</strong>
                            <small>{selected ? "You" : "votes"}</small>
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                <p className="helper-text">
                  {hasVoted
                    ? showLiveVoteCounts
                      ? "Vote locked. Live counts stay visible for the host while the room decides."
                      : "Vote locked. Results stay hidden until the choice resolves."
                    : showLiveVoteCounts
                      ? "Pick one fast. Host can monitor the count, nobody else can."
                      : "Pick one fast. Results stay hidden until the choice resolves."}
                </p>
              </>
            ) : null}

            {state.room.phase === "reveal" && state.lastEvent ? (
              <>
                <div className="stage-header">
                  <div>
                    <div className={`section-tag ${state.lastEvent.resolution_type !== "majority" ? "section-tag-chaos" : ""}`}>
                      {state.lastEvent.resolution_label}
                    </div>
                  </div>
                  <div className="stage-pills">
                    <span className="timer-chip meta-with-icon">
                      <ClockIcon className="meta-icon" />
                      <span>{secondsRemaining}s until next round</span>
                    </span>
                    <span className="timer-chip meta-with-icon">
                      <UsersIcon className="meta-icon" />
                      <span>{playerCount} in room</span>
                    </span>
                  </div>
                </div>
                <div aria-hidden="true" className="phase-progress is-reveal">
                  <div className="phase-progress-fill" style={{ width: `${phaseProgressPercent}%` }} />
                </div>
                <section
                  className={`payoff-card ${state.lastEvent.resolution_type !== "majority" ? "payoff-card-chaos" : ""}`}
                >
                  <p className="payoff-kicker">Winning move</p>
                  <h2 className="payoff-headline">{renderSpotlightText(state.lastEvent.selected_choice_label)}</h2>
                  <p className="payoff-body">{renderSpotlightText(state.lastEvent.consequence_line)}</p>
                  {state.lastEvent.spotlight_label ? (
                    <p className="payoff-body">
                      {state.lastEvent.template_id === "prediction" ? "Predicted player" : "Spotlight"}:{" "}
                      <strong>{state.lastEvent.spotlight_label}</strong>
                    </p>
                  ) : null}
                  {state.lastEvent.leading_private_option_label ? (
                    <p className="payoff-body">
                      Private lean: <strong>{renderTextWithSpotlight(state.lastEvent.leading_private_option_label, state.lastEvent.spotlight_label)}</strong>
                    </p>
                  ) : null}
                  {state.lastEvent.distribution_line ? (
                    <p className="payoff-body">
                      {renderTextWithSpotlight(state.lastEvent.distribution_line, state.lastEvent.spotlight_label)}
                    </p>
                  ) : null}
                  <p className="payoff-body">
                    Instigators:{" "}
                    <strong>{revealInstigatorNames.length ? revealInstigatorNames.join(", ") : "Chaos only"}</strong>
                  </p>
                  <p className="payoff-body">{renderSpotlightText(state.lastEvent.result_text)}</p>
                  <p className="payoff-body">{renderSpotlightText(state.lastEvent.receipt_line)}</p>
                  {state.lastEvent.power_holder_player_id ? (
                    <p className="payoff-body">
                      Hidden power:{" "}
                      <strong>
                        {revealPowerHolderName}
                        {state.lastEvent.power_altered_outcome ? " broke the tie." : " held the betrayal card."}
                      </strong>
                    </p>
                  ) : null}
                </section>
                <div className="vote-bar-group">{renderVoteRows(currentChoices, visibleVoteSnapshot ?? {}, true)}</div>
              </>
            ) : null}

            {state.room.phase === "ended" ? (
              <>
                {displayArtifact ? (
                  <section className="share-damage">
                    <div className="share-damage-header">
                      <div>
                        <div className="section-tag">Post-game artifact</div>
                        <h2>Share the damage.</h2>
                      </div>
                      <p>The match is over. The artifact is the thing worth posting.</p>
                    </div>

                    <div className="share-artifact-grid">
                      <article className="artifact-card" aria-label="Post-game recap card" ref={artifactCardRef}>
                        <div className="artifact-card-topline">
                          <span>{state.pack.title}</span>
                          <span>Room {state.room.code}</span>
                        </div>
                        <p className="artifact-card-subhead">{displayArtifact.subhead}</p>
                        <h3
                          className={`artifact-card-headline ${displayArtifact.headline.length > 110 ? "is-long" : ""} ${displayArtifact.headline.length > 160 ? "is-xlong" : ""}`}
                        >
                          {displayArtifact.headline}
                        </h3>
                        <p className="artifact-card-caption">{displayArtifact.caption}</p>
                        <div className="artifact-path-block">
                          <span>Decision trail</span>
                          <div
                            className={`artifact-path-steps ${displayArtifact.path.length > 150 ? "is-long" : ""}`}
                          >
                            {displayArtifact.pathSteps.map((step, index) => (
                              <span className="artifact-path-step" key={`${step}-${index}`}>
                                <strong>{step}</strong>
                                {index < displayArtifact.pathSteps.length - 1 ? (
                                  <em aria-hidden="true">→</em>
                                ) : null}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="artifact-stat-row">
                          <span>{playerCount} players</span>
                          <span>{state.events.length} rounds</span>
                          <span>{displayArtifact.chaosMoments} chaos events</span>
                        </div>
                      </article>
                      <div className="artifact-actions">
                        <button className="button-secondary" disabled={sharingArtifact} onClick={() => void shareArtifact()} type="button">
                          <span className="button-content">
                            <ShareIcon className="button-icon" />
                            <span>{sharingArtifact ? "Preparing share..." : "Share artifact"}</span>
                          </span>
                        </button>
                        <p>
                          Shares the recap card as an image with a message and a link back to the site so the next group can try it.
                        </p>
                        <div className="artifact-social-grid">
                          {socialShareTargets.map((target) => (
                            <a
                              className="button-ghost artifact-platform-button"
                              href={target.href}
                              key={target.label}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {target.label}
                            </a>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}
                {me?.is_host ? (
                  <>
                    <div className="ending-actions">
                      <button
                        className="button-primary"
                        disabled={pendingAction === "rematch"}
                        onClick={() => postToRoom("/rematch", {}, { optimisticAction: "rematch" })}
                        type="button"
                      >
                        <span className="button-content">
                          <RotateIcon className="button-icon" />
                          <span>{pendingAction === "rematch" ? "Resetting..." : "Rematch this pack"}</span>
                        </span>
                      </button>
                      <button
                        className="button-secondary"
                        disabled={pendingAction === "rematch"}
                        onClick={() => setShowPackPicker((current) => !current)}
                        type="button"
                      >
                        <span className="button-content">
                          <SparklesIcon className="button-icon" />
                          <span>{showPackPicker ? "Cancel switch" : "Switch packs"}</span>
                        </span>
                      </button>
                      <button className="button-ghost" onClick={() => router.push("/")} type="button">
                        <span className="button-content">
                          <DoorIcon className="button-icon" />
                          <span>Create new room</span>
                        </span>
                      </button>
                    </div>

                    {showPackPicker ? (
                      <div className="ending-pack-picker">
                        <label className="field">
                          <span>Choose next pack</span>
                          <select value={nextPackId} onChange={(event) => setNextPackId(event.target.value)}>
                            {packs.map((pack) => (
                              <option key={pack.packId} value={pack.packId}>
                                {pack.title} · {pack.theme}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="button-secondary"
                          disabled={pendingAction === "rematch" || nextPackId === state.pack.packId}
                          onClick={() =>
                            postToRoom("/rematch", { packId: nextPackId }, { optimisticAction: "rematch" })
                          }
                          type="button"
                        >
                          <span className="button-content">
                            <SparklesIcon className="button-icon" />
                            <span>{pendingAction === "rematch" ? "Switching..." : "Start lobby with this pack"}</span>
                          </span>
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}
                <div className="recap-grid">
                          <article className="recap-card recap-card-path">
                    <span>Path taken</span>
                    <div className="recap-path-steps">
                      {state.events.map((event, index) => (
                        <span className="recap-path-step" key={event.id}>
                          <strong>{renderTextWithSpotlight(event.selected_choice_label, event.spotlight_label)}</strong>
                          {index < state.events.length - 1 ? <em aria-hidden="true">→</em> : null}
                        </span>
                      ))}
                    </div>
                  </article>
                  <article className="recap-card recap-card-stat">
                    <span>Participation</span>
                    <strong>{playerCount} players made it to the end</strong>
                  </article>
                  <article className="recap-card recap-card-stat">
                    <span>Rounds completed</span>
                    <strong>{state.events.length}</strong>
                  </article>
                  {socialRecapStats.map((stat) => (
                    <article className="recap-card recap-card-stat" key={stat.label}>
                      <span>{stat.label}</span>
                      <strong>
                        {stat.playerName} · {stat.value}
                      </strong>
                    </article>
                  ))}
                </div>
              </>
            ) : null}
          </section>

          {state.room.phase === "ended" ? (
            <section className="panel">
              <div className="section-tag">Decision trail</div>
              <div className="timeline">
                {state.events.map((event) => (
                  <article
                    className={`timeline-item ${event.resolution_type !== "majority" ? "timeline-item-chaos" : ""}`}
                    key={event.id}
                  >
                    <span>Round {event.round}</span>
                    <h3>{renderTextWithSpotlight(event.prompt, event.spotlight_label)}</h3>
                    <strong className="timeline-resolution">{event.resolution_label}</strong>
                    <p>
                      {renderTextWithSpotlight(event.selected_choice_label, event.spotlight_label)}
                      {event.spotlight_label ? ` · Spotlight ${event.spotlight_label}` : ""}
                    </p>
                    <small>{renderTextWithSpotlight(event.result_text, event.spotlight_label)}</small>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className={`room-panel ${showRoomPanel ? "open" : ""}`}>
          <section className="panel room-side-panel">
            <div className="section-tag">{isLobby ? "Room details" : "Players"}</div>
            <h3>{isLobby ? state.pack.title : `Room ${state.room.code}`}</h3>
            <p>{isLobby ? state.pack.theme : "Live roster and room controls."}</p>

            <ul className="player-list">
              {state.players.map((player) => (
                <li key={player.id}>
                  <span>{player.nickname}</span>
                  <span>{player.is_host ? "host" : "crew"}</span>
                </li>
              ))}
            </ul>

            <div className="room-side-meta">
              <span>{playerCount} players live</span>
              <span>Vote timer {VOTE_DURATION_SECONDS}s</span>
              <span>Reveal timer {REVEAL_DURATION_SECONDS}s</span>
            </div>

            <button
              className={`button-ghost room-copy-link ${copiedField === "link" ? "is-success" : ""}`}
              onClick={() => copyValue(inviteUrl, "link")}
              type="button"
            >
              <span className="button-content">
                <LinkIcon className="button-icon" />
                <span>{copiedField === "link" ? "Link copied" : "Copy room link"}</span>
              </span>
            </button>
          </section>
        </aside>
      </section>
    </main>
  );
}
