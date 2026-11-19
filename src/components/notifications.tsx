/** The bell (with the unread count) and the notifications list, for every kind of login. */
import { Bell } from "lucide-react";
import Link from "next/link";
import { markAllReadAction, openNotificationAction } from "@/app/actions/notifications";
import { EmptyState, Panel } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDate, formatTime } from "@/lib/format";
import { listNotifications, notificationsPath, unreadCount } from "@/modules/notifications/inbox";
import { getActor } from "@/modules/identity/session";

export async function NotificationBell() {
  const actor = await getActor();
  if (!actor) return null;
  const n = await unreadCount(db, actor);
  return (
    <Link
      href={notificationsPath(actor)}
      aria-label={n ? `Notifications, ${n} unread` : "Notifications"}
      className="relative grid size-11 place-items-center rounded-full border border-line bg-white text-ink-quiet no-underline transition hover:-translate-y-px hover:text-ink hover:shadow-[var(--shadow-card)]"
    >
      <Bell aria-hidden className="size-[18px]" />
      {n > 0 && <span className="absolute -top-1 -right-1 min-w-5 rounded-full bg-[#f43f5e] px-1.5 text-center text-[11px] font-bold text-white ring-2 ring-white">{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}

export async function NotificationList() {
  const actor = await getActor();
  if (!actor) return null;
  const items = await listNotifications(db, actor);
  const unread = items.filter((i) => !i.readAt).length;
  return (
    <Panel
      title={`Notifications${unread ? ` · ${unread} new` : ""}`}
      action={
        unread ? (
          <form action={markAllReadAction}>
            <button type="submit" className="min-h-9 px-2 font-mono text-[11.5px] font-semibold text-plum uppercase">
              Mark all read
            </button>
          </form>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <EmptyState title="Nothing yet">Quotes, approvals, proof, bookings and reminders appear here.</EmptyState>
      ) : (
        <ul>
          {items.map((n) => (
            <li key={n.id} data-unread={n.readAt ? undefined : "true"} className={`border-b border-rule-soft last:border-b-0 ${n.readAt ? "" : "bg-look/15"}`}>
              <form action={openNotificationAction.bind(null, n.id)}>
                <button type="submit" className="grid min-h-14 w-full grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-3 px-3.5 py-2.5 text-left">
                  <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 ${n.readAt ? "" : "bg-plum"}`} />
                  <span className="flex min-w-0 flex-col leading-snug">
                    <span className={`text-[14.5px] ${n.readAt ? "" : "font-bold"}`}>{n.title}</span>
                    {n.body && <span className="text-[13px] text-ink-quiet">{n.body}</span>}
                  </span>
                  <span className="text-right font-mono text-[11.5px] text-ink-quiet">
                    {formatDate(n.createdAt, { day: "numeric", month: "short" })}
                    <br />
                    {formatTime(n.createdAt)}
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
