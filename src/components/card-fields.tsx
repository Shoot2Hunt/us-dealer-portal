"use client";

import type { Address } from "@/lib/db/schema";
import type { CardInput } from "@/lib/accept";

/** Everything a card payment collects: the card, the name on it, and its billing address. */
export type CardForm = Omit<CardInput, "zip" | "fullName"> & {
  name: string;
  /** "Billing address is same as shipping" is ticked. */
  same: boolean;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postcode: string;
};

/** What the server gets for the card's billTo (and the address check). */
export type Cardholder = { firstName: string; lastName: string; address1: string; address2?: string; city: string; state: string; postcode: string };

/**
 * A blank card form. `billing` pre-fills the billing address fields (a saved billing address
 * that differs from shipping), in which case "same as shipping" starts unticked.
 */
export const emptyCardForm = (name = "", billing: Address | null = null): CardForm => ({
  cardNumber: "", month: "", year: "", cardCode: "", name, same: !billing,
  address1: billing?.address1 ?? "", address2: billing?.address2 ?? "", city: billing?.city ?? "", state: billing?.state ?? "", postcode: billing?.postcode ?? "",
});

/** "Mary Ann Smith" → first "Mary Ann", last "Smith" (Authorize.net wants the two separately). */
function splitName(full: string) {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { firstName: parts[0] ?? "", lastName: parts[0] ?? "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/** The cardholder for a payment, plus what Accept.js needs to tokenize the card. */
export function cardholderOf(form: CardForm, sameAs: Address | null): { holder: Cardholder; card: CardInput } {
  if (form.same && !complete(sameAs)) {
    throw new Error("There's no complete shipping address to bill to. Fill it in, or uncheck \"Billing address is same as shipping\" and enter the billing address.");
  }
  const a = form.same && sameAs ? sameAs : form;
  const holder: Cardholder = {
    ...splitName(form.name),
    address1: a.address1.trim(),
    ...(a.address2?.trim() ? { address2: a.address2.trim() } : {}),
    city: a.city.trim(),
    state: a.state.trim().toUpperCase(),
    postcode: a.postcode.trim(),
  };
  const { cardNumber, month, year, cardCode } = form;
  return { holder, card: { cardNumber, month, year, cardCode, zip: holder.postcode, fullName: form.name.trim() } };
}

type Brand = "visa" | "mastercard" | "amex" | "discover";
const BRAND_NAME: Record<Brand, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover" };

/** The card network from the first digits, or null while it can't be told yet. */
function cardBrand(digits: string): Brand | null {
  if (/^4/.test(digits)) return "visa";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) return "mastercard";
  if (/^6(011|5|4[4-9]|22)/.test(digits)) return "discover";
  return null;
}

/** Spaces the way the card is printed: 4-6-5 for Amex, groups of 4 for the rest. */
function formatCardNumber(digits: string) {
  if (cardBrand(digits) === "amex") return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)].filter(Boolean).join(" ");
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** A small card-shaped logo for the network (drawn here, no image files). Grey card when unknown. */
function CardLogo({ brand }: { brand: Brand | null }) {
  const box = "h-6 w-9 rounded-[3px] ring-1 ring-black/10";
  if (brand === "visa")
    return (
      <svg viewBox="0 0 36 24" className={`${box} bg-white`} role="img" aria-label="Visa">
        <text x="18" y="16.5" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="900" fontStyle="italic" fontSize="11" fill="#1a1f71">VISA</text>
      </svg>
    );
  if (brand === "mastercard")
    return (
      <svg viewBox="0 0 36 24" className={`${box} bg-white`} role="img" aria-label="Mastercard">
        <circle cx="14.5" cy="12" r="7" fill="#eb001b" />
        <circle cx="21.5" cy="12" r="7" fill="#f79e1b" />
        <path d="M18 6a7 7 0 0 1 0 12a7 7 0 0 1 0-12z" fill="#ff5f00" />
      </svg>
    );
  if (brand === "amex")
    return (
      <svg viewBox="0 0 36 24" className={`${box} bg-[#2e77bc]`} role="img" aria-label="American Express">
        <text x="18" y="15.5" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="8.5" fill="#fff">AMEX</text>
      </svg>
    );
  if (brand === "discover")
    return (
      <svg viewBox="0 0 36 24" className={`${box} bg-white`} role="img" aria-label="Discover">
        <text x="3" y="14.5" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="6.2" fill="#231f20">DISC</text>
        <circle cx="21.2" cy="12.4" r="2.6" fill="#f58220" />
        <text x="24" y="14.5" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="6.2" fill="#231f20">VER</text>
      </svg>
    );
  return <span className="icon-[lucide--credit-card] h-5 w-7 text-muted" />;
}

/** "04 / 28" from month "04" and year "28"; the slash appears once the month is done. */
function expiryDisplay(month: string, year: string) {
  return month.length === 2 ? `${month} / ${year}` : month;
}

/**
 * One box for the expiry: digits only, at most MMYY. A lone 2–9 becomes "0d", and
 * backspacing over the " / " removes the last month digit instead of getting stuck.
 */
function parseExpiry(typed: string, before: string): { month: string; year: string } {
  let digits = typed.replace(/\D/g, "").slice(0, 4);
  if (typed.length < before.length && digits === before.replace(/\D/g, "")) digits = digits.slice(0, -1);
  if (/^[2-9]$/.test(digits)) digits = `0${digits}`;
  return { month: digits.slice(0, 2), year: digits.slice(2) };
}

const oneLine = (a: Address) => [a.address1, a.address2, `${a.city}, ${a.state} ${a.postcode}`].filter(Boolean).join(", ");
const complete = (a: Address | null): a is Address => Boolean(a && a.address1 && a.city && a.state && a.postcode);

/**
 * Card number, expiry, CVV, name on card and the billing address, with a
 * "Billing address is same as shipping" check mark (`sameAs` = the shipping address).
 */
export function CardFields({
  value,
  onChange,
  sameAs,
  idPrefix,
}: {
  value: CardForm;
  onChange: (next: CardForm) => void;
  sameAs: Address | null;
  idPrefix: string;
}) {
  const set = (patch: Partial<CardForm>) => onChange({ ...value, ...patch });
  const brand = cardBrand(value.cardNumber);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-6 gap-2">
        <div className="col-span-6">
          <label className="label" htmlFor={`${idPrefix}-name`}>Name on card</label>
          <input id={`${idPrefix}-name`} className="input" autoComplete="cc-name" maxLength={100} value={value.name} onChange={(e) => set({ name: e.target.value })} required />
        </div>
        {/* Card number, expiry and CVV on one line; the card's logo shows as they type. */}
        <div className="col-span-6">
          <label className="label" htmlFor={`${idPrefix}-number`}>Card details</label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute left-2.5 top-1/2 flex -translate-y-1/2 items-center" aria-hidden="true">
                <CardLogo brand={brand} />
              </span>
              <input
                id={`${idPrefix}-number`}
                className="input pl-12 tabular-nums"
                placeholder="1234 5678 9012 3456"
                aria-label={brand ? `Card number (${BRAND_NAME[brand]})` : "Card number"}
                autoComplete="cc-number"
                inputMode="numeric"
                maxLength={brand === "amex" ? 17 : 23}
                value={formatCardNumber(value.cardNumber)}
                onChange={(e) => set({ cardNumber: e.target.value.replace(/\D/g, "").slice(0, 19) })}
                required
              />
            </div>
            <input
              className="input w-[5.5rem] shrink-0 px-2 text-center tabular-nums"
              placeholder="MM / YY"
              aria-label="Expiry date (MM / YY)"
              autoComplete="cc-exp"
              inputMode="numeric"
              maxLength={7}
              pattern="(0[1-9]|1[0-2]) / [0-9]{2}"
              title="Expiry date as MM / YY, e.g. 04 / 28"
              value={expiryDisplay(value.month, value.year)}
              onChange={(e) => set(parseExpiry(e.target.value, expiryDisplay(value.month, value.year)))}
              required
            />
            <input
              className="input w-16 shrink-0 px-2 text-center tabular-nums"
              placeholder="CVV"
              aria-label="Security code"
              autoComplete="cc-csc"
              inputMode="numeric"
              maxLength={brand === "amex" ? 4 : 3}
              pattern={brand === "amex" ? "[0-9]{4}" : "[0-9]{3,4}"}
              title={brand === "amex" ? "The 4 digits on the front of the card" : "The 3 digits on the back of the card"}
              value={value.cardCode}
              onChange={(e) => set({ cardCode: e.target.value.replace(/\D/g, "").slice(0, 4) })}
              required
            />
          </div>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="label">Billing address</legend>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={value.same} onChange={(e) => set({ same: e.target.checked })} />
          <span>
            Billing address is same as shipping
            {value.same &&
              (complete(sameAs) ? (
                <span className="block text-xs text-muted">{oneLine(sameAs)}</span>
              ) : (
                <span className="block text-xs text-amber-700">No shipping address yet. Fill it in, or uncheck this to enter the billing address.</span>
              ))}
          </span>
        </label>
        {!value.same && (
          <div className="grid grid-cols-6 gap-2">
            <input className="input col-span-6" placeholder="Address" aria-label="Billing address" autoComplete="billing address-line1" maxLength={60} value={value.address1} onChange={(e) => set({ address1: e.target.value })} required />
            <input className="input col-span-6" placeholder="Address line 2 (optional)" aria-label="Billing address line 2" autoComplete="billing address-line2" value={value.address2} onChange={(e) => set({ address2: e.target.value })} />
            <input className="input col-span-3" placeholder="City" aria-label="City" autoComplete="billing address-level2" maxLength={40} value={value.city} onChange={(e) => set({ city: e.target.value })} required />
            <input className="input col-span-1 px-2" placeholder="ST" aria-label="State" autoComplete="billing address-level1" minLength={2} maxLength={2} pattern="[A-Za-z]{2}" title="2-letter state code, e.g. ID" value={value.state} onChange={(e) => set({ state: e.target.value })} required />
            <input className="input col-span-2 px-2" placeholder="ZIP" aria-label="ZIP" autoComplete="billing postal-code" inputMode="numeric" maxLength={10} pattern="[0-9]{5}(-[0-9]{4})?" title="5-digit ZIP code, e.g. 83814" value={value.postcode} onChange={(e) => set({ postcode: e.target.value })} required />
          </div>
        )}
      </fieldset>
    </div>
  );
}
