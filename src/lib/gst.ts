/**
 * GST helpers: state codes, GSTIN checks, the CGST/SGST vs IGST split, and amounts in words.
 *
 * Place of supply for event services (IGST Act s.12(7)): a registered client's state (from their
 * GSTIN); for an unregistered client, where the event is held. Within the company's own state the
 * tax is split into CGST and SGST; otherwise it is IGST.
 */

/** GST state and union territory codes (CBIC list). */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

export const stateName = (code: string | null | undefined) => (code ? (GST_STATES[code] ?? null) : null);

/** The code of a state written by name ("rajasthan", "Delhi"), if it is one. */
export function stateCodeOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  return Object.entries(GST_STATES).find(([, v]) => v.toLowerCase() === n)?.[0] ?? null;
}

const GSTIN_SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The 15th character of a GSTIN, computed from the first 14 (the published mod-36 check). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export const normalizeGstin = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/\s/g, "");

/** A well-formed GSTIN with a known state code and a correct check character. */
export function isValidGstin(raw: string): boolean {
  const g = normalizeGstin(raw);
  return GSTIN_SHAPE.test(g) && g.slice(0, 2) in GST_STATES && gstinCheckChar(g.slice(0, 14)) === g[14];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Tax on one line: CGST + SGST within the company's state, IGST across states. */
export function splitTax(taxable: number, rate: number, intraState: boolean) {
  const tax = r2((taxable * rate) / 100);
  if (!intraState) return { cgst: 0, sgst: 0, igst: tax };
  const half = r2(tax / 2);
  return { cgst: half, sgst: r2(tax - half), igst: 0 };
}

/** Financial year label used in invoice numbers: 2026-11-18 → "26-27" (April to March). */
export function fyCode(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** Indian-style words for an amount: 755200.5 → "Rupees Seven Lakh Fifty-Five Thousand Two Hundred and Fifty Paise only". */
export function rupeesInWords(amount: number): string {
  const total = Math.round(amount * 100);
  let rupees = Math.floor(total / 100);
  const paise = total % 100;
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  rupees %= 10_000_000;
  const lakh = Math.floor(rupees / 100_000);
  rupees %= 100_000;
  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;
  if (crore) parts.push(`${crore >= 1000 ? belowThousand(Math.floor(crore / 1000)) + " Thousand " : ""}${belowThousand(crore % 1000)} Crore`.trim());
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rupees) parts.push(belowThousand(rupees));
  const words = parts.join(" ") || "Zero";
  return `Rupees ${words}${paise ? ` and ${belowHundred(paise)} Paise` : ""} only`;
}
