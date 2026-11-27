"use client";

/**
 * Search everything (⌘K or Ctrl K, or "/" outside a text box): jump to any page in your menu, or find
 * a booking, vendor or crew member. Arrow keys move, Enter opens, Esc closes.
 */
import { ArrowRight, CalendarHeart, CornerDownLeft, Search, Store, UserRound, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchHit } from "@/modules/search/service";
import { NAV_ICONS, type NavItem } from "./nav-icons";

const KIND_ICON: Record<SearchHit["kind"], LucideIcon> = { booking: CalendarHeart, vendor: Store, crew: UserRound };
const KIND_LABEL: Record<SearchHit["kind"], string> = { booking: "Bookings", vendor: "Vendors", crew: "Crew" };

interface Row {
  key: string;
  title: string;
  detail?: string;
  href: string;
  icon: LucideIcon;
  section: string;
}

export const OPEN_SEARCH_EVENT = "tt-open-search";

export function CommandPalette({ items }: { items: NavItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setHits([]);
    (opener.current as HTMLElement | null)?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        opener.current = document.activeElement;
        setOpen(true);
      }
    };
    const onOpen = () => {
      opener.current = document.activeElement;
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  // Server search, a moment after typing stops.
  const searching = open && q.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setBusy(true);
      try {
        const r = await fetch(`/api/v1/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal });
        if (r.ok) {
          setHits(((await r.json()) as { hits: SearchHit[] }).hits);
          setIndex(0);
        }
      } catch {
        /* a newer search replaced this one */
      } finally {
        if (!ctrl.signal.aborted) setBusy(false);
      }
    }, 160);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [q, searching]);

  const rows: Row[] = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pages = items
      .filter((i) => !needle || i.label.toLowerCase().includes(needle))
      .map((i) => ({ key: `p:${i.href}`, title: i.label, detail: i.group, href: i.href, icon: NAV_ICONS[i.href] ?? ArrowRight, section: "Go to" }));
    const found = (searching ? hits : []).map((h) => ({ key: `${h.kind}:${h.id}`, title: h.title, detail: h.detail, href: h.href, icon: KIND_ICON[h.kind], section: KIND_LABEL[h.kind] }));
    return [...found, ...pages];
  }, [items, hits, q, searching]);

  const go = (row: Row | undefined) => {
    if (!row) return;
    close();
    router.push(row.href);
  };

  if (!open) return null;
  let lastSection = "";
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-[rgb(22_20_31/0.28)] px-3 pt-[max(env(safe-area-inset-top),9vh)] backdrop-blur-[2px] animate-[tt-fade-in_120ms_ease-out]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="flex max-h-[70vh] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-[0_30px_80px_-20px_rgb(22_20_31/0.45)] animate-[tt-pop_160ms_cubic-bezier(0.2,0.8,0.2,1)]">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search aria-hidden className="size-5 shrink-0 text-ink-quiet" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") return close();
              if (e.key === "ArrowDown") setIndex((i) => Math.min(rows.length - 1, i + 1));
              else if (e.key === "ArrowUp") setIndex((i) => Math.max(0, i - 1));
              else if (e.key === "Enter") go(rows[index]);
              else return;
              e.preventDefault();
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="tt-search-list"
            aria-activedescendant={rows[index] ? `tt-row-${index}` : undefined}
            placeholder="Search bookings, vendors, crew or pages"
            className="min-h-14 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-quiet"
          />
          <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 text-[11.5px] text-ink-quiet sm:block">Esc</kbd>
        </div>
        <ul id="tt-search-list" role="listbox" aria-label="Results" className="flex-1 overflow-y-auto p-2">
          {rows.length === 0 && <li className="px-3 py-8 text-center text-[14px] text-ink-quiet">{busy ? "Searching…" : "Nothing found. Try a client's name or a booking code."}</li>}
          {rows.map((r, i) => {
            const head = r.section !== lastSection ? r.section : null;
            lastSection = r.section;
            return (
              <li key={r.key} role="presentation">
                {head && <p className="px-3 pt-2.5 pb-1 text-[11.5px] font-semibold text-ink-quiet">{head}</p>}
                <button
                  id={`tt-row-${i}`}
                  role="option"
                  aria-selected={i === index}
                  type="button"
                  onMouseMove={() => setIndex(i)}
                  onClick={() => go(r)}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left ${i === index ? "bg-ground" : ""}`}
                >
                  <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${i === index ? "bg-white shadow-[var(--shadow-card)]" : "bg-ground"}`}>
                    <r.icon aria-hidden className="size-4 text-ink" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-[14.5px] font-semibold">{r.title}</span>
                    {r.detail && <span className="truncate text-[12.5px] text-ink-quiet">{r.detail}</span>}
                  </span>
                  {i === index && <CornerDownLeft aria-hidden className="size-4 text-ink-quiet" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** The search button in the top bar (and on phones). */
export function SearchButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))}
      aria-label="Search"
      className="flex min-h-11 items-center gap-2.5 rounded-full border border-line bg-white px-3.5 text-[14px] text-ink-quiet shadow-[0_1px_2px_rgb(22_20_31/0.05)] transition hover:text-ink md:min-w-[300px]"
    >
      <Search aria-hidden className="size-[18px]" />
      <span className="hidden flex-1 text-left md:block">Search bookings, vendors, crew…</span>
      <kbd className="hidden rounded-md border border-line bg-ground px-1.5 text-[11.5px] lg:block">⌘K</kbd>
    </button>
  );
}
