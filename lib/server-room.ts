import { getScenarioNode, getScenarioPack } from "@/lib/content";
import {
  canAdvanceRevealPhase,
  canResolveVotingPhase,
  createGameEventInsert,
  createRoomCode,
  getNextPhaseAfterReveal,
  getPhaseDeadline,
  MAX_PLAYERS,
  START_MIN_PLAYERS,
  REVEAL_DURATION_SECONDS,
  VOTE_DURATION_SECONDS
} from "@/lib/game";
import { getSupabaseAdminClient } from "@/lib/supabase";
import type {
  ApiRoomState,
  GameEventRecord,
  PlayerRecord,
  PublicPlayer,
  VoteRecord
} from "@/lib/types";

export async function getRoomByCode(code: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code.toUpperCase())
    .single();

  if (error || !data) {
    throw new Error("Room not found.");
  }

  return data;
}

export async function getRoomState(code: string): Promise<ApiRoomState> {
  const supabase = getSupabaseAdminClient();
  const room = await getRoomByCode(code);

  const [{ data: players, error: playerError }, { data: votes, error: voteError }, { data: events, error: eventError }] =
    await Promise.all([
      supabase
        .from("players")
        .select("*")
        .eq("room_id", room.id)
        .order("joined_at", { ascending: true })
        .returns<PlayerRecord[]>(),
      supabase
        .from("votes")
        .select("*")
        .eq("room_id", room.id)
        .eq("round", room.round)
        .returns<VoteRecord[]>(),
      supabase
        .from("game_events")
        .select("*")
        .eq("room_id", room.id)
        .order("round", { ascending: true })
        .returns<GameEventRecord[]>()
    ]);

  if (playerError || voteError || eventError) {
    throw new Error("Failed to load room state.");
  }

  const publicPlayers: PublicPlayer[] = (players ?? [])
    .filter((player) => player.connected)
    .map((player) => ({
    id: player.id,
    room_id: player.room_id,
    nickname: player.nickname,
    is_host: player.is_host,
    connected: player.connected,
    joined_at: player.joined_at
    }));

  return {
    room,
    pack: getScenarioPack(room.scenario_pack),
    players: publicPlayers,
    votes: votes ?? [],
    events: events ?? [],
    currentNode: getScenarioNode(room.scenario_pack, room.current_node_id),
    pendingNode: getScenarioNode(room.scenario_pack, room.pending_node_id),
    lastEvent: events?.at(-1) ?? null
  };
}

export async function createRoom(hostName: string, packId: string, sessionId: string) {
  const supabase = getSupabaseAdminClient();

  let code = "";

  for (let index = 0; index < 8; index += 1) {
    const candidate = createRoomCode();
    const { data } = await supabase
      .from("rooms")
      .select("id")
      .eq("code", candidate)
      .maybeSingle();

    if (!data) {
      code = candidate;
      break;
    }
  }

  if (!code) {
    throw new Error("Failed to generate a unique room code.");
  }

  getScenarioPack(packId);

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .insert({
      code,
      host_session_id: sessionId,
      status: "lobby",
      scenario_pack: packId,
      phase: "lobby",
      round: 0
    })
    .select("*")
    .single();

  if (roomError || !room) {
    throw new Error("Failed to create room.");
  }

  const { data: player, error: playerError } = await supabase
    .from("players")
    .insert({
      room_id: room.id,
      session_id: sessionId,
      nickname: hostName.trim(),
      is_host: true,
      connected: true
    })
    .select("id")
    .single();

  if (playerError || !player) {
    throw new Error("Failed to create host player.");
  }

  return {
    roomCode: code,
    playerId: player.id
  };
}

export async function joinRoom(code: string, nickname: string, sessionId: string) {
  const supabase = getSupabaseAdminClient();
  const room = await getRoomByCode(code);
  const normalizedNickname = nickname.trim();

  const { data: existingSessionPlayer } = await supabase
    .from("players")
    .select("id,nickname")
    .eq("room_id", room.id)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (existingSessionPlayer) {
    await supabase
      .from("players")
      .update({
        connected: true
      })
      .eq("id", existingSessionPlayer.id);

    return {
      playerId: existingSessionPlayer.id,
      nickname: existingSessionPlayer.nickname
    };
  }

  const { data: duplicate } = await supabase
    .from("players")
    .select("id,nickname,connected")
    .eq("room_id", room.id)
    .ilike("nickname", normalizedNickname)
    .maybeSingle();

  if (duplicate && !duplicate.connected) {
    const { data: reclaimedPlayer, error: reclaimError } = await supabase
      .from("players")
      .update({
        session_id: sessionId,
        connected: true
      })
      .eq("id", duplicate.id)
      .select("id,nickname")
      .single();

    if (reclaimError || !reclaimedPlayer) {
      throw new Error("Failed to reclaim player session.");
    }

    return {
      playerId: reclaimedPlayer.id,
      nickname: reclaimedPlayer.nickname
    };
  }

  if (room.status !== "lobby") {
    throw new Error("This room has already started.");
  }

  const { count } = await supabase
    .from("players")
    .select("*", { count: "exact", head: true })
    .eq("room_id", room.id);

  if ((count ?? 0) >= MAX_PLAYERS) {
    throw new Error("This room is full.");
  }

  if (duplicate) {
    throw new Error("Nickname is already taken in this room.");
  }

  const { data: player, error } = await supabase
    .from("players")
    .insert({
      room_id: room.id,
      session_id: sessionId,
      nickname: normalizedNickname,
      is_host: false,
      connected: true
    })
    .select("id")
    .single();

  if (error || !player) {
    throw new Error("Failed to join room.");
  }

  return {
    playerId: player.id,
    nickname: normalizedNickname
  };
}

export async function updatePresence(code: string, playerId: string, sessionId: string, connected: boolean) {
  const supabase = getSupabaseAdminClient();
  const room = await getRoomByCode(code);

  const { data: player, error } = await supabase
    .from("players")
    .update({
      connected
    })
    .eq("id", playerId)
    .eq("room_id", room.id)
    .eq("session_id", sessionId)
    .select("id")
    .maybeSingle();

  if (error || !player) {
    throw new Error("Failed to update player presence.");
  }
}

export async function startRoom(code: string, sessionId: string) {
  const supabase = getSupabaseAdminClient();
  const room = await getRoomByCode(code);

  if (room.host_session_id !== sessionId) {
    throw new Error("Only the host can start this room.");
  }

  const { data: players } = await supabase
    .from("players")
    .select("*")
    .eq("room_id", room.id)
    .returns<PlayerRecord[]>();

  if ((players?.length ?? 0) < START_MIN_PLAYERS) {
    throw new Error(`Need at least ${START_MIN_PLAYERS} players to start.`);
  }

  const pack = getScenarioPack(room.scenario_pack);

  const { error } = await supabase
    .from("rooms")
    .update({
      status: "active",
      phase: "voting",
      round: 1,
      current_node_id: pack.startNodeId,
      pending_node_id: null,
      phase_deadline: getPhaseDeadline(VOTE_DURATION_SECONDS)
    })
    .eq("id", room.id);

  if (error) {
    throw new Error("Failed to start room.");
  }
}

export async function castVote(code: string, playerId: string, sessionId: string, choiceId: string) {
  const supabase = getSupabaseAdminClient();
  const state = await getRoomState(code);

  if (state.room.phase !== "voting" || state.room.status !== "active" || !state.currentNode) {
    throw new Error("Voting is closed.");
  }

  const { data: player } = await supabase
    .from("players")
    .select("*")
    .eq("id", playerId)
    .eq("room_id", state.room.id)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (!player) {
    throw new Error("Player session is invalid.");
  }

  const choice = state.currentNode.choices.find((entry) => entry.id === choiceId);

  if (!choice) {
    throw new Error("Choice does not exist.");
  }

  const { error } = await supabase.from("votes").upsert(
    {
      room_id: state.room.id,
      player_id: playerId,
      round: state.room.round,
      node_id: state.currentNode.id,
      selected_choice_id: choiceId
    },
    {
      onConflict: "room_id,player_id,round,node_id"
    }
  );

  if (error) {
    throw new Error("Failed to cast vote.");
  }

  await resolveRoom(code);
}

export async function rematchRoom(code: string, sessionId: string, packId?: string) {
  const supabase = getSupabaseAdminClient();
  const room = await getRoomByCode(code);

  if (room.host_session_id !== sessionId) {
    throw new Error("Only the host can rematch.");
  }

  if (packId) {
    getScenarioPack(packId);
  }

  await Promise.all([
    supabase.from("votes").delete().eq("room_id", room.id),
    supabase.from("game_events").delete().eq("room_id", room.id)
  ]);

  const { error } = await supabase
    .from("rooms")
    .update({
      status: "lobby",
      phase: "lobby",
      round: 0,
      scenario_pack: packId ?? room.scenario_pack,
      current_node_id: null,
      pending_node_id: null,
      phase_deadline: null
    })
    .eq("id", room.id);

  if (error) {
    throw new Error("Failed to reset room.");
  }
}

export async function resolveRoom(code: string) {
  const supabase = getSupabaseAdminClient();
  const state = await getRoomState(code);

  if (state.room.phase === "voting") {
    if (!canResolveVotingPhase(state.room, state.players, state.votes)) {
      return;
    }

    const insert = createGameEventInsert(state.room, state.votes);

    const [{ error: eventError }, { error: roomError }] = await Promise.all([
      supabase.from("game_events").upsert(insert, { onConflict: "room_id,round" }),
      supabase
        .from("rooms")
        .update({
          phase: "reveal",
          pending_node_id: insert.next_node_id,
          phase_deadline: getPhaseDeadline(REVEAL_DURATION_SECONDS)
        })
        .eq("id", state.room.id)
    ]);

    if (eventError || roomError) {
      throw new Error("Failed to resolve voting round.");
    }

    return;
  }

  if (state.room.phase === "reveal" && state.lastEvent && canAdvanceRevealPhase(state.room)) {
    const nextState = getNextPhaseAfterReveal(state.room, state.lastEvent);

    const { error } = await supabase
      .from("rooms")
      .update({
        status: nextState.status,
        phase: nextState.phase,
        round: nextState.round,
        current_node_id: nextState.currentNodeId,
        pending_node_id: nextState.pendingNodeId,
        phase_deadline: nextState.phaseDeadline
      })
      .eq("id", state.room.id);

    if (error) {
      throw new Error("Failed to advance room state.");
    }

    if (nextState.phase === "voting") {
      await supabase
        .from("votes")
        .delete()
        .eq("room_id", state.room.id)
        .eq("round", state.room.round);
    }
  }
}
