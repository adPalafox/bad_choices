import { NextResponse } from "next/server";

import { submitPrivateInput } from "@/lib/server-room";

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const body = await request.json();
    const sessionId = String(body.sessionId ?? "").trim();
    const playerId = String(body.playerId ?? "").trim();
    const targetPlayerId = body.targetPlayerId ? String(body.targetPlayerId).trim() : undefined;
    const optionId = body.optionId ? String(body.optionId).trim() : undefined;

    if (!sessionId || !playerId) {
      return NextResponse.json(
        { error: "Session and player are required." },
        { status: 400 }
      );
    }

    if ((targetPlayerId && optionId) || (!targetPlayerId && !optionId)) {
      return NextResponse.json(
        { error: "Submit exactly one private selection." },
        { status: 400 }
      );
    }

    await submitPrivateInput(code, playerId, sessionId, {
      targetPlayerId,
      optionId
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to submit private input." },
      { status: 400 }
    );
  }
}
