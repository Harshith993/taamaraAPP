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
    <nav aria-label="Main" className="flex flex-wrap items-stretch font-mono text-[12.5px] font-semibold tracking-[0.06em]">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-1.5 px-3 uppercase no-underline ${active ? "bg-look text-ink" : "text-[#F6EFE0] hover:bg-white/10"}`}
          >
            {item.label}
            {item.badge ? <span className="bg-look px-1.5 text-ink">{item.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
