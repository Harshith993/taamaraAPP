import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";
import { LotusBadge, PetalStripe, Wordmark } from "@/components/brand";
import { MainNav, type NavItem } from "@/components/main-nav";

export type { NavItem };

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/** The plum header with lotus lattice, used by every internal page. */
export function AppHeader({ name, roleLabel, items }: { name: string; roleLabel: string; items: NavItem[] }) {
  return (
    <>
      <header className="lattice-plum text-[#F6EFE0]">
        <div className="mx-auto flex min-h-[58px] max-w-[1400px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pt-2 sm:px-8">
          <Link href="/home" className="flex items-center gap-2.5 text-[#F6EFE0] no-underline">
            <LotusBadge />
            <Wordmark />
          </Link>
          <MainNav items={items} />
          <div className="flex items-center gap-2">
            <span className="hidden text-right leading-tight sm:flex sm:flex-col">
              <span className="text-[13px] font-semibold">{name}</span>
              <span className="font-mono text-[10.5px] tracking-[0.08em] text-[#E9CFDA] uppercase">{roleLabel}</span>
            </span>
            <span aria-hidden="true" className="hidden h-11 w-11 place-items-center sm:grid rounded-full bg-ground text-[14px] font-bold text-plum">
              {initials(name)}
            </span>
            <form action={signOutAction}>
              <button type="submit" className="min-h-11 rounded-[3px] border border-white/40 px-3 font-mono text-[11.5px] font-semibold tracking-[0.06em] text-[#F6EFE0] uppercase hover:bg-white/10">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <PetalStripe />
    </>
  );
}
