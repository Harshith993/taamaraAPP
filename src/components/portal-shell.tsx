import { ArrowLeft, LogOut } from "lucide-react";
import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";
import { LotusBadge, PetalStripe } from "@/components/brand";
import { PortalTabs } from "@/components/portal-tabs";

/** Phone-first shell for the vendor portal and the crew app: a glass header, the page, and a bottom tab bar. */
export function PortalShell({ title, subtitle, back, children }: { title: string; subtitle: string; back?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="lattice-plum sticky top-0 z-40 text-ink" style={{ viewTransitionName: "site-header" }}>
        <div className="mx-auto flex max-w-[720px] items-center gap-2.5 px-4 pt-[max(env(safe-area-inset-top),16px)] pb-3">
          <LotusBadge size={40} />
          <span className="flex min-w-0 flex-1 flex-col leading-none">
            <span className="font-condensed truncate text-[22px] sm:text-[26px]">{title}</span>
            <span className="mt-1 truncate text-[12px] font-medium text-ink-quiet">{subtitle}</span>
          </span>
          <form action={signOutAction}>
            <button type="submit" aria-label="Sign out" className="grid size-11 place-items-center rounded-full border border-line bg-white text-ink-quiet transition hover:-translate-y-px hover:text-ink">
              <LogOut aria-hidden className="size-[18px]" />
            </button>
          </form>
        </div>
      </header>
      <PetalStripe />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-3.5 pt-3.5 pb-[calc(env(safe-area-inset-bottom)+92px)]">
        {back && (
          <Link href={back.href} className="group mb-3 inline-flex min-h-9 items-center gap-1.5 text-[13.5px] font-medium text-ink-quiet no-underline hover:text-ink">
            <ArrowLeft aria-hidden className="size-4 transition-transform group-hover:-translate-x-1" /> {back.label}
          </Link>
        )}
        {children}
      </main>
      <PortalTabs />
    </div>
  );
}
