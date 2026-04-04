import { NextResponse } from "next/server";

import { createRoom } from "@/lib/server-room";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const hostName = String(body.hostName ?? "").trim();
    const packId = String(body.packId ?? "").trim();
    const sessionId = String(body.sessionId ?? "").trim();

    if (hostName.length < 2 || !packId || !sessionId) {
      return NextResponse.json({ error: "Host name, pack, and session are required." }, { status: 400 });
    }

    const result = await createRoom(hostName, packId, sessionId);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create room." },
      { status: 400 }
    );
  }
}
