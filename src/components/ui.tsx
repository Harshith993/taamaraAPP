/**
 * Shared building blocks, Daylight style (design language v2): white cards with soft corners and
 * drop shadows, pastel rainbow tags, pill buttons that lift on hover, Lucide icons, 44 px targets.
 */
import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "look" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-white shadow-[var(--shadow-card)] hover:-translate-y-px hover:shadow-[var(--shadow-lift)] border-transparent",
  secondary: "border-line bg-white text-ink shadow-[0_1px_2px_rgb(22_20_31/0.05)] hover:-translate-y-px hover:bg-ground",
  look: "rainbow-soft text-ink border-white shadow-[var(--shadow-card)] hover:-translate-y-px hover:shadow-[var(--shadow-lift)]",
  danger: "border-[#fecdd3] bg-pastel-rose text-[#be123c] hover:bg-[#fecdd3]",
  ghost: "border-transparent bg-transparent text-plum hover:bg-ground",
};

const BUTTON_BASE =
  "group inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-5 text-[14px] font-semibold transition duration-150 ease-out active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";

export function Button({ variant = "primary", className = "", ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={`${BUTTON_BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}

/** A link styled as a button. `arrow` adds an arrow that slides on hover. */
export function ButtonLink({ variant = "primary", className = "", arrow = false, children, ...props }: ComponentProps<typeof Link> & { variant?: Variant; arrow?: boolean }) {
  return (
    <Link className={`${BUTTON_BASE} no-underline ${VARIANTS[variant]} ${className}`} {...props}>
      {children}
      {arrow && <ArrowRight aria-hidden className="size-4 transition-transform duration-200 group-hover:translate-x-1" />}
    </Link>
  );
}

/** An arrow that keeps nudging forward: for "go here next" links. */
export function MovingArrow({ className = "" }: { className?: string }) {
  return <ArrowRight aria-hidden className={`size-4 animate-nudge ${className}`} />;
}

export function Panel({ title, action, children, className = "", tone = "paper" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; tone?: "paper" | "plain" }) {
  return (
    <section className={`overflow-hidden rounded-[20px] border border-line ${tone === "paper" ? "bg-white shadow-[var(--shadow-card)]" : ""} ${className}`}>
      {title && (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-rule-soft px-4 py-2">
          <h2 className="font-condensed text-[15.5px] font-semibold tracking-[-0.01em]">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Tag({ tone = "outline", children }: { tone?: "look" | "ok" | "now" | "plum" | "outline" | "quiet"; children: ReactNode }) {
  const tones = {
    look: "bg-pastel-yellow text-[#854d0e] ring-[#fde68a]",
    ok: "bg-pastel-green text-[#166534] ring-[#bbf7d0]",
    now: "bg-pastel-rose text-[#be123c] ring-[#fecdd3]",
    plum: "bg-pastel-violet text-[#5b21b6] ring-[#ddd6fe]",
    outline: "bg-ground text-ink ring-line",
    quiet: "bg-white text-ink-quiet ring-line",
  } as const;
  return <span className={`inline-flex items-center rounded-full px-2.5 py-[3px] text-[11px] font-semibold tracking-[0.02em] ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}

const INPUT =
  "min-h-11 rounded-xl border border-line bg-white px-3.5 text-[15px] text-ink shadow-[inset_0_1px_2px_rgb(22_20_31/0.04)] transition placeholder:text-ink-quiet hover:border-[#d4d1df] focus:border-[#a78bfa] focus:ring-4 focus:ring-[#ede9fe] focus:outline-none aria-[invalid=true]:border-now";

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
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      <input id={id} name={name} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} className={INPUT} {...input} />
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
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      <select id={id} name={name} className={`${INPUT} px-3`} aria-invalid={error ? true : undefined} {...select}>
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
  const tones = { info: "border-line bg-pastel-sky text-ink", error: "border-[#fecdd3] bg-pastel-rose text-[#be123c]", ok: "border-[#bbf7d0] bg-pastel-green text-[#166534]" } as const;
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-2xl border px-4 py-2.5 text-[14px] font-medium ${tones[tone]}`}>
      {children}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="grid size-11 place-items-center rounded-2xl rainbow-soft text-[#7c3aed] shadow-[var(--shadow-card)]">
        <Sparkles aria-hidden className="size-5 animate-twinkle" />
      </span>
      <p className="font-condensed text-[15.5px] font-semibold">{title}</p>
      {children && <p className="max-w-prose text-[14px] text-ink-quiet">{children}</p>}
    </div>
  );
}

/** A tinted icon tile used on cards: one pastel per kind of thing. */
export const TINTS = {
  pink: "bg-pastel-pink text-[#be185d]",
  orange: "bg-pastel-orange text-[#c2410c]",
  yellow: "bg-pastel-yellow text-[#a16207]",
  green: "bg-pastel-green text-[#15803d]",
  sky: "bg-pastel-sky text-[#0369a1]",
  violet: "bg-pastel-violet text-[#6d28d9]",
  rose: "bg-pastel-rose text-[#be123c]",
  lime: "bg-pastel-lime text-[#4d7c0f]",
} as const;
export type Tint = keyof typeof TINTS;

export function IconTile({ tint, children, size = "md" }: { tint: Tint; children: ReactNode; size?: "sm" | "md" }) {
  return <span className={`grid shrink-0 place-items-center ${size === "sm" ? "size-8 rounded-xl" : "size-11 rounded-2xl"} ${TINTS[tint]}`}>{children}</span>;
}

/** A card that links somewhere: icon, title, a line of text, a count, and an arrow that moves on hover. */
export function FeatureCard({ href, icon, tint, title, text, count }: { href: string; icon: ReactNode; tint: Tint; title: string; text: string; count?: number | string }) {
  return (
    <Link href={href} className="group lift flex w-full min-w-0 flex-col gap-3 rounded-[20px] border border-line bg-white p-4 text-ink no-underline shadow-[var(--shadow-card)]">
      <span className="flex items-start justify-between gap-2">
        <IconTile tint={tint}>{icon}</IconTile>
        {count !== undefined && count !== 0 && <span className="rounded-full bg-ink px-2.5 py-0.5 text-[12px] font-semibold text-white">{count}</span>}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-condensed text-[17px] font-semibold">{title}</span>
        <span className="text-[13.5px] leading-snug text-ink-quiet">{text}</span>
      </span>
      <span className="mt-auto inline-flex items-center gap-1 text-[13px] font-semibold text-plum">
        Open <ArrowRight aria-hidden className="size-4 transition-transform duration-200 group-hover:translate-x-1" />
      </span>
    </Link>
  );
}
