import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MessagesHome } from "@/components/messages";
import { PortalShell } from "@/components/portal-shell";
import { homePathFor, requireActor } from "@/modules/identity/session";

export const metadata: Metadata = { title: "Messages" };

export default async function Messages() {
  const actor = await requireActor();
  if (actor.accountType !== "LABOUR") redirect(homePathFor(actor));
  return (
    <PortalShell title="Messages" subtitle="Taamara Taamara · crew" back={{ href: "/crew", label: "Home" }}>
      <MessagesHome actor={actor} />
    </PortalShell>
  );
}
