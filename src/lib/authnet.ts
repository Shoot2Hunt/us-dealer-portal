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

type TxContext = { invoiceNumber: string; description: string; email: string };

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
