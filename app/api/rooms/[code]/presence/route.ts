import { NextResponse } from "next/server";

import { updatePresence } from "@/lib/server-room";

function parsePresenceBody(rawBody: string) {
  try {
    return JSON.parse(rawBody) as {
      sessionId?: string;
      playerId?: string;
      connected?: boolean;
    };
  } catch {
    return {};
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const body = parsePresenceBody(await request.text());
    const sessionId = String(body.sessionId ?? "").trim();
    const playerId = String(body.playerId ?? "").trim();
    const connected = Boolean(body.connected);

    if (!sessionId || !playerId) {
      return NextResponse.json({ error: "Session and player are required." }, { status: 400 });
    }

    await updatePresence(code, playerId, sessionId, connected);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update presence." },
      { status: 400 }
    );
  }
}
