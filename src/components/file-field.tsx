"use client";

import { useRef, useState } from "react";

export const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** A file already saved on the server; the form submits its id. */
export type UploadedFile = { id: string; fileName: string; size: number; isPdf: boolean };

/**
 * A file picker without the browser's "Browse… No file selected" box: an upload button
 * (or drop zone) until a file is chosen, then upload progress, then the file's name and
 * size with Replace/Remove. Each file is uploaded on its own as soon as it's picked, so
 * large scans don't hit the request size limit when the form is sent.
 */
export function FileField({
  id,
  label,
  kind,
  value,
  onChange,
  accept,
  maxBytes,
  hint,
  error,
}: {
  id: string;
  label: string;
  kind: "ffl" | "sot";
  value: UploadedFile | null;
  onChange: (file: UploadedFile | null) => void;
  accept: string;
  maxBytes: number;
  hint?: string;
  /** From the parent, e.g. "Upload a copy" when submitting without one. */
  error?: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const [ownError, setOwnError] = useState<string | null>(null);
  const types = accept.split(",");
  const shownError = ownError ?? error;

  function pick(f: File | undefined) {
    if (!f || progress) return;
    setOwnError(null);
    if (!types.includes(f.type)) return setOwnError(`"${f.name}" isn't a PDF, JPG, PNG or WebP file.`);
    if (f.size > maxBytes) return setOwnError(`"${f.name}" is ${formatSize(f.size)}. The limit is ${formatSize(maxBytes)}: try a lower-resolution scan.`);

    // XMLHttpRequest rather than fetch, for upload progress.
    const body = new FormData();
    body.set("kind", kind);
    body.set("file", f);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/license-upload");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress({ name: f.name, pct: Math.round((e.loaded / e.total) * 100) });
    xhr.onload = () => {
      setProgress(null);
      const r = xhr.response as { ok: boolean; id?: string; fileName?: string; size?: number; error?: string } | null;
      if (xhr.status === 200 && r?.ok && r.id) onChange({ id: r.id, fileName: r.fileName ?? f.name, size: r.size ?? f.size, isPdf: f.type === "application/pdf" });
      else setOwnError(r?.error ?? (xhr.status === 413 ? "That file is too large to upload." : "The upload didn't work. Please try again."));
    };
    xhr.onerror = () => {
      setProgress(null);
      setOwnError("The upload didn't work. Check your connection and try again.");
    };
    setProgress({ name: f.name, pct: 0 });
    xhr.send(body);
  }

  return (
    <div>
      <span className="label" id={`${id}-label`}>{label}</span>
      {/* Visually hidden, but still focusable and keyboard-accessible. */}
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        aria-labelledby={`${id}-label`}
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = ""; // so choosing the same file again still fires
        }}
      />
      {progress ? (
        <div className="space-y-1.5 rounded-md border border-line bg-panel px-3 py-2.5 text-sm" role="status">
          <div className="flex items-center gap-2">
            <span className="icon-[lucide--loader-circle] h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">Uploading {progress.name}…</span>
            <span className="text-xs text-muted">{progress.pct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
      ) : value ? (
        <div className="flex animate-fade-in items-center gap-3 rounded-md border border-line bg-panel px-3 py-2.5 text-sm">
          <span className={`${value.isPdf ? "icon-[lucide--file-text]" : "icon-[lucide--file-image]"} h-5 w-5 shrink-0 text-accent`} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium" title={value.fileName}>{value.fileName}</span>
            <span className="flex items-center gap-1 text-xs text-muted">
              <span className="icon-[lucide--circle-check] h-3.5 w-3.5 text-green-600" aria-hidden="true" /> Uploaded · {formatSize(value.size)}
            </span>
          </span>
          <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => input.current?.click()}>
            Replace
          </button>
          <button type="button" className="text-muted transition-colors hover:text-red-700" aria-label={`Remove ${value.fileName}`} onClick={() => onChange(null)}>
            <span className="icon-[lucide--x] h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files[0]);
          }}
          className={`flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-3 py-3 text-sm transition-colors ${
            shownError ? "border-red-400 bg-red-50/50 text-red-800" : dragging ? "border-accent bg-accent-soft text-accent-dark" : "border-line text-muted hover:border-accent hover:text-accent"
          }`}
        >
          <span className="icon-[lucide--upload] h-4 w-4" aria-hidden="true" />
          <span>
            <span className="font-medium">Upload a file</span> or drag it here
          </span>
        </button>
      )}
      {shownError && !progress ? (
        <p role="alert" className="mt-1 text-xs text-red-700">{shownError}</p>
      ) : hint && !value && !progress ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
