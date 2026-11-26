import { CalendarHeart, Camera, Sparkles, UsersRound, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LotusBadge, PetalStripe, Wordmark } from "@/components/brand";
import { IconTile, type Tint } from "@/components/ui";
import { getActor, homePathFor } from "@/modules/identity/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const FEATURES: { icon: typeof Sparkles; tint: Tint; title: string; text: string }[] = [
  { icon: CalendarHeart, tint: "pink", title: "Every booking", text: "Functions, run sheets and the team — one page per celebration." },
  { icon: UsersRound, tint: "sky", title: "Vendors and crew", text: "Quotes, work orders, shifts and proof, straight from their phones." },
  { icon: Camera, tint: "yellow", title: "Proof from the venue", text: "Photos and videos of the work, approved before anyone is paid." },
  { icon: Wallet, tint: "green", title: "Money that settles", text: "Payments, GST and margins, closed booking by booking." },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const actor = await getActor();
  if (actor) redirect(actor.mustChangePassword ? "/set-password" : homePathFor(actor));
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-white">
      {/* A soft rainbow glow behind the glass. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-20 h-80 w-80 rounded-full bg-[#fbcfe8] opacity-60 blur-3xl" />
        <div className="absolute top-10 left-[40%] h-72 w-96 rounded-full bg-[#fde68a] opacity-40 blur-3xl" />
        <div className="absolute -top-16 right-[-6rem] h-96 w-96 rounded-full bg-[#bae6fd] opacity-60 blur-3xl" />
        <div className="absolute bottom-[-8rem] left-[20%] h-80 w-[28rem] rounded-full bg-[#ddd6fe] opacity-50 blur-3xl" />
      </div>
      <PetalStripe />

      <div className="relative mx-auto grid w-full max-w-[1200px] flex-1 items-center gap-10 px-5 py-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,420px)] lg:gap-14 lg:px-8">
        <section className="flex flex-col gap-6">
          <span className="flex items-center gap-3">
            <LotusBadge size={48} />
            <Wordmark />
          </span>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-white/70 px-3 py-1 text-[13px] font-medium text-ink-quiet shadow-[var(--shadow-card)] backdrop-blur">
            <Sparkles aria-hidden className="size-4 animate-twinkle text-[#a855f7]" /> For the Taamara Taamara team
          </span>
          <div className="flex flex-col gap-3">
            <h1 className="font-condensed text-[clamp(34px,5vw,60px)] leading-[1.02]">
              It&apos;s not a to-do list.
              <br />
              <span className="rainbow-text">It&apos;s a second brain.</span>
            </h1>
            <p className="max-w-[560px] text-[17px] leading-relaxed text-ink-quiet">
              Weddings, sangeets, birthdays — every booking, vendor, crew shift and rupee in one calm place. It&apos;s not software — it&apos;s a superpower for event day.
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="lift flex flex-col gap-2.5 rounded-[20px] border border-line bg-white/80 p-4 shadow-[var(--shadow-card)] backdrop-blur">
                <IconTile tint={f.tint}>
                  <f.icon aria-hidden className="size-5" />
                </IconTile>
                <span className="font-condensed text-[16px] font-semibold">{f.title}</span>
                <span className="text-[13.5px] leading-snug text-ink-quiet">{f.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Sign in" className="glass flex flex-col gap-5 rounded-[28px] border border-white p-6 sm:p-8">
          <div className="flex flex-col gap-1">
            <h2 className="font-condensed text-[26px]">Welcome back</h2>
            <p className="text-[14.5px] text-ink-quiet">Sign in with your mobile number or email.</p>
          </div>
          <LoginForm next={safeNext} />
          <p className="text-[13.5px] leading-relaxed text-ink-quiet">Forgot your password? Ask a host to reset it. New to the team? A host sets up your login.</p>
        </section>
      </div>
    </main>
  );
}
