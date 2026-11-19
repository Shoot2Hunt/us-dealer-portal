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

export function loadAcceptJs(url: string): Promise<void> {
  if (window.Accept) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.charset = "utf-8";
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load the payment form. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export type CardInput = { cardNumber: string; month: string; year: string; cardCode: string; zip?: string };
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
