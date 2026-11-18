"use client";

/** Forms for the vendor directory and the crew roster. */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addUnavailableAction, confirmVendorBankAction, removeUnavailableAction, saveVendorAction, saveVendorBankAction, saveWorkerAction, updateOwnProfileAction } from "@/app/actions/directory";
import { Button, Field, Notice, SelectField } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

function useRun() {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [pending, start] = useTransition();
  return {
    result,
    pending,
    fe: result && !result.ok ? (result.fieldErrors ?? {}) : ({} as Record<string, string>),
    run: (fn: () => Promise<ActionResult<unknown>>, onOk?: (r: ActionResult<unknown>) => void) =>
      start(async () => {
        const r = await fn();
        setResult(r);
        if (r.ok) {
          onOk?.(r);
          router.refresh();
        }
      }),
  };
}

const FORM = "flex flex-col gap-3 rounded-[4px] border-2 border-ink bg-paper p-3.5";

function Chips({ name, options, selected, onChange, error }: { name: string; options: { id: string; name: string }[]; selected: string[]; onChange: (ids: string[]) => void; error?: string }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="label-mono mb-1 text-[12px]">{name}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o.id);
          return (
            <label key={o.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[3px] border-2 px-2.5 text-[13.5px] ${on ? "border-ink bg-look" : "border-rule-soft"}`}>
              <input type="checkbox" className="h-4 w-4 accent-plum" checked={on} onChange={() => onChange(on ? selected.filter((x) => x !== o.id) : [...selected, o.id])} />
              {o.name}
            </label>
          );
        })}
      </div>
      {error && <span className="text-[13px] font-semibold text-now">{error}</span>}
    </fieldset>
  );
}

export interface VendorValues {
  id?: string;
  companyName: string;
  contactName: string;
  phone: string;
  whatsapp: string;
  email: string;
  city: string;
  address: string;
  services: string;
  categoryIds: string[];
  gstin: string;
  pan: string;
  status: "ACTIVE" | "INACTIVE" | "BLACKLISTED";
  notes: string;
}

export function VendorForm({ initial, departments, seesTax, onDone, goTo }: { initial?: VendorValues; departments: { id: string; name: string }[]; seesTax: boolean; onDone?: () => void; goTo?: boolean }) {
  const router = useRouter();
  const { result, pending, run, fe } = useRun();
  const [cats, setCats] = useState(initial?.categoryIds ?? []);
  return (
    <form
      noValidate
      className={FORM}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const get = (k: string) => String(f.get(k) ?? "");
        run(
          () =>
            saveVendorAction({
              id: initial?.id,
              companyName: get("companyName"),
              contactName: get("contactName"),
              phone: get("phone"),
              whatsapp: get("whatsapp"),
              email: get("email"),
              city: get("city"),
              address: get("address"),
              services: get("services"),
              categoryIds: cats,
              gstin: get("gstin"),
              pan: get("pan"),
              status: (get("status") || "ACTIVE") as "ACTIVE",
              notes: get("notes"),
            }),
          (r) => {
            onDone?.();
            const id = (r.ok && (r.data as { id?: string } | undefined)?.id) || null;
            if (goTo && id) router.push(`/vendors/${id}`);
          },
        );
      }}
    >
      <h3 className="label-mono text-[12.5px]">{initial?.id ? "Edit vendor" : "Add a vendor"}</h3>
      {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Company or shop" name="companyName" defaultValue={initial?.companyName} placeholder="Jyoti Lights" error={fe.companyName} />
        <Field label="Contact person" name="contactName" defaultValue={initial?.contactName} error={fe.contactName} />
        <Field label="Phone" name="phone" inputMode="tel" defaultValue={initial?.phone} placeholder="98290 55501" error={fe.phone} />
        <Field label="WhatsApp (if different)" name="whatsapp" inputMode="tel" defaultValue={initial?.whatsapp} error={fe.whatsapp} />
        <Field label="Email (optional)" name="email" type="email" defaultValue={initial?.email} error={fe.email} />
        <Field label="City" name="city" defaultValue={initial?.city ?? "Jaipur"} />
        <Field className="sm:col-span-2" label="What they do" name="services" defaultValue={initial?.services} placeholder="Fairy lights, uplighters, generators" />
        {initial?.id && (
          <SelectField
            label="Status"
            name="status"
            defaultValue={initial.status}
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "INACTIVE", label: "Not working with them now" },
              { value: "BLACKLISTED", label: "Blacklisted" },
            ]}
          />
        )}
        {seesTax && (
          <>
            <Field label="GSTIN" name="gstin" defaultValue={initial?.gstin} placeholder="08ABCPR5678L1Z9" error={fe.gstin} />
            <Field label="PAN" name="pan" defaultValue={initial?.pan} placeholder="ABCPR5678L" error={fe.pan} />
          </>
        )}
        <Field className="sm:col-span-2 lg:col-span-3" label="Address (optional)" name="address" defaultValue={initial?.address} />
      </div>
      <Chips name="Departments" options={departments} selected={cats} onChange={setCats} error={fe.categoryIds} />
      <label className="flex flex-col gap-1">
        <span className="label-mono text-[12px]">Notes for the team (vendors never see these)</span>
        <textarea name="notes" rows={2} defaultValue={initial?.notes} className="rounded-[3px] border-2 border-ink bg-paper px-3 py-2 text-[15px]" />
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : initial?.id ? "Save" : "Add vendor"}
        </Button>
        {onDone && (
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function AddVendor({ departments, seesTax }: { departments: { id: string; name: string }[]; seesTax: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        + Add vendor
      </Button>
    );
  return <VendorForm departments={departments} seesTax={seesTax} onDone={() => setOpen(false)} goTo />;
}

export function EditVendor(props: { initial: VendorValues; departments: { id: string; name: string }[]; seesTax: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Edit vendor
      </Button>
    );
  return <VendorForm {...props} onDone={() => setOpen(false)} />;
}

export function BankForm({ vendorId, initial, byVendor = false }: { vendorId: string; initial: { accountName: string; last4: string | null; ifsc: string; upiId: string } | null; byVendor?: boolean }) {
  const [open, setOpen] = useState(false);
  const { result, pending, run, fe } = useRun();
  if (!open)
    return (
      <div className="flex flex-col gap-2 px-3.5 pb-3">
        {result?.ok && <Notice tone="ok">{result.message}</Notice>}
        <Button type="button" variant="secondary" className="self-start" onClick={() => setOpen(true)}>
          {initial ? "Change bank details" : "Add bank details"}
        </Button>
      </div>
    );
  return (
    <form
      noValidate
      className="flex flex-col gap-3 border-t border-rule-soft px-3.5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const get = (k: string) => String(f.get(k) ?? "");
        run(() => saveVendorBankAction(vendorId, { accountName: get("accountName"), accountNumber: get("accountNumber"), ifsc: get("ifsc"), upiId: get("upiId") }), () => setOpen(false));
      }}
    >
      {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Account holder" name="accountName" defaultValue={initial?.accountName} error={fe.accountName} />
        <Field label={initial?.last4 ? `Account number (on file: ••••${initial.last4})` : "Account number"} name="accountNumber" inputMode="numeric" autoComplete="off" placeholder={initial?.last4 ? "Leave blank to keep it" : ""} error={fe.accountNumber} />
        <Field label="IFSC" name="ifsc" defaultValue={initial?.ifsc} error={fe.ifsc} />
        <Field label="UPI ID" name="upiId" defaultValue={initial?.upiId} placeholder="name@sbi" error={fe.upiId} />
      </div>
      <p className="text-[12.5px] text-ink-quiet">
        The account number is stored encrypted; screens show only its last four digits.
        {byVendor ? " For your safety, Taamara Taamara will call you to confirm a change before the next payment." : ""}
      </p>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save bank details"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export interface WorkerValues {
  id?: string;
  name: string;
  phone: string;
  city: string;
  experienceYears: string;
  skillIds: string[];
  usualEventRate: string;
  emergencyContact: string;
  status: "ACTIVE" | "INACTIVE";
  notes: string;
}

export function WorkerForm({ initial, skills, seesPay, onDone, goTo }: { initial?: WorkerValues; skills: { id: string; name: string }[]; seesPay: boolean; onDone?: () => void; goTo?: boolean }) {
  const router = useRouter();
  const { result, pending, run, fe } = useRun();
  const [picked, setPicked] = useState(initial?.skillIds ?? []);
  return (
    <form
      noValidate
      className={FORM}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const get = (k: string) => String(f.get(k) ?? "");
        run(
          () =>
            saveWorkerAction({
              id: initial?.id,
              name: get("name"),
              phone: get("phone"),
              city: get("city"),
              experienceYears: get("experienceYears"),
              skillIds: picked,
              usualEventRate: get("usualEventRate"),
              emergencyContact: get("emergencyContact"),
              status: (get("status") || "ACTIVE") as "ACTIVE",
              notes: get("notes"),
            }),
          (r) => {
            onDone?.();
            const id = (r.ok && (r.data as { id?: string } | undefined)?.id) || null;
            if (goTo && id) router.push(`/roster/${id}`);
          },
        );
      }}
    >
      <h3 className="label-mono text-[12.5px]">{initial?.id ? "Edit crew member" : "Register crew"}</h3>
      {result && !result.ok && <Notice tone="error">{result.error}</Notice>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name" name="name" defaultValue={initial?.name} error={fe.name} />
        <Field label="Phone" name="phone" inputMode="tel" defaultValue={initial?.phone} placeholder="99220 77701" error={fe.phone} />
        <Field label="City" name="city" defaultValue={initial?.city ?? "Jaipur"} />
        <Field label="Years of experience" name="experienceYears" inputMode="numeric" defaultValue={initial?.experienceYears} />
        {seesPay && <Field label="Usual pay per event ₹" name="usualEventRate" inputMode="numeric" defaultValue={initial?.usualEventRate} error={fe.usualEventRate} />}
        <Field label="Emergency contact" name="emergencyContact" defaultValue={initial?.emergencyContact} placeholder="Brother · 98290 00000" />
        {initial?.id && (
          <SelectField
            label="Status"
            name="status"
            defaultValue={initial.status}
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "INACTIVE", label: "Not working with us now" },
            ]}
          />
        )}
      </div>
      <Chips name="Skills" options={skills} selected={picked} onChange={setPicked} error={fe.skillIds} />
      <label className="flex flex-col gap-1">
        <span className="label-mono text-[12px]">Notes for the team</span>
        <textarea name="notes" rows={2} defaultValue={initial?.notes} className="rounded-[3px] border-2 border-ink bg-paper px-3 py-2 text-[15px]" />
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : initial?.id ? "Save" : "Register"}
        </Button>
        {onDone && (
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function AddWorker({ skills, seesPay }: { skills: { id: string; name: string }[]; seesPay: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        + Register crew
      </Button>
    );
  return <WorkerForm skills={skills} seesPay={seesPay} onDone={() => setOpen(false)} goTo />;
}

export function EditWorker(props: { initial: WorkerValues; skills: { id: string; name: string }[]; seesPay: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Edit details
      </Button>
    );
  return <WorkerForm {...props} onDone={() => setOpen(false)} />;
}

export function UnavailableForm({ workerId, today }: { workerId: string; today: string }) {
  const { result, pending, run } = useRun();
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-2 px-3.5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(() => addUnavailableAction(workerId, { date: String(f.get("date") ?? ""), reason: String(f.get("reason") ?? "") }));
      }}
    >
      <Field label="Day" name="date" type="date" min={today} />
      <Field label="Why (optional)" name="reason" placeholder="Family wedding" />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Not available"}
      </Button>
      {result && <span className={`w-full text-[13px] font-semibold ${result.ok ? "text-ok-text" : "text-now"}`}>{result.ok ? result.message : result.error}</span>}
    </form>
  );
}

export function RemoveUnavailable({ workerId, id }: { workerId: string; id: string }) {
  const { pending, run } = useRun();
  return (
    <Button type="button" variant="ghost" className="min-h-9 px-2 text-[11.5px]" disabled={pending} onClick={() => run(() => removeUnavailableAction(workerId, id))}>
      Remove
    </Button>
  );
}

export function ConfirmBank({ vendorId }: { vendorId: string }) {
  const { result, pending, run } = useRun();
  if (result?.ok) return <Notice tone="ok">{result.message}</Notice>;
  return (
    <div className="flex flex-col gap-1.5">
      <Button type="button" variant="look" className="self-start" disabled={pending} onClick={() => run(() => confirmVendorBankAction(vendorId))}>
        {pending ? "Saving…" : "I called them; the new details are right"}
      </Button>
      {result && !result.ok && <span className="text-[13px] font-semibold text-now">{result.error}</span>}
    </div>
  );
}

export function OwnProfileForm({ initial, seesTax }: { initial: { contactName: string; email: string; address: string; services: string; gstin: string; pan: string }; seesTax: boolean }) {
  const { result, pending, run, fe } = useRun();
  return (
    <form
      noValidate
      className="flex flex-col gap-3 px-3.5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const get = (k: string) => String(f.get(k) ?? "");
        run(() => updateOwnProfileAction({ contactName: get("contactName"), email: get("email"), address: get("address"), services: get("services"), gstin: get("gstin"), pan: get("pan") }));
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Contact person" name="contactName" defaultValue={initial.contactName} error={fe.contactName} />
        <Field label="Email" name="email" type="email" defaultValue={initial.email} error={fe.email} />
        <Field className="sm:col-span-2" label="What you do" name="services" defaultValue={initial.services} />
        <Field className="sm:col-span-2" label="Address" name="address" defaultValue={initial.address} />
        {seesTax && (
          <>
            <Field label="GSTIN" name="gstin" defaultValue={initial.gstin} placeholder="08ABCPR5678L1Z9" error={fe.gstin} />
            <Field label="PAN" name="pan" defaultValue={initial.pan} placeholder="ABCPR5678L" error={fe.pan} />
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {result && <span className={`text-[13px] font-semibold ${result.ok ? "text-ok-text" : "text-now"}`}>{result.ok ? result.message : result.error}</span>}
      </div>
    </form>
  );
}
