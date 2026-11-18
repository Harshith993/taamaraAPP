import { redirect } from "next/navigation";
import { getActor, homePathFor } from "@/modules/identity/session";

/** Sends each person to their own home: internal staff, vendor portal or crew app. */
export default async function Root() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/set-password");
  redirect(homePathFor(actor));
}
