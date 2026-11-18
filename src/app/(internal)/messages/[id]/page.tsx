import type { Metadata } from "next";
import { ThreadView } from "@/components/messages";
import { requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Conversation" };

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  return (
    <div className="max-w-3xl">
      <ThreadView actor={actor} channelId={id} />
    </div>
  );
}
