"use client";

import { BadgeCheck, CalendarDays, Camera, FileText, Home, IndianRupee, LayoutList, MoonStar, Receipt, Settings, Store, Users, UsersRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  badge?: number;
}

const ICONS: Record<string, LucideIcon> = {
  "/home": Home,
  "/bookings": LayoutList,
  "/calendar": CalendarDays,
  "/event-day": MoonStar,
  "/vendors": Store,
  "/roster": UsersRound,
  "/proof": Camera,
  "/money": IndianRupee,
  "/invoices": FileText,
  "/expenses": Receipt,
  "/approvals": BadgeCheck,
  "/team": Users,
  "/settings": Settings,
};

export function MainNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    // Its own row under the brand on every device; scrolls sideways if the menu is ever too long.
    <nav aria-label="Main" className="order-last -mx-4 flex w-[calc(100%+2rem)] items-center gap-1 overflow-x-auto px-4 pb-2 text-[13.5px] font-medium [scrollbar-width:none] sm:-mx-8 sm:w-[calc(100%+4rem)] sm:px-8">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = ICONS[item.href];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`group flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 whitespace-nowrap no-underline transition duration-150 ${active ? "bg-ink text-white shadow-[var(--shadow-card)]" : "text-ink-quiet hover:-translate-y-px hover:bg-white hover:text-ink hover:shadow-[var(--shadow-card)]"}`}
          >
            {Icon && <Icon aria-hidden className="size-4 transition-transform duration-200 group-hover:scale-110" />}
            {item.label}
            {item.badge ? <span className={`min-w-5 rounded-full px-1.5 text-center text-[11.5px] font-semibold ${active ? "bg-white text-ink" : "bg-pastel-rose text-[#be123c]"}`}>{item.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
