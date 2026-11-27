"use client";

/**
 * The staff menu: a grouped sidebar on laptops and iPad landscape (≥ 1024 px), an icon rail on iPad
 * portrait (768–1023 px). On phones the bottom bar (mobile-nav.tsx) takes over. aria-label "Main".
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LotusBadge, Wordmark } from "@/components/brand";
import { NAV_GROUPS, NAV_ICONS, type NavItem } from "./nav-icons";

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ items, name, roleLabel }: { items: NavItem[]; name: string; roleLabel: string }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-[#fbfbfd] md:flex print:hidden" style={{ viewTransitionName: "site-sidebar" }}>
      <Link href="/home" className="flex items-center gap-2.5 px-4 pt-[max(env(safe-area-inset-top),18px)] pb-4 [@media(max-height:900px)]:pb-3 text-ink no-underline lg:px-5">
        <LotusBadge size={38} />
        <span className="hidden lg:block">
          <Wordmark />
        </span>
      </Link>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2.5 pb-4 [scrollbar-width:thin] lg:px-3">
        {NAV_GROUPS.map((g) => {
          const list = items.filter((i) => i.group === g);
          if (!list.length) return null;
          return (
            <div key={g} className="mt-3 first:mt-0 [@media(max-height:900px)]:mt-2">
              <p className="mb-1 hidden px-3 text-[11.5px] font-semibold tracking-wide text-ink-quiet lg:block">{g}</p>
              <div className="mx-auto mb-1 h-px w-8 bg-line lg:hidden" aria-hidden />
              <ul className="flex flex-col gap-0.5">
                {list.map((item) => {
                  const active = isActive(pathname, item.href);
                  const Icon = NAV_ICONS[item.href];
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        title={item.label}
                        className={`group relative flex min-h-10 items-center [@media(max-height:900px)]:min-h-9 justify-center gap-2.5 rounded-xl px-3 text-[14px] font-medium no-underline transition-colors duration-150 lg:justify-start ${
                          active ? "bg-white text-ink shadow-[0_1px_2px_rgb(22_20_31/0.06),0_0_0_1px_var(--color-line)]" : "text-ink-quiet hover:bg-white/70 hover:text-ink"
                        }`}
                      >
                        {active && <span aria-hidden className="rainbow absolute top-2 bottom-2 left-0 w-[3px] rounded-full" />}
                        {Icon && <Icon aria-hidden className={`size-[18px] shrink-0 ${active ? "text-plum" : ""}`} />}
                        <span className="sr-only lg:not-sr-only lg:flex-1 lg:truncate">{item.label}</span>
                        {item.badge ? (
                          <span className="absolute top-1 right-1 min-w-5 rounded-full bg-[#f43f5e] px-1.5 text-center text-[11px] leading-5 font-semibold text-white lg:static lg:bg-pastel-rose lg:text-[#be123c]">{item.badge}</span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="hidden items-center gap-2.5 border-t border-line px-4 py-3 lg:flex [@media(max-height:860px)]:lg:hidden">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full rainbow-soft text-[12.5px] font-bold text-ink ring-2 ring-white">
          {name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((p) => p[0]?.toUpperCase())
            .join("")}
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[13.5px] font-semibold">{name}</span>
          <span className="truncate text-[12px] text-ink-quiet">{roleLabel}</span>
        </span>
      </div>
    </aside>
  );
}
