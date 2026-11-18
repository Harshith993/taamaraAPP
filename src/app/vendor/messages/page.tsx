import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MessagesHome } from "@/components/messages";
import { PortalShell } from "@/components/portal-shell";
import { homePathFor, requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Messages" };

export default async function Messages() {
  const actor = await requireActor();
  if (actor.accountType !== "VENDOR") redirect(homePathFor(actor));
  return (
    <PortalShell title="Messages" subtitle="Taamara Taamara · vendor" back={{ href: "/vendor", label: "Home" }}>
      <MessagesHome actor={actor} />
    </PortalShell>
  );
}
