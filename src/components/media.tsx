"use client";

/** Photo and video tiles in the Cue Sheet style, with a full-screen viewer. */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { MediaView } from "@/modules/files/media";

function length(seconds: number | null) {
  if (!seconds) return "";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Re-fetches the page every few seconds while a photo or video is still being prepared. */
export function RefreshWhileProcessing({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      if (n > 60) clearInterval(t);
      router.refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}

export function MediaTile({ media, label, band }: { media: MediaView; label: string; band?: { text: string; className: string } }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const processing = media.status === "PROCESSING" || media.status === "UPLOADING";
  const failed = media.status === "FAILED";

  return (
    <figure className="flex flex-col overflow-hidden rounded-xl border border-line bg-paper">
      <button
        type="button"
        disabled={processing || failed || (!media.viewUrl && !media.originalUrl)}
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
        aria-label={`Open ${label}`}
        className="relative block aspect-[4/3] w-full bg-ground disabled:cursor-default"
      >
        {media.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed, per-person links; not for the image optimiser
          <img src={media.thumbUrl} alt={label} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="lattice-cream grid h-full w-full place-items-center p-2 text-center font-mono text-[11.5px] font-semibold tracking-[0.04em] text-ink-quiet uppercase">
            {processing ? "Preparing…" : failed ? "Couldn't use this file" : "No preview"}
          </span>
        )}
        {media.kind === "video" && !failed && (
          <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 bg-ink px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#F6EFE0]">
            <span aria-hidden="true">▶</span> {length(media.durationSeconds) || "VIDEO"}
          </span>
        )}
      </button>
      {band && <span className={`px-2 py-1 font-mono text-[11px] font-semibold tracking-[0.04em] uppercase ${band.className}`}>{band.text}</span>}
      {failed && media.error && <figcaption className="border-t border-rule-soft px-2 py-1.5 text-[12.5px] font-semibold text-now">{media.error}</figcaption>}

      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
        className="m-auto max-h-[92dvh] w-[min(96vw,1100px)] border border-line bg-ink p-0 text-[#F6EFE0] backdrop:bg-[#1C0B15]/85"
      >
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="truncate font-mono text-[12px] font-semibold tracking-[0.04em] uppercase">{label}</span>
          <span className="flex items-center gap-2">
            {media.originalUrl && (
              <a href={media.originalUrl} target="_blank" rel="noopener" className="min-h-11 content-center px-2 font-mono text-[11.5px] font-semibold text-look uppercase">
                Original
              </a>
            )}
            <button type="button" onClick={() => dialog.current?.close()} className="min-h-11 min-w-11 border border-white/40 px-3 font-mono text-[12px] font-semibold uppercase">
              Close
            </button>
          </span>
        </div>
        {open &&
          (media.kind === "video" ? (
            <video src={media.viewUrl ?? undefined} poster={media.thumbUrl ?? undefined} controls playsInline autoPlay className="max-h-[80dvh] w-full bg-black" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- signed, per-person links
            <img src={media.viewUrl ?? media.originalUrl ?? undefined} alt={label} className="mx-auto max-h-[80dvh] w-auto object-contain" />
          ))}
      </dialog>
    </figure>
  );
}
