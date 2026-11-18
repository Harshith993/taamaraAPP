/** A list of documents with open links (server component). */
import { formatDate } from "@/lib/format";
import { KIND_WORDS, VISIBILITY_WORDS } from "@/modules/documents/service";
import type { MediaView } from "@/modules/files/media";
import { RemoveDocument } from "./document-controls";

export interface DocumentRow {
  id: string;
  title: string;
  kind: string;
  visibility: string;
  createdAt: Date;
  uploadedBy: string | null;
  canRemove: boolean;
  sharedWith: string[];
  file: MediaView;
  eventName?: string;
}

export function DocumentList({ docs, staff }: { docs: DocumentRow[]; staff: boolean }) {
  return (
    <ul>
      {docs.map((d) => (
        <li key={d.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0">
          <span className="flex min-w-0 flex-col leading-tight">
            {d.file.originalUrl ? (
              <a href={d.file.originalUrl} target="_blank" rel="noopener" className="text-[14.5px] font-semibold">
                {d.title}
              </a>
            ) : (
              <span className="text-[14.5px] font-semibold">{d.title}</span>
            )}
            <span className="text-[12.5px] text-ink-quiet">
              {d.eventName ? `${d.eventName} · ` : ""}
              {KIND_WORDS[d.kind] ?? d.kind} · {d.file.kind === "pdf" ? "PDF" : "photo"}
              {staff ? ` · ${VISIBILITY_WORDS[d.visibility]}${d.sharedWith.length ? `: ${d.sharedWith.join(", ")}` : ""}` : ""}
              {d.uploadedBy ? ` · ${d.uploadedBy}` : ""}, {formatDate(d.createdAt, { day: "numeric", month: "short" })}
            </span>
          </span>
          {d.canRemove ? <RemoveDocument id={d.id} /> : <span />}
        </li>
      ))}
    </ul>
  );
}
