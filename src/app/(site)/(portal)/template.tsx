/** Remounts on every navigation between portal pages, so each page fades up into place. */
export default function PortalTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-up">{children}</div>;
}
