import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LotusMark, PetalStripe } from "@/components/brand";
import { getActor, homePathFor } from "@/modules/identity/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const actor = await getActor();
  if (actor) redirect(actor.mustChangePassword ? "/set-password" : homePathFor(actor));
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <main className="flex min-h-dvh flex-col">
      <div className="lattice-plum flex flex-col items-center gap-3 px-6 pt-14 pb-10 text-[#F6EFE0]">
        <span className="grid h-24 w-24 place-items-center rounded-full bg-ground">
          <LotusMark width={70} />
        </span>
        <h1 className="font-condensed text-center text-[38px] leading-none tracking-[0.02em]">TAAMARA TAAMARA</h1>
        <p className="font-mono text-[11.5px] font-medium tracking-[0.24em] text-[#E9CFDA]">EVENTS &amp; BEYOND</p>
      </div>
      <PetalStripe />
      <div className="flex flex-1 justify-center px-4 py-8">
        <div className="w-full max-w-[400px]">
          <LoginForm next={safeNext} />
          <p className="mt-6 text-center text-[13.5px] text-ink-quiet">
            Forgot your password? Ask a host to reset it. New to the team? A host sets up your login.
          </p>
        </div>
      </div>
    </main>
  );
}
