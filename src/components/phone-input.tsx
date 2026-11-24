"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatPhoneAsTyped, parsePhone, PHONE_EXAMPLE } from "@/lib/phone";

type Props = {
  id?: string;
  /** For forms posted as FormData (server actions). */
  name?: string;
  defaultValue?: string;
  /** Controlled use (e.g. checkout state). */
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  autoComplete?: string;
  className?: string;
};

/**
 * A phone field that formats US numbers as you type and says what's wrong when you leave
 * it. The browser also blocks submitting an invalid number (same rules as the server,
 * src/lib/phone.ts).
 */
export function PhoneInput({ id, name, defaultValue = "", value, onChange, required, autoComplete = "tel", className = "input" }: Props) {
  const [own, setOwn] = useState(defaultValue);
  const current = value ?? own;
  const [touched, setTouched] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const errorId = useId();

  const result = parsePhone(current);
  const error = result && !result.ok ? result.error : required && !current.trim() ? "Enter a phone number." : null;

  // Keep the browser's own validity in sync, so the form can't be submitted with a bad number.
  useEffect(() => {
    ref.current?.setCustomValidity(error ?? "");
  }, [error]);

  const set = (v: string) => {
    if (value === undefined) setOwn(v);
    onChange?.(v);
  };

  return (
    <div>
      <input
        ref={ref}
        id={id}
        name={name}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        maxLength={40}
        placeholder={PHONE_EXAMPLE}
        required={required}
        value={current}
        aria-invalid={touched && Boolean(error)}
        aria-describedby={touched && error ? errorId : undefined}
        className={`${className} ${touched && error ? "border-red-400 focus:border-red-500 focus:ring-red-200" : ""}`}
        onChange={(e) => {
          const raw = e.target.value;
          // Format while typing forward; leave deletions alone so backspace isn't fought.
          set(raw.length > current.length ? formatPhoneAsTyped(raw) : raw);
        }}
        onBlur={() => {
          setTouched(true);
          // Tidy a valid number into its standard form, e.g. 2085550123 → (208) 555-0123.
          if (result?.ok && result.value !== current) set(result.value);
        }}
        onInvalid={() => setTouched(true)}
      />
      {touched && error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
