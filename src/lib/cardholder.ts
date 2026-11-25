import { z } from "zod";

// Its own module (no app imports) so orders.ts and invoices.ts, which import each other,
// can both use it without hitting a circular-import "before initialization" error.

/** Name on the card and the card's address, from the card form. */
export const cardholderSchema = z.object({
  firstName: z.string().trim().min(1, "Enter the name on the card").max(50),
  lastName: z.string().trim().min(1, "Enter the name on the card").max(50),
  address1: z.string().trim().min(1, "Enter the card's address").max(60),
  address2: z.string().trim().max(60).optional(),
  city: z.string().trim().min(1, "Enter the card's city").max(40),
  state: z.string().trim().regex(/^[A-Za-z]{2}$/, "Use the 2-letter state code for the card's address").transform((s) => s.toUpperCase()),
  postcode: z.string().trim().regex(/^[0-9]{5}(-[0-9]{4})?$/, "Enter the card's 5-digit ZIP code"),
});
export type CardholderInput = z.infer<typeof cardholderSchema>;
