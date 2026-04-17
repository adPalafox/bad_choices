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
  applyTemplateFallbacks,
  applySpotlightTemplate,
  buildSocialRecapStats,
  buildPostGameArtifact,
  createSessionId,
  PRIVATE_INPUT_DURATION_SECONDS,
  REVEAL_DURATION_SECONDS,
  START_MIN_PLAYERS,
  VOTE_DURATION_SECONDS
} from "@/lib/game";
import { didPlayerSelectPrivateOption } from "@/lib/regression-helpers";
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
  const resolvingExpiredPhaseRef = useRef(false);
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
  const [pendingAction, setPendingAction] = useState<"start" | "rematch" | "advance" | null>(null);
  const [showPackPicker, setShowPackPicker] = useState(false);
  const [nextPackId, setNextPackId] = useState("");
  const [sharingArtifact, setSharingArtifact] = useState(false);
  const [showRevealDetails, setShowRevealDetails] = useState(false);
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

  const resolveExpiredPhase = useCallback(async () => {
    if (resolvingExpiredPhaseRef.current) {
      return;
    }

    resolvingExpiredPhaseRef.current = true;

    try {
      const response = await fetch(`/api/rooms/${code}/resolve`, {
        method: "POST"
      });

      if (response.ok) {
        await refreshState();
      }
    } finally {
      resolvingExpiredPhaseRef.current = false;
    }
  }, [code, refreshState]);

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
      (state.room.phase !== "private_input" && state.room.phase !== "voting")
    ) {
      return;
    }

    const resolveIfExpired = () => {
      if (new Date(state.room.phase_deadline ?? "").getTime() > Date.now()) {
        return;
      }

      void resolveExpiredPhase();
    };

    resolveIfExpired();

    const interval = window.setInterval(() => {
      resolveIfExpired();
    }, 1000);

    return () => window.clearInterval(interval);
  }, [resolveExpiredPhase, state?.room.phase, state?.room.phase_deadline]);

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
    setShowRoomPanel(state?.room.phase === "lobby" || state?.room.phase === "ended");
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

    if (state?.room.phase !== "reveal") {
      setPendingAction((current) => (current === "advance" ? null : current));
    }
  }, [state?.room.phase]);

  useEffect(() => {
    setShowRevealDetails(false);
  }, [state?.lastEvent?.id, state?.room.phase]);

  const me = session && state ? state.players.find((player) => player.id === session.playerId) ?? null : null;
  const isLobby = state?.room.phase === "lobby";
  const inviteUrl =
    typeof window === "undefined" || !state ? "" : `${window.location.origin}/room/${state.room.code}`;
  const siteUrl = typeof window === "undefined" ? "" : window.location.origin;
  const currentNode = state?.currentNode ?? null;
  const currentChoices = useMemo(() => currentNode?.choices ?? [], [currentNode]);
  const pendingRoundContext = state?.pendingRoundContext ?? null;
  const resolvedRoundContext = state?.resolvedRoundContext ?? null;
  const revealMoment = state?.revealMoment ?? null;
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
  const spotlightLabel = resolvedRoundContext?.spotlightLabel ?? state?.lastEvent?.spotlight_label ?? null;

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
  const isTimedPhase =
    state?.room.phase === "private_input" || state?.room.phase === "voting" || state?.room.phase === "reveal";

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
      receiptHighlights: postGameArtifact.receiptHighlights.map((highlight) =>
        applySpotlightTemplate(highlight, state.events.at(-1)?.spotlight_label ?? null) ?? highlight
      ),
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
  const revealHoldComplete = state?.room.phase === "reveal" ? secondsRemaining <= 0 : false;
  const showFirstRoundTutorial =
    state?.room.round === 1 && (state.room.phase === "private_input" || state.room.phase === "voting");
  const firstRoundTutorial =
    state?.room.phase === "private_input"
      ? {
          label: "Round 1 tutorial",
          title: "Pick privately who gets spotlighted.",
          body: "Your pick is hidden. The room only finds out who got singled out once public voting starts."
        }
      : state?.room.phase === "voting"
        ? {
            label: "Round 1 tutorial",
            title: "Now vote publicly on what happens.",
            body: "The private nomination is done. Everyone can now see the public options and decide the fallout together."
          }
        : null;
  const showPrivateTutorial = state?.room.phase === "private_input" && showFirstRoundTutorial && !hasSubmittedPrivate;
  const showVotingTutorial = state?.room.phase === "voting" && showFirstRoundTutorial && !hasVoted;
  const privateSupportLine =
    !showPrivateTutorial && !hasSubmittedPrivate
      ? pendingRoundContext?.templateId === "secret_agenda"
        ? "Push one hidden agenda in private."
        : pendingRoundContext?.privateInputType === "choice_option"
          ? "Pick what you would really do."
          : "Pick who gets spotlighted."
      : null;
  const privateLockedStatus = hasSubmittedPrivate ? "Private nomination locked" : null;
  const votingContextLabel = resolvedRoundContext?.spotlightLabel
    ? "Picked"
    : resolvedRoundContext?.leadingPrivateOptionLabel
      ? "Private lean"
      : null;
  const votingContextValue = resolvedRoundContext?.spotlightLabel
    ? resolvedRoundContext.spotlightLabel
    : resolvedRoundContext?.leadingPrivateOptionLabel
      ? renderSpotlightText(resolvedRoundContext.leadingPrivateOptionLabel)
      : null;
  const voteLockedStatus = hasVoted ? "Public vote locked" : null;

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
      optimisticAction?: "start" | "rematch" | "advance";
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

    return applyTemplateFallbacks(applySpotlightTemplate(text, spotlightLabel) ?? text, {
      spotlight: spotlightLabel,
      option: resolvedRoundContext?.leadingPrivateOptionLabel ?? state?.lastEvent?.leading_private_option_label ?? null
    }) ?? text;
  }

  function renderTextWithSpotlight(text: string | null | undefined, localSpotlightLabel: string | null | undefined) {
    if (!text) {
      return "";
    }

    return applyTemplateFallbacks(applySpotlightTemplate(text, localSpotlightLabel ?? null) ?? text, {
      spotlight: localSpotlightLabel ?? null,
      option: resolvedRoundContext?.leadingPrivateOptionLabel ?? state?.lastEvent?.leading_private_option_label ?? null
    }) ?? text;
  }

  function renderPrivatePhaseText(text: string | null | undefined) {
    if (!text) {
      return "";
    }

    return applyTemplateFallbacks(text, {
      spotlight: null,
      option: pendingRoundContext?.privateOptions[0]?.label ?? null
    }) ?? text;
  }

  function renderPrivateChoiceLabel(optionId: string | null | undefined) {
    if (!optionId) {
      return "";
    }

    const optionLabel = pendingRoundContext?.privateOptions.find((option) => option.id === optionId)?.label ?? optionId;
    return renderPrivatePhaseText(optionLabel);
  }

  const revealInstigatorNames = (state?.lastEvent?.instigator_player_ids ?? []).map((playerId) => getPlayerName(playerId));
  const revealPowerHolderName = getPlayerName(state?.lastEvent?.power_holder_player_id);
  const revealPickedLabel = state?.lastEvent?.spotlight_label
    ? state.lastEvent.template_id === "prediction"
      ? "Predicted player"
      : state.lastEvent.template_id === "betrayal"
        ? "Public scapegoat"
        : "Spotlight"
    : state?.lastEvent?.template_id === "secret_agenda"
      ? "Hidden agenda"
      : "Private read";
  const revealPickedValue = state?.lastEvent?.spotlight_label
    ? state.lastEvent.spotlight_label
    : state?.lastEvent?.leading_private_option_label
      ? renderTextWithSpotlight(state.lastEvent.leading_private_option_label, state.lastEvent.spotlight_label)
      : "No consensus";
  const revealCauseValue = revealInstigatorNames.length ? revealInstigatorNames.join(", ") : "Chaos only";
  const revealOutcomeValue = state?.lastEvent
    ? renderSpotlightText(state.lastEvent.selected_choice_label)
    : "";
  const revealOutcomeDetail = state?.lastEvent
    ? renderSpotlightText(state.lastEvent.consequence_line)
    : "";
  const hasRevealDetails = Boolean(
    state?.lastEvent?.leading_private_option_label ||
      state?.lastEvent?.distribution_line ||
      state?.lastEvent?.template_id === "secret_agenda" ||
      state?.lastEvent?.result_text ||
      state?.lastEvent?.receipt_line ||
      state?.lastEvent?.power_holder_player_id
  );

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
        <section className="share-utility panel" data-testid="room-code-panel">
          <div className="share-code-block">
            <div className="section-tag">Room code</div>
            <div className="share-code-value" data-testid="room-code-value">{state.room.code}</div>
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
              {!isTimedPhase ? (
              <button className="button-ghost" onClick={() => setShowRoomPanel((current) => !current)} type="button">
                <span className="button-content">
                  {showRoomPanel ? <EyeOffIcon className="button-icon" /> : <EyeIcon className="button-icon" />}
                  <span>{showRoomPanel ? "Hide room details" : "Show room details"}</span>
                </span>
              </button>
              ) : null}
            </div>
          </div>
          <div className="room-meta">
            <span>Code {state.room.code}</span>
            <span>Round {state.room.round || 0}</span>
            <span className="meta-with-icon">
              <UsersIcon className="meta-icon" />
              <span>{playerCount} players</span>
            </span>
            {isTimedPhase ? (
              <button className="room-meta-button" onClick={() => setShowRoomPanel((current) => !current)} type="button">
                {showRoomPanel ? "Hide players" : "Players"}
              </button>
            ) : null}
          </div>
        </section>
      )}

      {!me && !waitingForPresenceRestore ? (
        <section className={`join-shell ${isLobby ? "join-lobby" : "join-inline"}`} data-testid="join-room-inline-shell">
          <div className="panel">
            <div className="section-tag">Join this room</div>
            <h2>{isLobby ? "Claim a seat" : "You are not in this room yet"}</h2>
            {state.room.phase === "lobby" ? (
              <>
                <p>Invite links drop you directly here. The only thing left is your nickname.</p>
                <label className="field">
                  <span>Nickname</span>
                  <input
                    data-testid="inline-join-name-input"
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
                  data-testid="inline-join-room-submit"
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
                <h2>Private nomination, public fallout</h2>
                <ol className="number-list">
                  <li>Pick privately who gets spotlighted.</li>
                  <li>Vote publicly on what happens next.</li>
                </ol>
                <p className="helper-text lobby-payoff-line">The reveal names who got blamed and how it landed.</p>
                {me?.is_host ? (
                  <button
                    className="button-primary lobby-start-button"
                    data-testid="start-round-button"
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
                  <p className="helper-text">Waiting for the host to start round one.</p>
                )}
              </>
            ) : null}

            {state.room.phase === "private_input" && state.currentNode ? (
              <>
                {showPrivateTutorial && firstRoundTutorial ? (
                  <section className="tutorial-banner" aria-label="Round one tutorial">
                    <p className="tutorial-banner-label">{firstRoundTutorial.label}</p>
                    <h3>{firstRoundTutorial.title}</h3>
                    <p>{firstRoundTutorial.body}</p>
                  </section>
                ) : null}
                <div className="stage-header">
                  <div>
                    <div className="section-tag">Private nomination</div>
                    <h2>{renderPrivatePhaseText(state.currentNode.prompt)}</h2>
                    {privateSupportLine ? <p className="phase-support-line">{privateSupportLine}</p> : null}
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

                <div className="choice-list" data-testid="private-choice-list">
                  {pendingRoundContext?.privateInputType === "choice_option"
                    ? pendingRoundContext.privateOptions.map((option) => {
                        const selected =
                          didPlayerSelectPrivateOption(state.privateSubmissions, me?.id, option.id) ||
                          pendingPrivateSelectionId === option.id;

                        return (
                          <button
                            key={option.id}
                            data-testid={`private-choice-${option.id}`}
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
                            data-testid={`private-choice-${player.id}`}
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
                {privateLockedStatus ? (
                  <div className="phase-status-row">
                    <span className="phase-status-chip">{privateLockedStatus}</span>
                  </div>
                ) : null}
              </>
            ) : null}

            {state.room.phase === "voting" && state.currentNode ? (
              <>
                {showVotingTutorial && firstRoundTutorial ? (
                  <section className="tutorial-banner" aria-label="Round one tutorial">
                    <p className="tutorial-banner-label">{firstRoundTutorial.label}</p>
                    <h3>{firstRoundTutorial.title}</h3>
                    <p>{firstRoundTutorial.body}</p>
                  </section>
                ) : null}
                <div className="stage-header">
                  <div>
                    <div className="section-tag">Public vote</div>
                    <h2>{renderSpotlightText(state.currentNode.prompt)}</h2>
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
                {votingContextLabel && votingContextValue && !showVotingTutorial && !hasVoted ? (
                  <div className="phase-context-strip">
                    <span>{votingContextLabel}</span>
                    <strong>{votingContextValue}</strong>
                  </div>
                ) : null}

                <div className="choice-list" data-testid="public-choice-list">
                  {state.currentNode.choices.map((choice) => {
                    const selected =
                      (me && state.votes.some((vote) => vote.player_id === me.id && vote.selected_choice_id === choice.id)) ||
                      pendingChoiceId === choice.id;
                    const liveCount = liveVoteCounts[choice.id] ?? 0;

                    return (
                      <button
                        key={choice.id}
                        data-testid={`public-choice-${choice.id}`}
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
                {voteLockedStatus ? (
                  <div className="phase-status-row">
                    <span className="phase-status-chip">{voteLockedStatus}</span>
                  </div>
                ) : null}
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
                      <span>{revealHoldComplete ? "Host controls next round" : `${secondsRemaining}s hold reveal`}</span>
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
                  data-testid="reveal-panel"
                  className={`payoff-card reveal-payoff-card ${state.lastEvent.resolution_type !== "majority" ? "payoff-card-chaos" : ""}`}
                >
                  <p className="payoff-kicker">Reveal</p>
                  <h2 className="payoff-headline" data-testid="reveal-headline">
                    {revealMoment?.headline ?? revealOutcomeValue}
                  </h2>
                  <p className="reveal-decision-line" data-testid="reveal-decision-line">
                    {revealMoment?.decisionLine ?? `Decision landed on: ${revealOutcomeValue}`}
                  </p>
                  <div className="reveal-prompt-card" data-testid="reveal-micro-prompt">
                    <span className="reveal-prompt-label">Micro-response</span>
                    <strong>{revealMoment?.promptLine ?? "Give the room your one-line defense."}</strong>
                  </div>
                  <div className="reveal-summary-grid" aria-label="Reveal summary" data-testid="reveal-summary">
                    <div className="reveal-summary-item">
                      <span className="reveal-summary-label">{revealPickedLabel}</span>
                      <strong className="reveal-summary-value">{revealPickedValue}</strong>
                    </div>
                    <div className="reveal-summary-item">
                      <span className="reveal-summary-label">Caused by</span>
                      <strong className="reveal-summary-value">{revealCauseValue}</strong>
                    </div>
                    <div className="reveal-summary-item reveal-summary-item-outcome">
                      <span className="reveal-summary-label">What happened</span>
                      <strong className="reveal-summary-value">{revealOutcomeDetail}</strong>
                    </div>
                  </div>
                  <div className="reveal-action-row">
                    {me?.is_host ? (
                      <button
                        className="button-secondary"
                        data-testid="advance-reveal-button"
                        disabled={!revealHoldComplete || pendingAction === "advance"}
                        onClick={() => postToRoom("/advance", {}, { optimisticAction: "advance" })}
                        type="button"
                      >
                        {pendingAction === "advance"
                          ? "Moving on..."
                          : !revealHoldComplete
                            ? "Hold reveal..."
                            : revealMoment?.hostAdvanceLabel ?? "Next round"}
                      </button>
                    ) : (
                      <p className="helper-text reveal-waiting-line">
                        {revealMoment?.waitingLine ?? "Waiting for the host to move on."}
                      </p>
                    )}
                  </div>
                  {hasRevealDetails ? (
                    <button
                      className="button-ghost reveal-details-toggle"
                      onClick={() => setShowRevealDetails((current) => !current)}
                      type="button"
                    >
                      {showRevealDetails ? "Hide details" : "Show details"}
                    </button>
                  ) : null}
                  {hasRevealDetails && showRevealDetails ? (
                    <div className="reveal-secondary-details" aria-label="Reveal details">
                      {state.lastEvent.leading_private_option_label ? (
                        <p className="reveal-detail-line">
                          <span>Private lean</span>
                          <strong>
                            {renderTextWithSpotlight(
                              state.lastEvent.leading_private_option_label,
                              state.lastEvent.spotlight_label
                            )}
                          </strong>
                        </p>
                      ) : null}
                      {state.lastEvent.distribution_line ? (
                        <p className="reveal-detail-line">
                          <span>Private split</span>
                          <strong>
                            {renderTextWithSpotlight(
                              state.lastEvent.distribution_line,
                              state.lastEvent.spotlight_label
                            )}
                          </strong>
                        </p>
                      ) : null}
                      {state.lastEvent.template_id === "secret_agenda" ? (
                        <p className="reveal-detail-line">
                          <span>Secret agenda</span>
                          <strong>The room carried hidden agendas into the public vote before this landed.</strong>
                        </p>
                      ) : null}
                      {state.lastEvent.result_text ? (
                        <p className="reveal-detail-line">
                          <span>Aftermath</span>
                          <strong>{renderSpotlightText(state.lastEvent.result_text)}</strong>
                        </p>
                      ) : null}
                      <p className="reveal-detail-line">
                        <span>Receipt</span>
                        <strong>{renderSpotlightText(state.lastEvent.receipt_line)}</strong>
                      </p>
                      {state.lastEvent.power_holder_player_id ? (
                        <p className="reveal-detail-line">
                          <span>Hidden power</span>
                          <strong>
                            {revealPowerHolderName}
                            {state.lastEvent.power_altered_outcome ? " broke the tie." : " held the betrayal card."}
                          </strong>
                        </p>
                      ) : null}
                    </div>
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
                      <article
                        className="artifact-card"
                        aria-label="Post-game recap card"
                        data-testid="artifact-card"
                        ref={artifactCardRef}
                      >
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
                        {displayArtifact.receiptHighlights.length ? (
                          <div className="artifact-path-block">
                            <span>Receipts</span>
                            <div className="artifact-path-steps">
                              {displayArtifact.receiptHighlights.map((highlight) => (
                                <span className="artifact-path-step" key={highlight}>
                                  <strong>{highlight}</strong>
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </article>
                      <div className="artifact-actions">
                        <button
                          className="button-secondary"
                          data-testid="share-artifact-button"
                          disabled={sharingArtifact}
                          onClick={() => void shareArtifact()}
                          type="button"
                        >
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
                        data-testid="rematch-pack-button"
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
                        data-testid="toggle-pack-picker-button"
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
                          data-testid="switch-pack-button"
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
                      <strong>{stat.valueText}</strong>
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

            <ul className="player-list" data-testid="player-list">
              {state.players.map((player) => (
                <li data-testid={`player-${player.id}`} key={player.id}>
                  <span>{player.nickname}</span>
                  <span>{player.is_host ? "host" : "crew"}</span>
                </li>
              ))}
            </ul>

            <div className="room-side-meta">
              <span>{playerCount} players live</span>
              <span>Vote timer {VOTE_DURATION_SECONDS}s</span>
              <span>Reveal hold {REVEAL_DURATION_SECONDS}s</span>
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
