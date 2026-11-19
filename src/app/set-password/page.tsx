import type { Metadata } from "next";
import { LotusBadge, PetalStripe } from "@/components/brand";
import { requireActor } from "@/modules/identity/session";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Set your password" };

export default async function SetPasswordPage() {
  const actor = await requireActor({ allowPasswordChange: true });
  return (
    <main className="flex min-h-dvh flex-col bg-white">
      <div className="lattice-plum flex items-center gap-3 px-5 pt-10 pb-5 text-ink">
        <LotusBadge />
        <h1 className="font-condensed text-[30px] leading-none">{actor.mustChangePassword ? "Welcome — set your password" : "Change your password"}</h1>
      </div>
      <PetalStripe />
      <div className="flex flex-1 justify-center px-4 py-8">
        <div className="w-full max-w-[420px]">
          <SetPasswordForm firstTime={actor.mustChangePassword} />
        </div>
      </div>
    </main>
  );
}
