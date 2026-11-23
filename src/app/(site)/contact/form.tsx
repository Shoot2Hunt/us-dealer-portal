"use client";

import { useActionState } from "react";
import { CONTACT_TOPICS } from "@/lib/contact";
import { sendContactMessage } from "./actions";

type Prefill = { name?: string; email?: string; company?: string; phone?: string };

export function ContactForm({ stamp, prefill }: { stamp: string; prefill: Prefill }) {
  const [state, action, pending] = useActionState(sendContactMessage, undefined);

  if (state?.ok) {
    return (
      <div className="flex animate-fade-up flex-col items-center gap-3 py-10 text-center">
        <span className="flex h-16 w-16 animate-pop-in items-center justify-center rounded-full bg-green-100 text-green-700">
          <span className="icon-[lucide--send] h-8 w-8" aria-hidden="true" />
        </span>
        <h2 className="text-xl font-semibold">Message sent</h2>
        <p className="max-w-sm text-sm text-muted">Thanks for reaching out. We&apos;ll reply to the email address you gave us as soon as we can.</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="stamp" value={stamp} />
      {/* Honeypot for bots: hidden from people and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">Name</label>
          <input className="input" id="name" name="name" required minLength={2} maxLength={100} autoComplete="name" defaultValue={prefill.name} />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" required maxLength={200} autoComplete="email" defaultValue={prefill.email} />
        </div>
        <div>
          <label className="label" htmlFor="company">Company <span className="font-normal text-muted">(optional)</span></label>
          <input className="input" id="company" name="company" maxLength={120} autoComplete="organization" defaultValue={prefill.company} />
        </div>
        <div>
          <label className="label" htmlFor="phone">Phone <span className="font-normal text-muted">(optional)</span></label>
          <input className="input" id="phone" name="phone" type="tel" maxLength={40} autoComplete="tel" defaultValue={prefill.phone} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="topic">What is this about?</label>
        <select className="input" id="topic" name="topic" required defaultValue="general">
          {CONTACT_TOPICS.map((t) => (
            <option key={t.value} value={t.value}>{t.title}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="message">Message</label>
        <textarea className="input min-h-36" id="message" name="message" required minLength={10} maxLength={5000} rows={6} />
      </div>

      {state?.error && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          <span className="icon-[lucide--circle-alert] mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {state.error}
        </p>
      )}
      <button className="btn-accent w-full py-2.5 sm:w-auto" disabled={pending}>
        {pending ? (
          <>
            <span className="icon-[lucide--loader-circle] h-4 w-4 animate-spin" aria-hidden="true" /> Sending…
          </>
        ) : (
          <>
            <span className="icon-[lucide--send] h-4 w-4" aria-hidden="true" /> Send message
          </>
        )}
      </button>
    </form>
  );
}
