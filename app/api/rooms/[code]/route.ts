import { NextResponse } from "next/server";

import { getRoomState, sanitizeRoomStateForClient } from "@/lib/server-room";

export async function GET(_: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const state = await getRoomState(code);

    return NextResponse.json(sanitizeRoomStateForClient(state));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load room." },
      { status: 404 }
    );
  }
}
