import { LICENSE_DOC_LABEL, licenseDocUrl, type LicenseDocMeta } from "@/lib/license-docs";

/**
 * Inline preview of uploaded FFL/SOT files. The file URLs are protected by
 * /api/license-documents/[id], so only render this for viewers allowed to see them.
 */
export function LicenseDocPreview({ docs, compact = false }: { docs: LicenseDocMeta[]; compact?: boolean }) {
  if (!docs.length) return <p className="text-xs text-muted">No FFL/SOT files uploaded.</p>;
  const sorted = [...docs].sort((a, b) => a.kind.localeCompare(b.kind));
  return (
    <div className={compact ? "flex flex-wrap gap-3" : "grid gap-3 sm:grid-cols-2"}>
      {sorted.map((d) => {
        const url = licenseDocUrl(d.id);
        return (
          <figure key={d.id} className="space-y-1 rounded-md border border-line p-2">
            <figcaption className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold">{LICENSE_DOC_LABEL[d.kind]}</span>
              <span className="truncate text-muted" title={d.fileName}>{d.fileName} · {Math.ceil(d.size / 1024)} KB</span>
            </figcaption>
            {!compact &&
              (d.contentType === "application/pdf" ? (
                <iframe src={url} title={`${LICENSE_DOC_LABEL[d.kind]} preview`} className="h-72 w-full rounded bg-panel" />
              ) : (
                <a href={url} target="_blank" rel="noopener">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`${LICENSE_DOC_LABEL[d.kind]} copy`} className="max-h-72 w-full rounded bg-panel object-contain" />
                </a>
              ))}
            <p className="flex gap-3 text-xs">
              <a href={url} target="_blank" rel="noopener" className="font-medium text-accent hover:underline">Open</a>
              <a href={licenseDocUrl(d.id, true)} className="text-muted hover:underline">Download</a>
            </p>
          </figure>
        );
      })}
    </div>
  );
}
