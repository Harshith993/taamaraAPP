import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";
import { LotusBadge, PetalStripe } from "@/components/brand";
import { NotificationBell } from "@/components/notifications";

/** Phone-first shell for the vendor portal and the crew app. */
export function PortalShell({ title, subtitle, back, children }: { title: string; subtitle: string; back?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="lattice-plum text-[#F6EFE0]">
        <div className="mx-auto flex max-w-[720px] items-center gap-2.5 px-4 pt-[max(env(safe-area-inset-top),16px)] pb-3">
          <LotusBadge size={40} />
          <span className="flex min-w-0 flex-1 flex-col leading-none">
            <span className="font-condensed truncate text-[26px] uppercase">{title}</span>
            <span className="mt-1 font-mono text-[10.5px] font-medium tracking-[0.14em] text-[#F0D9E3] uppercase">{subtitle}</span>
          </span>
          <NotificationBell />
          <form action={signOutAction}>
            <button type="submit" className="min-h-11 rounded-[3px] border border-white/40 px-3 font-mono text-[11px] font-semibold tracking-[0.06em] text-[#F6EFE0] uppercase">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <PetalStripe />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-3.5 pt-3.5 pb-[max(env(safe-area-inset-bottom),24px)]">
        {back && (
          <Link href={back.href} className="label-mono mb-3 inline-flex min-h-9 items-center text-[12px] no-underline">
            ← {back.label}
          </Link>
        )}
        {children}
      </main>
    </div>
  );
}
