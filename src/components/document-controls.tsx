"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addDocumentAction, removeDocumentAction } from "@/app/actions/documents";
import { DocumentUpload } from "@/components/document-upload";
import { Button, Field, Notice, SelectField } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

const KINDS = [
  { value: "PLAN", label: "Plan / layout" },
  { value: "DESIGN", label: "Design" },
  { value: "CONTRACT", label: "Contract" },
  { value: "QUOTATION", label: "Quotation" },
  { value: "INVOICE", label: "Invoice" },
  { value: "PHOTO", label: "Photo" },
  { value: "OTHER", label: "Other" },
];

export function AddDocumentForm({ eventId, vendors, ownerOnly }: { eventId: string; vendors: { id: string; name: string }[]; ownerOnly: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState("BOOKING_TEAM");
  const [shareVendorIds, setShare] = useState<string[]>([]);
  const [shareWithCrew, setCrew] = useState(false);
  const [fileId, setFileId] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const fe = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  if (!open)
    return (
      <div className="flex flex-col gap-2">
        {result?.ok && <Notice tone="ok">{result.message}</Notice>}
        <Button type="button" variant="secondary" className="self-start" onClick={() => (setOpen(true), setResult(null))}>
          + Add a document
        </Button>
      </div>
    );
  return (
    <form
      noValidate
      className="flex flex-col gap-3 rounded-[4px] border-2 border-ink bg-paper p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const r = await addDocumentAction({ eventId, title: String(f.get("title") ?? ""), kind: String(f.get("kind")) as "PLAN", visibility: visibility as "INTERNAL", fileId: fileId ?? "", shareVendorIds, shareWithCrew });
          setResult(r);
          if (r.ok) {
            setOpen(false);
            setFileId(null);
            setShare([]);
            setCrew(false);
            router.refresh();
          }
        });
      }}
    >
      <h3 className="label-mono text-[12.5px]">Add a document</h3>
      {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field className="sm:col-span-2" label="Name" name="title" placeholder="Mandap design, v2" error={fe.title} />
        <SelectField label="Kind" name="kind" defaultValue="PLAN" options={KINDS} />
        <SelectField
          className="sm:col-span-3"
          label="Who sees it"
          name="visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
          options={[
            { value: "BOOKING_TEAM", label: "This booking's team (managers, supervisors) and hosts" },
            { value: "INTERNAL", label: "All staff who can open this booking, including the accountant" },
            { value: "SHARED", label: "Staff, plus vendors or crew I pick" },
            ...(ownerOnly ? [{ value: "OWNER_ONLY", label: "Hosts only" }] : []),
          ]}
        />
      </div>
      {visibility === "SHARED" && (
        <fieldset className="flex flex-col gap-1">
          <legend className="label-mono mb-1 text-[12px]">Share with</legend>
          <div className="flex flex-wrap gap-1.5">
            {vendors.map((v) => {
              const on = shareVendorIds.includes(v.id);
              return (
                <label key={v.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[3px] border-2 px-2.5 text-[13.5px] ${on ? "border-ink bg-look" : "border-rule-soft"}`}>
                  <input type="checkbox" className="h-4 w-4 accent-plum" checked={on} onChange={() => setShare(on ? shareVendorIds.filter((x) => x !== v.id) : [...shareVendorIds, v.id])} />
                  {v.name}
                </label>
              );
            })}
            <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[3px] border-2 px-2.5 text-[13.5px] ${shareWithCrew ? "border-ink bg-look" : "border-rule-soft"}`}>
              <input type="checkbox" className="h-4 w-4 accent-plum" checked={shareWithCrew} onChange={() => setCrew(!shareWithCrew)} />
              The booking&apos;s crew
            </label>
          </div>
          {fe.share && <span className="text-[13px] font-semibold text-now">{fe.share}</span>}
        </fieldset>
      )}
      <DocumentUpload label="File (PDF or photo)" onChange={setFileId} error={fe.fileId} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !fileId}>
          {pending ? "Adding…" : "Add document"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function RemoveDocument({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end">
      <Button
        type="button"
        variant="ghost"
        className="min-h-9 px-2 text-[11.5px]"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await removeDocumentAction(id);
            if (r.ok) router.refresh();
            else setError(r.error);
          })
        }
      >
        Remove
      </Button>
      {error && <span className="text-[12px] font-semibold text-now">{error}</span>}
    </span>
  );
}
