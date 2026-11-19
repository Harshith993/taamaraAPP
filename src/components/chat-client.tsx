"use client";

/** Chat and announcements: the parts that run in the browser. */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { acknowledgeAction, deleteMessageAction, postMessageAction, sendAnnouncementAction } from "@/app/actions/communication";
import { DocumentUpload } from "@/components/document-upload";
import { Button, Field, Notice, SelectField } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

/**
 * Keeps a conversation up to date: listens on the live stream and reloads the thread when it
 * changes; falls back to a reload every 30 s (and when the tab comes back) if the stream drops.
 */
export function LiveThread({ channelId }: { channelId: string }) {
  const router = useRouter();
  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, 150);
    };
    const connect = () => {
      source = new EventSource(`/api/v1/channels/${channelId}/stream`);
      source.addEventListener("message", refresh);
    };
    connect();
    const fallback = setInterval(() => document.visibilityState === "visible" && router.refresh(), 30_000);
    const onVisible = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      source?.close();
      clearInterval(fallback);
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [channelId, router]);
  return null;
}

/** Scrolls the newest message into view when the thread grows. */
export function ScrollToEnd({ count }: { count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [count]);
  return <div ref={ref} aria-hidden />;
}

export function Composer({ channelId }: { channelId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [fileId, setFileId] = useState<string | null>(null);
  const [attach, setAttach] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      const r = await postMessageAction(channelId, body, fileId ?? undefined);
      if (r.ok) {
        setBody("");
        setFileId(null);
        setAttach(false);
        setError(null);
        router.refresh();
      } else setError(r.error);
    });
  return (
    <form
      className="flex flex-col gap-2 border-t border-line bg-paper px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {attach && <DocumentUpload label="Photo or PDF" onChange={setFileId} />}
      <div className="flex items-end gap-2">
        <label htmlFor={`msg-${channelId}`} className="sr-only">
          Message
        </label>
        <textarea
          id={`msg-${channelId}`}
          name="body"
          rows={2}
          value={body}
          maxLength={2000}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (body.trim() || fileId) send();
            }
          }}
          placeholder="Write a message"
          className="min-h-11 flex-1 resize-y rounded-xl border border-line bg-ground px-3 py-2 text-[15px]"
        />
        {!attach && (
          <Button type="button" variant="secondary" className="min-h-11 px-3 text-[11.5px]" onClick={() => setAttach(true)} aria-label="Attach a photo or PDF">
            + File
          </Button>
        )}
        <Button type="submit" className="min-h-11 px-4 text-[12px]" disabled={pending || (!body.trim() && !fileId)}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
      {error && (
        <span role="alert" className="text-[13px] font-semibold text-now">
          {error}
        </span>
      )}
    </form>
  );
}

export function RemoveMessage({ messageId }: { messageId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void ((await deleteMessageAction(messageId)).ok && router.refresh()))}
      className="font-mono text-[10.5px] font-semibold text-ink-quiet uppercase underline-offset-2 hover:underline"
    >
      Remove
    </button>
  );
}

export function AckButton({ announcementId }: { announcementId: string }) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  if (result?.ok) return <span className="text-[13px] font-semibold text-ok-text">{result.message}</span>;
  return (
    <>
      <Button
        type="button"
        className="min-h-11 px-4 text-[12px]"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await acknowledgeAction(announcementId);
            setResult(r);
            if (r.ok) router.refresh();
          })
        }
      >
        Got it
      </Button>
      {result && !result.ok && <span className="text-[13px] font-semibold text-now">{result.error}</span>}
    </>
  );
}

export function AnnouncementForm({ audiences, bookings }: { audiences: { value: string; label: string; booking: boolean }[]; bookings: { id: string; name: string }[] }) {
  const router = useRouter();
  const [audience, setAudience] = useState(audiences[0]?.value ?? "");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const [key, setKey] = useState(0);
  const needsBooking = audiences.find((a) => a.value === audience)?.booking ?? false;
  const fe = result && !result.ok ? (result.fieldErrors ?? {}) : ({} as Record<string, string>);
  return (
    <form
      key={key}
      noValidate
      className="flex flex-col gap-2.5 px-3.5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const get = (k: string) => String(f.get(k) ?? "");
        start(async () => {
          const r = await sendAnnouncementAction({ audience: audience as "ALL_STAFF", eventId: needsBooking ? get("eventId") : "", title: get("title"), body: get("body"), needsAck: f.get("needsAck") === "on" });
          setResult(r);
          if (r.ok) {
            setKey((k) => k + 1);
            router.refresh();
          }
        });
      }}
    >
      <div className="grid gap-2.5 sm:grid-cols-2">
        <SelectField label="To" name="audience" value={audience} onChange={(e) => setAudience(e.target.value)} options={audiences} />
        {needsBooking && <SelectField label="Booking" name="eventId" options={[{ value: "", label: "Pick…" }, ...bookings.map((b) => ({ value: b.id, label: b.name }))]} error={fe.eventId} />}
      </div>
      <Field label="Title" name="title" placeholder="Sangeet: report at gate 2" error={fe.title} maxLength={120} />
      <div className="flex flex-col gap-1">
        <label htmlFor="f-ann-body" className="label-mono text-[12px]">
          Message
        </label>
        <textarea id="f-ann-body" name="body" rows={3} maxLength={2000} className="rounded-xl border border-line bg-paper px-3 py-2 text-[15px]" placeholder="Crew please report by 17:30. Wear the black T-shirt." />
        {fe.body && <span className="text-[13px] font-semibold text-now">{fe.body}</span>}
      </div>
      <label className="flex min-h-11 items-center gap-2.5 text-[14.5px]">
        <input type="checkbox" name="needsAck" className="h-5 w-5 accent-plum" />
        Ask everyone to tap “Got it”
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send announcement"}
        </Button>
        {result && <Notice tone={result.ok ? "ok" : "error"}>{result.ok ? result.message : result.error}</Notice>}
      </div>
    </form>
  );
}
