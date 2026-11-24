/**
 * Expiry-date rules for FFL and SOT, shared by the request-access form and the server.
 * An FFL is issued for up to 3 years. An SOT runs to June 30 each year and can be paid a
 * year ahead, so it's never more than about 2 years out.
 */
export type LicenseKind = "ffl" | "sot";
export const EXPIRY_LIMITS: Record<LicenseKind, { maxYears: number; label: string }> = {
  ffl: { maxYears: 3, label: "FFL" },
  sot: { maxYears: 2, label: "SOT" },
};

const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** null when the date is fine, else what's wrong with it, in plain words. */
export function expiryProblem(kind: LicenseKind, value: string, now = new Date(), graceDays = 1): string | null {
  const { maxYears, label } = EXPIRY_LIMITS[kind];
  if (!value) return `Enter the date your ${label} expires.`;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return `Enter the ${label} expiry as a date, e.g. 06/30/2027.`;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  // Catches dates like Feb 30 that roll into the next month.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return `That isn't a real date. Check the ${label} expiry.`;
  // The server allows a day of slack for time zones (it runs on UTC); the form uses none.
  const earliest = new Date(now);
  earliest.setDate(earliest.getDate() - graceDays);
  if (value < isoLocal(earliest)) return graceDays ? `That ${label} has expired. Renew it before requesting access.` : `The ${label} expiry date can't be before today.`;
  const latest = new Date(now);
  latest.setFullYear(latest.getFullYear() + maxYears);
  latest.setDate(latest.getDate() + 1);
  if (value > isoLocal(latest)) return `That's more than ${maxYears} years away — an ${label} doesn't last that long. Check the year.`;
  return null;
}
