import { LogOut } from "lucide-react";
import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";
import { LotusBadge, Wordmark } from "@/components/brand";
import { MessagesButton } from "@/components/messages";
import { NotificationBell } from "@/components/notifications";
import { SearchButton } from "@/components/shell/command-palette";

/**
 * The staff top bar: glass, slim and quiet. The brand shows here only on phones (the sidebar carries
 * it on larger screens); search, messages, the bell and sign-out sit on the right.
 */
export function AppHeader() {
  return (
    <header className="lattice-plum sticky top-0 z-40 border-b border-line print:hidden" style={{ viewTransitionName: "site-header" }}>
      <div className="flex min-h-[60px] items-center gap-2 px-4 pt-[env(safe-area-inset-top)] sm:px-6 lg:px-8">
        <Link href="/home" className="mr-auto flex min-w-0 items-center gap-2.5 text-ink no-underline md:hidden">
          <LotusBadge size={36} />
          <Wordmark withTagline={false} />
        </Link>
        <div className="md:mr-auto">
          <SearchButton />
        </div>
        <MessagesButton />
        <NotificationBell />
        {/* On phones sign-out lives in the bottom bar's "More" sheet, to keep this bar uncluttered. */}
        <form action={signOutAction} className="hidden md:block">
          <button type="submit" aria-label="Sign out" className="grid size-11 place-items-center rounded-full border border-line bg-white text-ink-quiet transition hover:text-ink hover:shadow-[var(--shadow-card)]">
            <LogOut aria-hidden className="size-[18px]" />
          </button>
        </form>
      </div>
    </header>
  );
}
