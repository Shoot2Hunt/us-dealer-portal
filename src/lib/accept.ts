"use client";

/** Authorize.net Accept.js: turns card or bank details into a one-time token in the browser. */

type AcceptResponse = {
  messages: { resultCode: "Ok" | "Error"; message: { code: string; text: string }[] };
  opaqueData?: { dataDescriptor: string; dataValue: string };
};

declare global {
  interface Window {
    Accept?: { dispatchData: (data: unknown, cb: (r: AcceptResponse) => void) => void };
  }
}

let loading: Promise<void> | null = null;

/**
 * Accept.js loads in two steps: Accept.js itself, which only has a placeholder dispatchData
 * that answers "E_WC_03 Accept.js is not loaded correctly", and then AcceptCore.js, which
 * swaps in the real one. Resolve only once that swap has happened.
 */
function waitForCore(placeholder: unknown, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (window.Accept && window.Accept.dispatchData !== placeholder) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("The payment form took too long to load. Check your connection and try again."));
      setTimeout(check, 100);
    };
    check();
  });
}

/** Load Accept.js (once per page). Call early, e.g. when the payment form shows, so it's ready by submit. */
export function loadAcceptJs(url: string): Promise<void> {
  loading ??= new Promise<unknown>((resolve, reject) => {
    if (window.Accept) return resolve(null);
    const s = document.createElement("script");
    s.src = url;
    s.charset = "utf-8";
    s.onload = () => resolve(window.Accept?.dispatchData);
    s.onerror = () => reject(new Error("Couldn't load the payment form. Check your connection and try again."));
    document.head.appendChild(s);
  })
    .then((placeholder) => waitForCore(placeholder))
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}

export type CardInput = { cardNumber: string; month: string; year: string; cardCode: string; zip?: string; fullName?: string };
export type BankInput = { routingNumber: string; accountNumber: string; nameOnAccount: string; accountType: "checking" | "savings" | "businessChecking" };

export function tokenize(
  auth: { apiLoginId: string; clientKey: string },
  details: { card: CardInput } | { bank: BankInput },
): Promise<{ dataDescriptor: string; dataValue: string }> {
  return new Promise((resolve, reject) => {
    if (!window.Accept) return reject(new Error("Payment form not loaded"));
    const payload: Record<string, unknown> = { authData: { apiLoginID: auth.apiLoginId, clientKey: auth.clientKey } };
    if ("card" in details) {
      payload.cardData = {
        cardNumber: details.card.cardNumber.replace(/\s/g, ""),
        month: details.card.month.padStart(2, "0"),
        year: details.card.year.length === 2 ? `20${details.card.year}` : details.card.year,
        cardCode: details.card.cardCode,
        ...(details.card.zip ? { zip: details.card.zip } : {}),
        ...(details.card.fullName ? { fullName: details.card.fullName.slice(0, 64) } : {}),
      };
    } else {
      payload.bankData = { ...details.bank, accountNumber: details.bank.accountNumber.replace(/\s/g, "") };
    }
    window.Accept.dispatchData(payload, (r) => {
      if (r.messages.resultCode === "Ok" && r.opaqueData) resolve(r.opaqueData);
      else reject(new Error(r.messages.message.map((m) => m.text).join(" ")));
    });
  });
}
