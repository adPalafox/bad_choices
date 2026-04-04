import { NextResponse } from "next/server";

import { resolveRoom } from "@/lib/server-room";

export async function POST(_: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    await resolveRoom(code);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to resolve room." },
      { status: 400 }
    );
  }
}
