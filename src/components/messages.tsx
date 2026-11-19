/** Messages for every kind of login: the header button, the conversations list, a thread, announcements. */
import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AckButton, AnnouncementForm, Composer, LiveThread, RemoveMessage, ScrollToEnd } from "@/components/chat-client";
import { EmptyState, Panel, Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { formatDate, formatTime } from "@/lib/format";
import { announceableBookings, AUDIENCE_LABELS, AUDIENCES, COMPANY_WIDE, listAnnouncements, type AnnouncementItem } from "@/modules/communication/announcements";
import { listChannels, messagesBase, readThread, unreadTotal } from "@/modules/communication/chat";
import type { Actor } from "@/modules/identity/actor";
import { can, scopeOf } from "@/modules/identity/policy";
import { getActor } from "@/modules/identity/session";

export async function MessagesButton() {
  const actor = await getActor();
  if (!actor) return null;
  const n = await unreadTotal(db, actor);
  return (
    <Link
      href={messagesBase(actor.accountType)}
      aria-label={n ? `Messages, ${n} unread` : "Messages"}
      className="relative grid size-11 place-items-center rounded-full border border-line bg-white text-ink-quiet no-underline transition hover:-translate-y-px hover:text-ink hover:shadow-[var(--shadow-card)]"
    >
      <MessageCircle aria-hidden className="size-[18px]" />
      {n > 0 && <span className="absolute -top-1 -right-1 min-w-5 rounded-full bg-[#f43f5e] px-1.5 text-center text-[11px] font-bold text-white ring-2 ring-white">{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}

const KIND_LABEL = { BOOKING_TEAM: "Team", VENDOR_THREAD: "Vendor", CREW: "Crew" } as const;

function when(d: Date) {
  const today = new Date().toDateString() === d.toDateString();
  return today ? formatTime(d) : formatDate(d, { day: "numeric", month: "short" });
}

export function AnnouncementCard({ a }: { a: AnnouncementItem }) {
  return (
    <li className={`flex flex-col gap-1.5 border-b border-rule-soft px-3.5 py-3 last:border-b-0 ${a.waitingForMe ? "bg-[#F2C14E1A]" : ""}`}>
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[15.5px] font-bold">{a.title}</span>
        <span className="label-mono text-[11px] text-ink-quiet">
          {a.from ? `${a.from} · ` : ""}
          {formatDate(a.createdAt, { day: "numeric", month: "short" })} {formatTime(a.createdAt)}
        </span>
      </span>
      <p className="text-[14.5px] whitespace-pre-line">{a.body}</p>
      <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-quiet">
        <Tag tone="quiet">{a.audienceLabel.toUpperCase()}</Tag>
        {a.event && <span>{a.event.name}</span>}
        {a.ackedByMe && <span className="font-semibold text-ok-text">You confirmed</span>}
      </span>
      {a.progress && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-semibold">
            {a.progress.acked} of {a.progress.recipients} confirmed
          </summary>
          {a.progress.waiting.length > 0 ? <p className="mt-1 text-ink-quiet">Waiting for: {a.progress.waiting.join(", ")}</p> : <p className="mt-1 text-ok-text">Everyone has confirmed.</p>}
        </details>
      )}
      {a.waitingForMe && (
        <span className="flex items-center gap-2">
          <AckButton announcementId={a.id} />
        </span>
      )}
    </li>
  );
}

/** Announcements waiting for this person's "Got it", for home screens. Renders nothing when none. */
export async function WaitingAnnouncements({ actor }: { actor: Actor }) {
  const items = await listAnnouncements(db, actor, { onlyWaiting: true, days: 30 });
  if (items.length === 0) return null;
  return (
    <Panel title={`Please read · ${items.length}`}>
      <ul>
        {items.map((a) => (
          <AnnouncementCard key={a.id} a={a} />
        ))}
      </ul>
    </Panel>
  );
}

export async function MessagesHome({ actor }: { actor: Actor }) {
  const base = messagesBase(actor.accountType);
  const [channels, announcements, bookings] = await Promise.all([listChannels(db, actor), listAnnouncements(db, actor), announceableBookings(db, actor)]);
  const sends = actor.accountType === "INTERNAL" && can(actor, "announcements.send");
  const everyone = scopeOf(actor, "announcements.send") === "ALL";
  const audiences = AUDIENCES.filter((a) => everyone || !COMPANY_WIDE.includes(a)).map((a) => ({ value: a, label: AUDIENCE_LABELS[a], booking: !COMPANY_WIDE.includes(a) }));
  return (
    <div className="flex flex-col gap-4">
      <Panel title={`Conversations · ${channels.length}`}>
        {channels.length === 0 ? (
          <EmptyState title="No conversations yet">
            {actor.accountType === "INTERNAL" ? "Start one from a booking: Team chat, Crew chat, or Message on a vendor." : actor.accountType === "VENDOR" ? "Message the team from one of your jobs." : "Open the crew chat from Today."}
          </EmptyState>
        ) : (
          <ul>
            {channels.map((c) => (
              <li key={c.id} className="border-b border-rule-soft last:border-b-0">
                <Link href={`${base}/${c.id}`} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 text-ink no-underline hover:bg-ground">
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className={`truncate ${c.unread ? "font-bold" : "font-semibold"}`}>
                      <span className="label-mono mr-1.5 text-[10.5px] text-plum">{KIND_LABEL[c.type]}</span>
                      {c.name}
                    </span>
                    <span className="truncate text-[13px] text-ink-quiet">{c.last ? `${c.last.mine ? "You" : c.last.from ?? ""}: ${c.last.body}` : "No messages yet"}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    {c.last && <span className="label-mono text-[11px] text-ink-quiet">{when(c.last.at)}</span>}
                    {c.unread > 0 && (
                      <span className="min-w-6 bg-look px-1.5 text-center font-mono text-[11.5px] font-bold" aria-label={`${c.unread} unread`}>
                        {c.unread}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Announcements · ${announcements.length}`}>
        {announcements.length === 0 ? (
          <EmptyState title="No announcements in the last two months" />
        ) : (
          <ul>
            {announcements.map((a) => (
              <AnnouncementCard key={a.id} a={a} />
            ))}
          </ul>
        )}
      </Panel>

      {sends && (bookings.length > 0 || everyone) && (
        <Panel title="Send an announcement">
          <AnnouncementForm audiences={audiences} bookings={bookings} />
        </Panel>
      )}
    </div>
  );
}

export async function ThreadView({ actor, channelId }: { actor: Actor; channelId: string }) {
  let t;
  try {
    t = await readThread(db, actor, channelId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const base = messagesBase(actor.accountType);
  const dayOf = (d: Date) => formatDate(d, { weekday: "short", day: "numeric", month: "short" });
  const days = t.messages.map((m) => dayOf(m.at));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={base} className="label-mono text-[12px]">
          ← All messages
        </Link>
        {t.event && actor.accountType === "INTERNAL" && (
          <Link href={`/bookings/${t.event.id}`} className="label-mono text-[12px]">
            Open booking →
          </Link>
        )}
      </div>
      <section aria-label={t.name} className="flex flex-col rounded-2xl shadow-[var(--shadow-card)] border border-line bg-paper">
        <h1 className="border-b border-line px-3.5 py-2.5 font-mono text-[13px] font-semibold tracking-[0.08em] uppercase">
          <span className="text-plum">{KIND_LABEL[t.type]}</span> · {t.name}
        </h1>
        <LiveThread channelId={t.id} />
        <ol className="flex max-h-[62dvh] min-h-[240px] flex-col gap-2 overflow-y-auto px-3 py-3" aria-live="polite">
          {t.messages.length === 0 && <li className="m-auto text-[14px] text-ink-quiet">No messages yet. Say hello.</li>}
          {t.messages.map((m, i) => {
            const day = days[i];
            const showDay = i === 0 || day !== days[i - 1];
            return (
              <li key={m.id} className="flex flex-col">
                {showDay && <span className="label-mono my-1 self-center text-[10.5px] text-ink-quiet">{day}</span>}
                <div className={`max-w-[85%] rounded-xl border px-3 py-2 ${m.mine ? "self-end border-plum bg-[#7A1F4D12]" : "self-start border-line bg-ground"}`}>
                  {!m.mine && (
                    <span className="block text-[12px] font-bold text-plum">
                      {m.from?.name ?? "Someone"}
                      {m.from?.kind === "VENDOR" ? " · vendor" : m.from?.kind === "LABOUR" ? " · crew" : ""}
                    </span>
                  )}
                  {m.deleted ? <span className="text-[13.5px] text-ink-quiet italic">Message removed</span> : m.body && <p className="text-[15px] break-words whitespace-pre-line">{m.body}</p>}
                  {m.attachments.map((f) => (
                    <div key={f.fileId} className="mt-1.5 max-w-[260px]">
                      {f.kind === "photo" && f.originalUrl ? (
                        <a href={f.originalUrl} target="_blank" rel="noopener" aria-label={`Open ${f.filename}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- signed, per-person links */}
                          <img src={f.originalUrl} alt={f.filename} loading="lazy" className="max-h-60 w-full rounded-lg border border-line object-cover" />
                        </a>
                      ) : (
                        <a href={f.originalUrl ?? undefined} target="_blank" rel="noopener" className="font-mono text-[13px] font-semibold">
                          {f.filename}
                        </a>
                      )}
                    </div>
                  ))}
                  <span className="mt-0.5 flex items-center justify-end gap-2">
                    {m.canDelete && <RemoveMessage messageId={m.id} />}
                    <span className="font-mono text-[10.5px] text-ink-quiet">{formatTime(m.at)}</span>
                  </span>
                </div>
              </li>
            );
          })}
          <li>
            <ScrollToEnd count={t.messages.length} />
          </li>
        </ol>
        <Composer channelId={t.id} />
      </section>
    </div>
  );
}
