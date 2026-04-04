import { NextResponse } from "next/server";

import { castVote } from "@/lib/server-room";

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const body = await request.json();
    const sessionId = String(body.sessionId ?? "").trim();
    const playerId = String(body.playerId ?? "").trim();
    const choiceId = String(body.choiceId ?? "").trim();

    if (!sessionId || !playerId || !choiceId) {
      return NextResponse.json({ error: "Session, player, and choice are required." }, { status: 400 });
    }

    await castVote(code, playerId, sessionId, choiceId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to submit vote." },
      { status: 400 }
    );
  }
}
