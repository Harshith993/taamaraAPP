"use client";

/** A grid of proof items with their state, and approve / ask-to-redo for the people who check them. */
import { useState, useTransition } from "react";
import { reviewProofAction } from "@/app/actions/proof";
import { MediaTile, RefreshWhileProcessing } from "@/components/media";
import { Button } from "@/components/ui";
import { formatDate, formatTime } from "@/lib/format";
import type { ProofItem } from "@/modules/proof/service";

const BAND = {
  PENDING_REVIEW: { text: "To check", className: "bg-look text-ink" },
  APPROVED: { text: "Approved", className: "bg-ok text-ink" },
  REJECTED: { text: "Redo asked", className: "bg-now text-[#FFF6EE]" },
} as const;

const BAND_FOR_UPLOADER = { ...BAND, PENDING_REVIEW: { text: "Sent · being checked", className: "bg-look text-ink" }, REJECTED: { text: "Please redo", className: "bg-now text-[#FFF6EE]" } };

function Review({ id }: { id: string }) {
  const [mode, setMode] = useState<"idle" | "redo">("idle");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const decide = (decision: "APPROVE" | "REJECT") =>
    start(async () => {
      const r = await reviewProofAction(id, decision, note);
      setResult(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error });
    });
  if (result?.ok) return <p className="text-[13px] font-semibold text-ok-text">{result.text}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {mode === "redo" && (
        <label className="flex flex-col gap-1">
          <span className="label-mono text-[11px]">What should be redone?</span>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Left side drapes are uneven" className="rounded-xl border border-line bg-paper px-2 py-1.5 text-[13.5px]" />
        </label>
      )}
      <span className="flex flex-wrap gap-1.5">
        {mode === "idle" ? (
          <>
            <Button type="button" className="min-h-11 flex-1 px-3 text-[11.5px]" disabled={pending} onClick={() => decide("APPROVE")}>
              {pending ? "Saving…" : "Approve"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-11 flex-1 px-3 text-[11.5px]" disabled={pending} onClick={() => setMode("redo")}>
              Ask to redo
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="danger" className="min-h-11 flex-1 px-3 text-[11.5px]" disabled={pending || !note.trim()} onClick={() => decide("REJECT")}>
              {pending ? "Saving…" : "Send back"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-11 px-3 text-[11.5px]" disabled={pending} onClick={() => setMode("idle")}>
              Back
            </Button>
          </>
        )}
      </span>
      {result && !result.ok && (
        <p role="alert" className="text-[12.5px] font-semibold text-now">
          {result.text}
        </p>
      )}
    </div>
  );
}

function distance(m: number) {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

export function ProofGrid({ items, showBooking = false, showAbout = true, uploaderView = false }: { items: ProofItem[]; showBooking?: boolean; showAbout?: boolean; uploaderView?: boolean }) {
  const processing = items.some((i) => i.media.status === "PROCESSING");
  const bands = uploaderView ? BAND_FOR_UPLOADER : BAND;
  return (
    <>
      <RefreshWhileProcessing active={processing} />
      <ul className="grid grid-cols-2 gap-x-2.5 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] sm:gap-3">
        {items.map((p) => (
          <li key={p.id} className="flex flex-col gap-2">
            <MediaTile media={p.media} label={p.caption || p.about} band={bands[p.status]} />
            <div className="flex flex-col gap-0.5 text-[13px] leading-snug">
              {showAbout && <span className="text-[14px] font-bold">{p.about}</span>}
              <span className="text-ink-quiet">
                {[showBooking ? p.event.name : null, p.functionName].filter(Boolean).join(" · ")}
                {showBooking || p.functionName ? " · " : ""}
                {uploaderView && p.uploadedByMe ? "You" : p.uploadedBy}, {formatDate(p.createdAt, { day: "numeric", month: "short" })} {formatTime(p.createdAt)}
              </span>
              {p.caption && <span>“{p.caption}”</span>}
              {p.distanceFromVenue !== null && (
                <span className={`font-mono text-[11.5px] font-semibold ${p.distanceFromVenue <= 500 ? "text-ok-text" : "text-now"}`}>
                  {p.distanceFromVenue <= 500 ? "At the venue" : "Away from the venue"} · {distance(p.distanceFromVenue)}
                </span>
              )}
              {p.location && !uploaderView && (
                <a href={`https://www.google.com/maps?q=${p.location.latitude},${p.location.longitude}`} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-semibold">
                  Where it was sent from
                </a>
              )}
              {p.reviewNote && (
                <span className={p.status === "REJECTED" ? "font-semibold text-now" : ""}>
                  {p.reviewedBy ? `${p.reviewedBy}: ` : ""}
                  {p.reviewNote}
                </span>
              )}
              {p.status === "APPROVED" && !p.reviewNote && p.reviewedBy && <span className="text-ok-text">Approved by {p.reviewedBy}</span>}
            </div>
            {p.canReview && <Review id={p.id} />}
          </li>
        ))}
      </ul>
    </>
  );
}
