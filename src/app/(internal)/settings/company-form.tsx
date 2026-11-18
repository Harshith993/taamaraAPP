"use client";

import { useState, useTransition } from "react";
import { updateCompanyAction } from "@/app/actions/settings";
import { Button, Field, Notice, SelectField } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { GST_STATES } from "@/lib/gst";
import type { CompanyDetails } from "@/modules/settings/company";

const STATES = [{ value: "", label: "Pick…" }, ...Object.entries(GST_STATES).map(([code, name]) => ({ value: code, label: `${code} · ${name}` }))];

/** The company's details as printed on GST invoices. */
export function CompanyForm({ initial }: { initial: CompanyDetails }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const fe = result && !result.ok ? (result.fieldErrors ?? {}) : ({} as Record<string, string>);
  return (
    <form
      noValidate
      className="flex flex-col gap-3 px-3.5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const get = (k: string) => String(f.get(k) ?? "");
        start(async () =>
          setResult(
            await updateCompanyAction({
              legalName: get("legalName"),
              tradeName: get("tradeName"),
              gstin: get("gstin"),
              pan: get("pan"),
              address: get("address"),
              city: get("city"),
              stateCode: get("stateCode"),
              phone: get("phone"),
              email: get("email"),
              bankDetails: get("bankDetails"),
              invoicePrefix: get("invoicePrefix"),
            }),
          ),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Legal name (as on the GST certificate)" name="legalName" defaultValue={initial.legalName} error={fe.legalName} />
        <Field label="Trade name" name="tradeName" defaultValue={initial.tradeName} error={fe.tradeName} />
        <Field label="GSTIN" name="gstin" defaultValue={initial.gstin ?? ""} error={fe.gstin} placeholder="08ABCDE1234F1Z5" autoCapitalize="characters" hint="The state is taken from the GSTIN." />
        <Field label="PAN" name="pan" defaultValue={initial.pan ?? ""} error={fe.pan} autoCapitalize="characters" />
        <Field label="Address" name="address" defaultValue={initial.address ?? ""} error={fe.address} className="sm:col-span-2" />
        <Field label="City" name="city" defaultValue={initial.city ?? ""} />
        <SelectField label="State" name="stateCode" defaultValue={initial.stateCode ?? ""} options={STATES} error={fe.stateCode} />
        <Field label="Phone" name="phone" type="tel" defaultValue={initial.phone ?? ""} />
        <Field label="Email" name="email" type="email" defaultValue={initial.email ?? ""} error={fe.email} />
        <Field label="Invoice number prefix" name="invoicePrefix" defaultValue={initial.invoicePrefix} error={fe.invoicePrefix} hint="Invoices are numbered like TT-26-27-0001, one series per financial year." />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="f-bankDetails" className="label-mono text-[12px]">
          Bank details printed on invoices
        </label>
        <textarea id="f-bankDetails" name="bankDetails" rows={3} defaultValue={initial.bankDetails ?? ""} placeholder="Bank, account name, account number, IFSC, UPI ID" className="rounded-[3px] border-2 border-ink bg-paper px-3 py-2 text-[15px]" />
        <span className="text-[12.5px] text-ink-quiet">Stored encrypted. Clients pay into this account, so check it carefully.</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save company details"}
        </Button>
        {result && <Notice tone={result.ok ? "ok" : "error"}>{result.ok ? result.message : result.error}</Notice>}
      </div>
    </form>
  );
}
