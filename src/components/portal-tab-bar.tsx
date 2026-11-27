"use client";

import { Bell, Briefcase, CalendarCheck, MessageCircle, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS = { jobs: Briefcase, today: CalendarCheck, messages: MessageCircle, alerts: Bell, profile: UserRound } as const;

export interface PortalTab {
  href: string;
  label: string;
  /** Accessible name when it differs from the label (unread counts are added to it). */
  aria?: string;
  icon: keyof typeof ICONS;
  count?: number;
  /** Active only on this exact path (the home tab), not on pages under it. */
  exact?: boolean;
}

export function PortalTabBar({ tabs }: { tabs: PortalTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className="lattice-plum fixed inset-x-0 bottom-0 z-40 border-t border-line pb-[env(safe-area-inset-bottom)]" style={{ viewTransitionName: "portal-tabs" }}>
      <ul className="mx-auto grid max-w-[720px] grid-cols-4">
        {tabs.map((t) => {
          const Icon = ICONS[t.icon];
          const active = t.exact ? pathname === t.href || (t.href === "/vendor" && pathname.startsWith("/vendor/jobs")) : pathname === t.href || pathname.startsWith(`${t.href}/`);
          const name = t.aria ?? t.label;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                aria-label={t.count ? `${name}, ${t.count} unread` : name}
                className={`relative flex min-h-[60px] flex-col items-center justify-center gap-1 text-[12px] font-semibold no-underline transition-colors ${active ? "text-ink" : "text-ink-quiet hover:text-ink"}`}
              >
                <span className={`grid h-8 w-14 place-items-center rounded-full transition-all duration-200 ${active ? "rainbow-soft shadow-[var(--shadow-card)]" : ""}`}>
                  <Icon aria-hidden className={`size-[21px] transition-transform duration-200 ${active ? "scale-110" : ""}`} />
                </span>
                {t.label}
                {t.count ? <span className="absolute top-1.5 left-[calc(50%+8px)] min-w-5 rounded-full bg-[#f43f5e] px-1.5 text-center text-[11px] leading-5 font-bold text-white ring-2 ring-white">{t.count > 99 ? "99+" : t.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
