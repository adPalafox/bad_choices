import { NextResponse } from "next/server";

import { rematchRoom } from "@/lib/server-room";

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const body = await request.json();
    const sessionId = String(body.sessionId ?? "").trim();
    const packId = body.packId ? String(body.packId).trim() : undefined;

    if (!sessionId) {
      return NextResponse.json({ error: "Session is required." }, { status: 400 });
    }

    await rematchRoom(code, sessionId, packId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to rematch room." },
      { status: 400 }
    );
  }
}
