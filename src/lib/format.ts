/** Display helpers. Money and dates are always shown the Indian way, in India time. */

const TZ = "Asia/Kolkata";

type Decimalish = number | string | { toString(): string } | null | undefined;

export function toNumber(v: Decimalish): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v.toString());
}

/** ₹8,50,000 (lakh grouping). */
export function formatINR(v: Decimalish, opts: { decimals?: boolean } = {}): string {
  const n = toNumber(v);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: opts.decimals ? 2 : 0,
    minimumFractionDigits: opts.decimals ? 2 : 0,
  }).format(n);
}

export function formatDate(d: Date | null | undefined, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, ...opts }).format(d);
}

/** Dates stored as SQL DATE come back as UTC midnight: format them in UTC so the day never shifts. */
export function formatCalendarDate(d: Date | null | undefined, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...opts }).format(d);
}

export function formatTime(d: Date | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

export function todayInIndia(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/** Start of today in India as a UTC-midnight DATE value (matches @db.Date columns). */
export function todayAsDate(): Date {
  return new Date(`${todayInIndia()}T00:00:00Z`);
}

export function greeting(now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", hour12: false }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}
