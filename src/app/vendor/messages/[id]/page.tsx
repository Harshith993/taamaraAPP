import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ThreadView } from "@/components/messages";
import { PortalShell } from "@/components/portal-shell";
import { homePathFor, requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Conversation" };

export default async function Thread({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (actor.accountType !== "VENDOR") redirect(homePathFor(actor));
  const { id } = await params;
  return (
    <PortalShell title="Messages" subtitle="Taamara Taamara · vendor">
      <ThreadView actor={actor} channelId={id} />
    </PortalShell>
  );
}
