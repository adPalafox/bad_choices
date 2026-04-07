import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required e2e env variable: ${name}`);
  }

  return value;
}

let adminClient: SupabaseClient | null = null;

function getAdminClient() {
  if (!adminClient) {
    adminClient = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: {
        persistSession: false
      }
    });
  }

  return adminClient;
}

export async function resetDatabase() {
  const tables = ["game_events", "votes", "private_submissions", "players", "rooms"] as const;
  const admin = getAdminClient();

  for (const table of tables) {
    const { error } = await admin.from(table).delete().not("id", "is", null);

    if (error) {
      throw new Error(`Failed to reset ${table}: ${error.message}`);
    }
  }
}

export async function getRoomByCode(code: string) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("rooms")
    .select("*")
    .eq("code", code.toUpperCase())
    .single();

  if (error || !data) {
    throw new Error(`Failed to load room ${code}: ${error?.message ?? "missing row"}`);
  }

  return data;
}

export async function getRoomSnapshot(code: string) {
  const room = await getRoomByCode(code);
  const admin = getAdminClient();
  const [{ data: players, error: playerError }, { data: events, error: eventError }] = await Promise.all([
    admin.from("players").select("*").eq("room_id", room.id).order("joined_at", { ascending: true }),
    admin.from("game_events").select("*").eq("room_id", room.id).order("round", { ascending: true })
  ]);

  if (playerError || eventError) {
    throw new Error(playerError?.message ?? eventError?.message ?? "Failed to fetch room snapshot.");
  }

  return {
    room,
    players: players ?? [],
    events: events ?? []
  };
}

export async function expireCurrentPhase(code: string) {
  const room = await getRoomByCode(code);
  const admin = getAdminClient();
  const { error } = await admin
    .from("rooms")
    .update({
      phase_deadline: new Date(Date.now() - 1000).toISOString()
    })
    .eq("id", room.id);

  if (error) {
    throw new Error(`Failed to expire phase for ${code}: ${error.message}`);
  }
}
