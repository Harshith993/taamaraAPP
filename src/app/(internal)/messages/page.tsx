import type { Metadata } from "next";
import { MessagesHome } from "@/components/messages";
import { requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage() {
  const actor = await requireActor();
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="font-condensed text-[clamp(32px,4vw,46px)] leading-[0.95] uppercase">Messages</h1>
        <p className="mt-1 text-[15px] text-ink-quiet">Booking team chats, vendor and crew conversations, and announcements.</p>
      </div>
      <MessagesHome actor={actor} />
    </div>
  );
}
