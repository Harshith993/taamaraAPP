/** Shared building blocks in the Cue Sheet style: 2 px ink rules, square corners, mono labels, 44 px targets. */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "look" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-plum text-[#FFF6EE] hover:bg-plum-dark border-transparent",
  secondary: "border-ink bg-transparent text-ink hover:bg-paper",
  look: "bg-look text-ink hover:brightness-95 border-transparent",
  danger: "border-now bg-transparent text-now hover:bg-[#B5391C10]",
  ghost: "border-transparent bg-transparent text-plum hover:underline",
};

const BUTTON_BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[3px] border-2 px-4 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] disabled:cursor-not-allowed disabled:opacity-50";

export function Button({ variant = "primary", className = "", ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={`${BUTTON_BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}

export function ButtonLink({ variant = "primary", className = "", ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`${BUTTON_BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}

export function Panel({ title, action, children, className = "", tone = "paper" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; tone?: "paper" | "plain" }) {
  return (
    <section className={`overflow-hidden rounded-[4px] border-2 border-ink ${tone === "paper" ? "bg-paper" : ""} ${className}`}>
      {title && (
        <header className="flex min-h-9 items-center justify-between gap-3 border-b-2 border-ink bg-ground px-3.5 py-1">
          <h2 className="label-mono text-[12.5px]">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Tag({ tone = "outline", children }: { tone?: "look" | "ok" | "now" | "plum" | "outline" | "quiet"; children: ReactNode }) {
  const tones = {
    look: "bg-look text-ink",
    ok: "bg-ok text-ink",
    now: "bg-now text-[#FFF6EE]",
    plum: "bg-plum text-[#FFF6EE]",
    outline: "border-[1.5px] border-ink",
    quiet: "border-[1.5px] border-dashed border-ink-quiet text-ink-quiet",
  } as const;
  return <span className={`inline-block px-[7px] py-[2px] font-mono text-[11px] font-semibold tracking-[0.04em] ${tones[tone]}`}>{children}</span>;
}

export function Field({
  label,
  name,
  error,
  hint,
  className = "",
  ...input
}: ComponentProps<"input"> & { label: string; name: string; error?: string; hint?: string }) {
  const id = input.id ?? `f-${name}`;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="label-mono text-[12px]">
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className="min-h-11 rounded-[3px] border-2 border-ink bg-paper px-3 text-[15px] text-ink placeholder:text-ink-quiet aria-[invalid=true]:border-now"
        {...input}
      />
      {hint && !error && (
        <span id={`${id}-hint`} className="text-[12.5px] text-ink-quiet">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-err`} className="text-[13px] font-semibold text-now">
          {error}
        </span>
      )}
    </div>
  );
}

export function SelectField({ label, name, error, options, className = "", ...select }: ComponentProps<"select"> & { label: string; name: string; error?: string; options: { value: string; label: string }[] }) {
  const id = select.id ?? `f-${name}`;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="label-mono text-[12px]">
        {label}
      </label>
      <select id={id} name={name} className="min-h-11 rounded-[3px] border-2 border-ink bg-paper px-2.5 text-[15px] text-ink" aria-invalid={error ? true : undefined} {...select}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span className="text-[13px] font-semibold text-now">{error}</span>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "ok"; children: ReactNode }) {
  const tones = { info: "border-ink bg-paper", error: "border-now bg-[#B5391C12] text-now", ok: "border-ok-text bg-[#85A6461f] text-ok-text" } as const;
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-[3px] border-2 px-3 py-2 text-[14px] font-semibold ${tones[tone]}`}>
      {children}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
      <p className="label-mono text-[12.5px]">{title}</p>
      {children && <p className="max-w-prose text-[14px] text-ink-quiet">{children}</p>}
    </div>
  );
}
