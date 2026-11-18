"use client";

/** Pick one document (PDF or a photo of it), upload it, and hand back its id. */
import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { discardUpload, preparePhoto, uploadFile } from "@/lib/upload-client";

export function DocumentUpload({ label, onChange, error }: { label: string; onChange: (fileId: string | null) => void; error?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ name: string; progress: number; phase: "uploading" | "waiting" | "done" | "failed"; id?: string; error?: string } | null>(null);

  async function pick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (state?.id) discardUpload(state.id);
    onChange(null);
    setState({ name: file.name, progress: 0, phase: "uploading" });
    try {
      const toSend = file.type.startsWith("image/") ? await preparePhoto(file) : file;
      const done = await uploadFile(toSend, "DOCUMENT", { onProgress: (p) => setState((s) => s && { ...s, phase: p.waiting ? "waiting" : "uploading", progress: p.total ? p.sent / p.total : 0 }) });
      setState({ name: file.name, progress: 1, phase: "done", id: done.id });
      onChange(done.id);
    } catch (err) {
      setState({ name: file.name, progress: 0, phase: "failed", error: err instanceof Error ? err.message : "Upload failed." });
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="label-mono text-[12px]">{label}</span>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button type="button" variant="secondary" onClick={() => input.current?.click()}>
          {state ? "Choose another file" : "Choose PDF or photo"}
        </Button>
        {state && (
          <span className={`text-[13.5px] font-semibold ${state.phase === "failed" ? "text-now" : state.phase === "done" ? "text-ok-text" : "text-ink-quiet"}`}>
            {state.name} · {state.phase === "done" ? "attached" : state.phase === "failed" ? state.error : state.phase === "waiting" ? "no signal, will carry on" : `uploading ${Math.round(state.progress * 100)}%`}
          </span>
        )}
      </div>
      <input ref={input} type="file" accept="application/pdf,image/*" className="sr-only" tabIndex={-1} aria-label={label} onChange={(e) => (pick(e.target.files), (e.target.value = ""))} />
      {error && <span className="text-[13px] font-semibold text-now">{error}</span>}
    </div>
  );
}
