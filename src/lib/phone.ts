/**
 * Phone numbers are stored in E.164 form (+919810000005). People type them every way imaginable:
 * "98100 00005", "098100-00005", "+91 98100 00005", "919810000005". All of these normalise to the same value.
 */
export function normalizePhone(input: string, defaultCountryCode = "91"): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (hasPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 12 && digits.startsWith(defaultCountryCode)) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** Placeholder email for people who log in by phone only (Better Auth needs a unique email). */
export function placeholderEmailForPhone(phoneE164: string): string {
  return `${phoneE164.replace(/\D/g, "")}@phone.taamara.invalid`;
}

export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith("@phone.taamara.invalid");
}

/** "+919810000005" → "+91 98100 00005" for display. */
export function formatPhone(phoneE164: string | null | undefined): string {
  if (!phoneE164) return "";
  const m = /^\+91(\d{5})(\d{5})$/.exec(phoneE164);
  return m ? `+91 ${m[1]} ${m[2]}` : phoneE164;
}
