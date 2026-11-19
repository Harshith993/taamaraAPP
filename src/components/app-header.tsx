import { LogOut } from "lucide-react";
import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";
import { LotusBadge, PetalStripe, Wordmark } from "@/components/brand";
import { MainNav, type NavItem } from "@/components/main-nav";
import { MessagesButton } from "@/components/messages";
import { NotificationBell } from "@/components/notifications";

export type { NavItem };

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/** The liquid-glass header: it floats over the page, with a soft rainbow glow behind it. */
export function AppHeader({ name, roleLabel, items }: { name: string; roleLabel: string; items: NavItem[] }) {
  return (
    <div className="sticky top-0 z-40">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-10 h-40 overflow-hidden">
        <div className="absolute -top-8 left-[8%] h-36 w-72 rounded-full bg-[#fbcfe8] opacity-60 blur-3xl" />
        <div className="absolute -top-6 left-[38%] h-32 w-80 rounded-full bg-[#fde68a] opacity-50 blur-3xl" />
        <div className="absolute -top-10 right-[10%] h-36 w-72 rounded-full bg-[#bae6fd] opacity-60 blur-3xl" />
      </div>
      <header className="lattice-plum relative">
        <div className="mx-auto flex min-h-[60px] max-w-[1400px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pt-2 sm:px-8">
          <Link href="/home" className="flex items-center gap-2.5 text-ink no-underline">
            <LotusBadge />
            <Wordmark />
          </Link>
          <MainNav items={items} />
          <div className="flex items-center gap-2">
            <span className="hidden text-right leading-tight sm:flex sm:flex-col">
              <span className="text-[13.5px] font-semibold">{name}</span>
              <span className="text-[12px] text-ink-quiet">{roleLabel}</span>
            </span>
            <span aria-hidden="true" className="hidden size-10 place-items-center rounded-full rainbow-soft text-[13.5px] font-bold text-ink ring-2 ring-white shadow-[var(--shadow-card)] sm:grid">
              {initials(name)}
            </span>
            <MessagesButton />
            <NotificationBell />
            <form action={signOutAction}>
              <button type="submit" aria-label="Sign out" className="grid size-11 place-items-center rounded-full border border-line bg-white text-ink-quiet transition hover:-translate-y-px hover:text-ink hover:shadow-[var(--shadow-card)]">
                <LogOut aria-hidden className="size-[18px]" />
              </button>
            </form>
          </div>
        </div>
      </header>
      <PetalStripe height={3} />
    </div>
  );
}
