"use client";

/**
 * "Add proof" for vendors, crew and staff: take a photo or record a video (or pick from the gallery
 * when the owners allow it), watch it upload, add a note, send. Uploads start as soon as a file is
 * picked, one at a time, and carry on through patchy venue networks.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { addProofAction } from "@/app/actions/proof";
import { Button, Notice } from "@/components/ui";
import { discardUpload, preparePhoto, uploadFile, videoDuration } from "@/lib/upload-client";
import type { ProofTargetKind } from "@/modules/proof/service";

type Phase = "queued" | "preparing" | "uploading" | "waiting" | "done" | "failed";

interface Item {
  key: number;
  name: string;
  kind: "photo" | "video";
  phase: Phase;
  progress: number;
  preview: string | null;
  fileId?: string;
  error?: string;
}

const PHASE_WORDS: Record<Phase, string> = {
  queued: "Waiting",
  preparing: "Preparing",
  uploading: "Uploading",
  waiting: "No signal · will carry on",
  done: "Ready to send",
  failed: "Not uploaded",
};

function describe(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m} min${s ? ` ${s} s` : ""}` : `${s} s`;
}

export function ProofUploader({
  target,
  allowGallery,
  maxVideoSeconds,
  prompt = "Photos or a short video of the finished work.",
  night = false,
}: {
  target: { kind: ProofTargetKind; id: string };
  allowGallery: boolean;
  maxVideoSeconds: number;
  prompt?: string;
  night?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [caption, setCaption] = useState("");
  const [shareLocation, setShareLocation] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const nextKey = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const aborts = useRef(new Map<number, AbortController>());
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  const patch = (key: number, p: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  useEffect(() => {
    const controllers = aborts.current;
    return () => controllers.forEach((c) => c.abort());
  }, []);

  async function runOne(key: number, file: File, kind: "photo" | "video") {
    const ctl = new AbortController();
    aborts.current.set(key, ctl);
    try {
      let toSend = file;
      patch(key, { phase: "preparing" });
      if (kind === "video") {
        const d = await videoDuration(file);
        if (d !== null && d > maxVideoSeconds + 1) {
          patch(key, { phase: "failed", error: `This video is ${describe(d)}. Videos can be up to ${describe(maxVideoSeconds)}.` });
          return;
        }
      } else {
        toSend = await preparePhoto(file);
      }
      patch(key, { phase: "uploading", progress: 0 });
      const done = await uploadFile(toSend, "PROOF", {
        signal: ctl.signal,
        onProgress: (p) => patch(key, { phase: p.waiting ? "waiting" : "uploading", progress: p.total ? p.sent / p.total : 0 }),
      });
      patch(key, { phase: "done", progress: 1, fileId: done.id });
    } catch (err) {
      if (ctl.signal.aborted) return;
      patch(key, { phase: "failed", error: err instanceof Error ? err.message : "Upload failed." });
    } finally {
      aborts.current.delete(key);
    }
  }

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setMessage(null);
    const added: Item[] = [];
    for (const file of Array.from(list).slice(0, 12)) {
      const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name) ? "photo" : null;
      const key = nextKey.current++;
      if (!kind) {
        added.push({ key, name: file.name, kind: "photo", phase: "failed", progress: 0, preview: null, error: "Only photos and videos can be sent as proof." });
        continue;
      }
      const preview = kind === "photo" ? URL.createObjectURL(file) : null;
      added.push({ key, name: file.name, kind, phase: "queued", progress: 0, preview });
      chain.current = chain.current.then(() => runOne(key, file, kind));
    }
    setItems((cur) => [...cur, ...added]);
  }

  function remove(item: Item) {
    aborts.current.get(item.key)?.abort();
    if (item.fileId) discardUpload(item.fileId);
    if (item.preview) URL.revokeObjectURL(item.preview);
    setItems((list) => list.filter((i) => i.key !== item.key));
  }

  const ready = items.filter((i) => i.phase === "done" && i.fileId);
  const busy = items.some((i) => ["queued", "preparing", "uploading", "waiting"].includes(i.phase));

  async function send() {
    setSending(true);
    setMessage(null);
    let latitude: number | undefined;
    let longitude: number | undefined;
    if (shareLocation && "geolocation" in navigator) {
      const pos = await new Promise<GeolocationPosition | null>((resolve) =>
        navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }),
      );
      if (pos) {
        latitude = Math.round(pos.coords.latitude * 1e6) / 1e6;
        longitude = Math.round(pos.coords.longitude * 1e6) / 1e6;
      }
    }
    const r = await addProofAction({ target, fileIds: ready.map((i) => i.fileId!), caption: caption || undefined, latitude, longitude });
    setSending(false);
    if (r.ok) {
      items.forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
      setItems((list) => list.filter((i) => !ready.some((r) => r.key === i.key)));
      setCaption("");
      setMessage({ ok: true, text: r.message ?? "Sent." });
      router.refresh();
    } else {
      setMessage({ ok: false, text: r.error });
    }
  }

  const tone = night ? "border-night-rule bg-night-panel text-night-text" : "border-ink bg-paper";
  const quiet = night ? "text-[#CDB8C4]" : "text-ink-quiet";

  return (
    <div className={`flex flex-col gap-3 rounded-[4px] border-2 p-3.5 ${tone}`}>
      <p className={`text-[14px] ${quiet}`}>{prompt}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="look" className="min-h-[58px] text-[13px]" onClick={() => photoInput.current?.click()}>
          Take photo
        </Button>
        <Button type="button" variant={night ? "look" : "secondary"} className={`min-h-[58px] text-[13px] ${night ? "bg-night-plum" : ""}`} onClick={() => videoInput.current?.click()}>
          Record video
        </Button>
        {allowGallery && (
          <Button type="button" variant="ghost" className={`col-span-2 min-h-11 ${night ? "text-night-plum" : ""}`} onClick={() => galleryInput.current?.click()}>
            Choose from gallery
          </Button>
        )}
      </div>
      <input ref={photoInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
      <input ref={videoInput} type="file" accept="video/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
      {allowGallery && (
        <input ref={galleryInput} type="file" accept="image/*,video/*" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Files to send">
          {items.map((i) => (
            <li key={i.key} className={`grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-2.5 border-t pt-2 ${night ? "border-night-rule" : "border-rule-soft"}`}>
              <span className="grid h-14 w-14 place-items-center overflow-hidden bg-ground font-mono text-[11px] font-semibold text-ink">
                {i.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local preview of the picked file
                  <img src={i.preview} alt="" className="h-full w-full object-cover" />
                ) : i.kind === "video" ? (
                  "▶ VIDEO"
                ) : (
                  "PHOTO"
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-[13.5px] font-semibold">{i.name}</span>
                <span className={`font-mono text-[11.5px] font-semibold uppercase ${i.phase === "failed" ? "text-now" : i.phase === "done" ? "text-ok-text" : quiet}`}>
                  {PHASE_WORDS[i.phase]}
                  {i.phase === "uploading" ? ` ${Math.round(i.progress * 100)}%` : ""}
                </span>
                {(i.phase === "uploading" || i.phase === "waiting") && (
                  <span className={`h-1.5 w-full ${night ? "bg-night-rule" : "bg-rule-soft"}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(i.progress * 100)} aria-label={`Uploading ${i.name}`}>
                    <span className="block h-full bg-plum transition-[width]" style={{ width: `${Math.round(i.progress * 100)}%` }} />
                  </span>
                )}
                {i.error && <span className="text-[12.5px] font-semibold text-now">{i.error}</span>}
              </span>
              <button type="button" onClick={() => remove(i)} className={`min-h-11 px-2 font-mono text-[11.5px] font-semibold uppercase ${night ? "text-night-plum" : "text-plum"}`} aria-label={`Remove ${i.name}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <>
          <label className="flex flex-col gap-1">
            <span className="label-mono text-[12px]">Note (optional)</span>
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={300}
              placeholder="Stage drapes done, left side"
              className={`min-h-11 rounded-[3px] border-2 px-3 text-[15px] ${night ? "border-night-rule bg-night-ground text-night-text" : "border-ink bg-paper"}`}
            />
          </label>
          <label className="flex min-h-11 items-center gap-2.5 text-[14px]">
            <input type="checkbox" checked={shareLocation} onChange={(e) => setShareLocation(e.target.checked)} className="h-5 w-5 accent-plum" />
            Add my location (shows the work was done at the venue)
          </label>
          <Button type="button" className="min-h-[58px] text-[13px]" disabled={sending || busy || ready.length === 0} onClick={send}>
            {sending ? "Sending…" : busy ? "Uploading…" : `Send ${ready.length} as proof`}
          </Button>
        </>
      )}
      {message && <Notice tone={message.ok ? "ok" : "error"}>{message.text}</Notice>}
    </div>
  );
}
