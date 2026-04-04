import { RoomPageClient } from "@/components/room-page-client";
import { getScenarioPacks } from "@/lib/content";

export default async function RoomPage({
  params
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return <RoomPageClient code={code.toUpperCase()} packs={getScenarioPacks()} />;
}
