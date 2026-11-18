"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  badge?: number;
}

export function MainNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    // Phones: its own row that scrolls sideways. iPad landscape and desktop: one line beside the logo.
    <nav aria-label="Main" className="order-last -mx-4 flex w-[calc(100%+2rem)] items-stretch overflow-x-auto px-4 font-mono text-[12.5px] font-semibold tracking-[0.06em] [scrollbar-width:none] sm:-mx-8 sm:w-[calc(100%+4rem)] sm:px-8 lg:order-none lg:mx-0 lg:w-auto lg:px-0">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-1.5 px-2.5 whitespace-nowrap uppercase no-underline xl:px-3 ${active ? "bg-look text-ink" : "text-[#F6EFE0] hover:bg-white/10"}`}
          >
            {item.label}
            {item.badge ? <span className="bg-look px-1.5 text-ink">{item.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
