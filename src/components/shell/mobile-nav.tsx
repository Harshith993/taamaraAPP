"use client";

/** Phones: the four most used places in thumb reach, and "More" for everything else (a sheet). */
import { LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOutAction } from "@/app/actions/auth";
import { NAV_GROUPS, NAV_ICONS, type NavItem } from "./nav-icons";
import { isActive } from "./sidebar";

const PRIORITY = ["/home", "/bookings", "/approvals", "/event-day", "/calendar", "/money", "/expenses", "/vendors"];

export function MobileNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const quick = PRIORITY.map((h) => items.find((i) => i.href === h)).filter((i): i is NavItem => Boolean(i)).slice(0, 4);
  const moreActive = !quick.some((q) => isActive(pathname, q.href));

  return (
    <>
      <nav aria-label="Quick links" className="lattice-plum fixed inset-x-0 bottom-0 z-40 border-t border-line pb-[env(safe-area-inset-bottom)] md:hidden print:hidden" style={{ viewTransitionName: "app-tabs" }}>
        <ul className="grid grid-cols-5">
          {quick.map((t) => {
            const Icon = NAV_ICONS[t.href];
            const active = isActive(pathname, t.href);
            return (
              <li key={t.href}>
                <Link href={t.href} aria-current={active ? "page" : undefined} className={`relative flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11.5px] font-semibold no-underline ${active ? "text-ink" : "text-ink-quiet"}`}>
                  <span className={`grid h-8 w-12 place-items-center rounded-full transition-all duration-200 ${active ? "rainbow-soft shadow-[var(--shadow-card)]" : ""}`}>{Icon && <Icon aria-hidden className="size-5" />}</span>
                  {t.label}
                  {t.badge ? <span className="absolute top-1.5 left-[calc(50%+6px)] min-w-5 rounded-full bg-[#f43f5e] px-1.5 text-center text-[11px] leading-5 font-bold text-white ring-2 ring-white">{t.badge}</span> : null}
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setOpen(true)} aria-expanded={open} className={`flex min-h-[60px] w-full flex-col items-center justify-center gap-1 text-[11.5px] font-semibold ${moreActive ? "text-ink" : "text-ink-quiet"}`}>
              <span className={`grid h-8 w-12 place-items-center rounded-full ${moreActive ? "rainbow-soft shadow-[var(--shadow-card)]" : ""}`}>
                <Menu aria-hidden className="size-5" />
              </span>
              More
            </button>
          </li>
        </ul>
      </nav>
      {open && (
        <div className="fixed inset-0 z-[80] md:hidden" role="dialog" aria-modal="true" aria-label="All pages">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-[rgb(22_20_31/0.3)] animate-[tt-fade-in_150ms_ease-out]" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-y-auto rounded-t-[28px] bg-white px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-[0_-20px_60px_-20px_rgb(22_20_31/0.4)] animate-[tt-sheet_240ms_cubic-bezier(0.2,0.8,0.2,1)]">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line" aria-hidden />
            <div className="mb-2 flex items-center justify-between">
              <p className="font-condensed text-[20px]">All pages</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid size-10 place-items-center rounded-full bg-ground">
                <X aria-hidden className="size-5" />
              </button>
            </div>
            {NAV_GROUPS.map((g) => {
              const list = items.filter((i) => i.group === g);
              if (!list.length) return null;
              return (
                <div key={g} className="mt-3">
                  <p className="mb-1.5 text-[12px] font-semibold text-ink-quiet">{g}</p>
                  <ul className="grid grid-cols-3 gap-2">
                    {list.map((i) => {
                      const Icon = NAV_ICONS[i.href];
                      const active = isActive(pathname, i.href);
                      return (
                        <li key={i.href}>
                          <Link href={i.href} onClick={() => setOpen(false)} className={`relative flex min-h-[78px] flex-col items-center justify-center gap-1.5 rounded-2xl border text-[12.5px] font-semibold no-underline ${active ? "border-ink bg-ink text-white" : "border-line bg-ground text-ink"}`}>
                            {Icon && <Icon aria-hidden className="size-5" />}
                            {i.label}
                            {i.badge ? <span className="absolute top-1.5 right-1.5 min-w-5 rounded-full bg-[#f43f5e] px-1.5 text-center text-[11px] leading-5 font-bold text-white">{i.badge}</span> : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            <form action={signOutAction} className="mt-5">
              <button type="submit" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-line text-[14.5px] font-semibold text-ink">
                <LogOut aria-hidden className="size-[18px]" /> Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
