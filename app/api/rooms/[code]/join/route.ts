import { NextResponse } from "next/server";

import { joinRoom } from "@/lib/server-room";

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const body = await request.json();
    const nickname = String(body.nickname ?? "").trim();
    const sessionId = String(body.sessionId ?? "").trim();

    if (nickname.length < 2 || !sessionId) {
      return NextResponse.json({ error: "Nickname and session are required." }, { status: 400 });
    }

    const result = await joinRoom(code, nickname, sessionId);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to join room." },
      { status: 400 }
    );
  }
}
