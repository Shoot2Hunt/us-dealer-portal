import "server-only";

/**
 * Authorize.net JSON API client.
 * Note: Authorize.net is strict about the ORDER of keys in transactionRequest, so
 * objects below are built in the documented order (transactionType, amount, payment,
 * refTransId, order, customer, billTo).
 */

const ENDPOINT =
  process.env.AUTHNET_ENV === "production"
    ? "https://api.authorize.net/xml/v1/request.api"
    : "https://apitest.authorize.net/xml/v1/request.api";

function auth() {
  return {
    name: process.env.NEXT_PUBLIC_AUTHNET_API_LOGIN_ID ?? "",
    transactionKey: process.env.AUTHNET_TRANSACTION_KEY ?? "",
  };
}

async function call<T>(root: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [root]: { merchantAuthentication: auth(), ...payload } }),
    cache: "no-store",
  });
  // The API prefixes its JSON with a byte-order mark.
  const text = (await res.text()).replace(/^﻿/, "");
  return JSON.parse(text) as T;
}

/** Token from Accept.js in the browser: card or bank details never reach our server. */
export type OpaqueData = { dataDescriptor: string; dataValue: string };

export type TxResult = {
  ok: boolean;
  transId?: string;
  last4?: string;
  /** Authorize.net held it for review (responseCode 4). */
  heldForReview?: boolean;
  error?: string;
};

type CreateTxResponse = {
  transactionResponse?: {
    responseCode?: string;
    transId?: string;
    accountNumber?: string;
    errors?: { errorCode: string; errorText: string }[];
    messages?: { code: string; description: string }[];
  };
  messages: { resultCode: "Ok" | "Error"; message: { code: string; text: string }[] };
};

async function createTransaction(transactionRequest: Record<string, unknown>, refId?: string): Promise<TxResult> {
  try {
    const r = await call<CreateTxResponse>("createTransactionRequest", {
      ...(refId ? { refId: refId.slice(0, 20) } : {}),
      transactionRequest,
    });
    const tr = r.transactionResponse;
    const code = tr?.responseCode;
    if (r.messages.resultCode === "Ok" && (code === "1" || code === "4")) {
      return {
        ok: true,
        transId: tr?.transId,
        last4: tr?.accountNumber?.replace(/\D/g, "").slice(-4),
        heldForReview: code === "4",
      };
    }
    const error = tr?.errors?.[0]?.errorText ?? r.messages.message?.[0]?.text ?? "Payment was declined";
    return { ok: false, transId: tr?.transId, error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Payment service unavailable" };
  }
}

type TxContext = {
  invoiceNumber: string;
  description: string;
  email: string;
  /** The dealer's billing address (Billing page), for the card's address check (AVS). */
  billTo?: { firstName: string; lastName: string; company?: string; address1: string; address2?: string; city: string; state: string; postcode: string; phone?: string } | null;
};

/** Authorize.net's billTo, trimmed to its field lengths. Comes after "customer" in key order. */
function billTo(ctx: TxContext) {
  const a = ctx.billTo;
  if (!a) return {};
  return {
    billTo: {
      firstName: a.firstName.slice(0, 50),
      lastName: a.lastName.slice(0, 50),
      ...(a.company ? { company: a.company.slice(0, 50) } : {}),
      address: [a.address1, a.address2].filter(Boolean).join(", ").slice(0, 60),
      city: a.city.slice(0, 40),
      state: a.state.slice(0, 40),
      zip: a.postcode.slice(0, 20),
      country: "US",
      ...(a.phone ? { phoneNumber: a.phone.slice(0, 25) } : {}),
    },
  };
}

function money(n: number) {
  return n.toFixed(2);
}

/** Card: authorize now, capture later (used so a split payment can be rolled back). */
export function authorizeCard(amount: number, token: OpaqueData, ctx: TxContext, refId?: string) {
  return createTransaction(
    {
      transactionType: "authOnlyTransaction",
      amount: money(amount),
      payment: { opaqueData: token },
      order: { invoiceNumber: ctx.invoiceNumber.slice(0, 20), description: ctx.description.slice(0, 255) },
      customer: { email: ctx.email },
      ...billTo(ctx),
    },
    refId,
  );
}

/** eCheck (ACH) debit. There is no authorize-only step for eCheck. */
export function debitBank(amount: number, token: OpaqueData, ctx: TxContext, refId?: string) {
  return createTransaction(
    {
      transactionType: "authCaptureTransaction",
      amount: money(amount),
      payment: { opaqueData: token },
      order: { invoiceNumber: ctx.invoiceNumber.slice(0, 20), description: ctx.description.slice(0, 255) },
      customer: { email: ctx.email },
      ...billTo(ctx),
    },
    refId,
  );
}

/** Card: authorize and capture in one step (invoice payments, where nothing needs rolling back). */
export function chargeCard(amount: number, token: OpaqueData, ctx: TxContext, refId?: string) {
  return createTransaction(
    {
      transactionType: "authCaptureTransaction",
      amount: money(amount),
      payment: { opaqueData: token },
      order: { invoiceNumber: ctx.invoiceNumber.slice(0, 20), description: ctx.description.slice(0, 255) },
      customer: { email: ctx.email },
      ...billTo(ctx),
    },
    refId,
  );
}

export function captureAuthorized(transId: string, amount: number) {
  return createTransaction({ transactionType: "priorAuthCaptureTransaction", amount: money(amount), refTransId: transId });
}

export function voidTransaction(transId: string) {
  return createTransaction({ transactionType: "voidTransaction", refTransId: transId });
}

/** e.g. capturedPendingSettlement, settledSuccessfully, returnedItem, voided, declined, FDSPendingReview */
export async function getTransactionStatus(transId: string): Promise<string | null> {
  try {
    const r = await call<{ transaction?: { transactionStatus?: string } }>("getTransactionDetailsRequest", { transId });
    return r.transaction?.transactionStatus ?? null;
  } catch {
    return null;
  }
}

/** What the browser needs to load Accept.js and turn card/bank details into a token. */
export function acceptJsConfig() {
  return {
    url: process.env.AUTHNET_ENV === "production" ? "https://js.authorize.net/v1/Accept.js" : "https://jstest.authorize.net/v1/Accept.js",
    apiLoginId: process.env.NEXT_PUBLIC_AUTHNET_API_LOGIN_ID ?? "",
    clientKey: process.env.NEXT_PUBLIC_AUTHNET_CLIENT_KEY ?? "",
  };
}

// --- Setup / health check (Admin → Payments) ---

export type AuthnetEnv = "production" | "sandbox";
export const authnetEnv = (): AuthnetEnv => (process.env.AUTHNET_ENV === "production" ? "production" : "sandbox");

/** Which settings are present (values are never returned). */
export function authnetConfig() {
  const apiLoginId = Boolean(process.env.NEXT_PUBLIC_AUTHNET_API_LOGIN_ID?.trim());
  const transactionKey = Boolean(process.env.AUTHNET_TRANSACTION_KEY?.trim());
  const clientKey = Boolean(process.env.NEXT_PUBLIC_AUTHNET_CLIENT_KEY?.trim());
  return { env: authnetEnv(), apiLoginId, transactionKey, clientKey, ready: apiLoginId && transactionKey && clientKey };
}

export type MerchantCheck =
  | {
      ok: true;
      merchantName?: string;
      gatewayId?: string;
      isTestMode: boolean;
      paymentMethods: string[];
      acceptsCards: boolean;
      acceptsEcheck: boolean;
      /** Whether NEXT_PUBLIC_AUTHNET_CLIENT_KEY matches the account's public client key. */
      clientKeyMatches: boolean | null;
    }
  | { ok: false; error: string; code?: string };

/** Ask Authorize.net who these credentials belong to and what the account accepts. */
export async function checkMerchant(): Promise<MerchantCheck> {
  type Resp = {
    isTestMode?: boolean;
    merchantName?: string;
    gatewayId?: string;
    paymentMethods?: string[];
    publicClientKey?: string;
    messages: { resultCode: "Ok" | "Error"; message: { code: string; text: string }[] };
  };
  try {
    const r = await call<Resp>("getMerchantDetailsRequest", {});
    if (r.messages.resultCode !== "Ok") {
      const m = r.messages.message?.[0];
      return { ok: false, code: m?.code, error: m?.text ?? "Authorize.net rejected the request." };
    }
    const methods = r.paymentMethods ?? [];
    const configured = process.env.NEXT_PUBLIC_AUTHNET_CLIENT_KEY?.trim();
    return {
      ok: true,
      merchantName: r.merchantName,
      gatewayId: r.gatewayId,
      isTestMode: Boolean(r.isTestMode),
      paymentMethods: methods,
      acceptsCards: methods.some((m) => /visa|master|amex|american|discover|jcb|diners/i.test(m)),
      acceptsEcheck: methods.some((m) => /echeck/i.test(m)),
      clientKeyMatches: configured && r.publicClientKey ? configured === r.publicClientKey : null,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't reach Authorize.net." };
  }
}
