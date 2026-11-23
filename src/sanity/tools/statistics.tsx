"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Button, Card, Container, Flex, Grid, Heading, Spinner, Stack, Text } from "@sanity/ui";
import { ChartUpwardIcon } from "@sanity/icons/ChartUpward";
import { useClient, type Tool } from "sanity";
import type { StatsResponse } from "@/app/api/admin/stats/route";

const RANGES = [7, 30, 90] as const;
/** One series, one hue. Mid-blue reads on both Studio's light and dark surfaces. */
const BAR = "#2276fc";
const BAR_HOVER = "#1a5fd1";

const num = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function change(now: number, before: number): { text: string; tone: "positive" | "critical" | "default" } | null {
  if (!before) return now ? { text: "new", tone: "positive" } : null;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return { text: "no change", tone: "default" };
  return { text: `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%`, tone: pct > 0 ? "positive" : "critical" };
}

/** Studio → Statistics: portal traffic and business numbers. */
function StatisticsTool() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<"signin" | "forbidden" | "failed" | null>(null);
  const [loading, setLoading] = useState(true);
  const [newMessages, setNewMessages] = useState<number | null>(null);
  const client = useClient({ apiVersion: "2026-11-01" });

  const load = useCallback(async (range: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/stats?days=${range}`, { credentials: "same-origin", cache: "no-store" });
      if (res.status === 401) return setError("signin");
      if (res.status === 403) return setError("forbidden");
      if (!res.ok) return setError("failed");
      setData((await res.json()) as StatsResponse);
    } catch {
      setError("failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount and when the range changes
    void load(days);
  }, [days, load]);

  useEffect(() => {
    client.fetch<number>(`count(*[_type == "contactSubmission" && status == "new"])`).then(setNewMessages, () => setNewMessages(null));
  }, [client]);

  return (
    <Container width={4} padding={4} sizing="border">
      <Stack gap={5}>
        <Flex align="center" gap={3} wrap="wrap">
          <Box flex={1}>
            <Heading as="h1" size={3}>Statistics</Heading>
            <Box marginTop={2}>
              <Text size={1} muted>
                Portal visits are counted without cookies. A visitor is one browser on one day, so the same person on two days counts twice.
              </Text>
            </Box>
          </Box>
          <Flex gap={1} role="group" aria-label="Date range">
            {RANGES.map((r) => (
              <Button key={r} text={`${r} days`} mode={r === days ? "default" : "ghost"} tone={r === days ? "primary" : "default"} onClick={() => setDays(r)} />
            ))}
          </Flex>
        </Flex>

        {error === "signin" && (
          <Card padding={4} radius={3} tone="caution" border>
            <Stack gap={3}>
              <Text weight="semibold">Sign in to the portal to see statistics</Text>
              <Text size={1}>
                Statistics come from the portal&apos;s own database, so this browser needs to be signed in to the portal as an admin.{" "}
                <a href="/login?next=/studio/statistics">Sign in</a>, then come back here.
              </Text>
            </Stack>
          </Card>
        )}
        {error === "forbidden" && (
          <Card padding={4} radius={3} tone="critical" border>
            <Text>Only portal admins can see statistics.</Text>
          </Card>
        )}
        {error === "failed" && (
          <Card padding={4} radius={3} tone="critical" border>
            <Flex align="center" gap={3}>
              <Box flex={1}><Text>Statistics couldn&apos;t be loaded.</Text></Box>
              <Button text="Try again" mode="ghost" onClick={() => load(days)} />
            </Flex>
          </Card>
        )}

        {loading && !data && !error && (
          <Flex justify="center" padding={6}><Spinner muted /></Flex>
        )}

        {data && !error && (
          <Stack gap={5} style={{ opacity: loading ? 0.6 : 1, transition: "opacity 150ms" }}>
            <Grid gridTemplateColumns={[2, 3, 6]} gap={3}>
              <Tile label="Visitors" value={num(data.totals.visitors)} delta={change(data.totals.visitors, data.previous.visitors)} />
              <Tile label="Page views" value={num(data.totals.views)} delta={change(data.totals.views, data.previous.views)} />
              <Tile label="Signed-in accounts" value={num(data.totals.signedInUsers)} />
              <Tile label="Orders" value={num(data.totals.orders)} delta={change(data.totals.orders, data.previous.orders)} />
              <Tile label="Revenue" value={usd(data.totals.revenue)} delta={change(data.totals.revenue, data.previous.revenue)} />
              <Tile label="Access requests" value={num(data.totals.accessRequests)} />
            </Grid>
            {newMessages !== null && newMessages > 0 && (
              <Card padding={3} radius={2} tone="primary" border>
                <Text size={1}>
                  {/* Studio route, not a Next page, so a plain link is right here. */}
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                  {newMessages} new contact message{newMessages === 1 ? "" : "s"} waiting in the <a href="/studio/structure/inbox">Inbox</a>.
                </Text>
              </Card>
            )}

            <Card padding={4} radius={3} border>
              <Stack gap={4}>
                <Heading as="h2" size={1}>Visitors per day</Heading>
                <DailyChart daily={data.daily} />
              </Stack>
            </Card>

            <Grid gridTemplateColumns={[1, 1, 2]} gap={4}>
              <Ranked title="Top pages" rows={data.topPages.map((p) => ({ label: p.path, value: p.views }))} empty="No visits yet." mono />
              <Ranked title="Where visitors came from" rows={data.referrers.map((r) => ({ label: r.host, value: r.views }))} empty="No outside referrers yet." />
              <Ranked
                title="Who visited"
                rows={[
                  { label: "Signed-out visitors", value: data.audience.anonymous },
                  { label: "Dealers", value: data.audience.dealers },
                  { label: "Admins", value: data.audience.admins },
                ].filter((r) => r.value > 0)}
                empty="No visits yet."
              />
              <Ranked title="Devices" rows={data.devices.map((r) => ({ label: r.device[0]!.toUpperCase() + r.device.slice(1), value: r.views }))} empty="No visits yet." />
              {data.countries.length > 0 && <Ranked title="Countries" rows={data.countries.map((c) => ({ label: c.country, value: c.views }))} empty="" />}
            </Grid>
          </Stack>
        )}
      </Stack>
    </Container>
  );
}

function Tile({ label, value, delta }: { label: string; value: string; delta?: ReturnType<typeof change> }) {
  return (
    <Card padding={3} radius={3} border>
      <Stack gap={3}>
        <Text size={1} muted>{label}</Text>
        <Text size={4} weight="bold">{value}</Text>
        {delta && (
          <Text size={0} muted={delta.tone === "default"} style={{ color: delta.tone === "positive" ? "var(--card-badge-positive-fg-color, #1f8a4c)" : delta.tone === "critical" ? "var(--card-badge-critical-fg-color, #c4314b)" : undefined }}>
            {delta.text} vs previous period
          </Text>
        )}
      </Stack>
    </Card>
  );
}

/** Single-series bar chart: thin bars, rounded data-ends on the baseline, 2px gaps, hover tooltip. */
function DailyChart({ daily }: { daily: StatsResponse["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = useMemo(() => Math.max(1, ...daily.map((d) => d.visitors)), [daily]);
  const ticks = useMemo(() => {
    const step = Math.max(1, Math.ceil(max / 4));
    return [0, step, step * 2, step * 3, step * 4].filter((t) => t <= max * 1.05 || t === step);
  }, [max]);
  const top = Math.max(max, ticks[ticks.length - 1] ?? max);
  const H = 180;
  const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const labelEvery = Math.ceil(daily.length / 8);
  const h = hover !== null ? daily[hover] : null;

  return (
    <Stack gap={3}>
      {asTable ? (
        <Box style={{ maxHeight: 260, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Day", "Visitors", "Page views"].map((t, i) => (
                  <th key={t} style={{ textAlign: i ? "right" : "left", padding: "4px 8px", borderBottom: "1px solid var(--card-border-color)" }}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.date}>
                  <td style={{ padding: "4px 8px" }}>{fmtDay(d.date)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{num(d.visitors)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{num(d.views)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8 }}>
          {/* Y axis */}
          <div style={{ position: "relative", height: H, width: 36 }} aria-hidden="true">
            {ticks.map((t) => (
              <span key={t} style={{ position: "absolute", right: 0, bottom: (t / top) * H - 7, fontSize: 11, color: "var(--card-muted-fg-color)" }}>{num(t)}</span>
            ))}
          </div>
          <div style={{ position: "relative" }}>
            {/* Recessive gridlines */}
            {ticks.map((t) => (
              <div key={t} aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: (t / top) * H, borderTop: `1px ${t === 0 ? "solid" : "dashed"} var(--card-border-color)` }} />
            ))}
            <div role="list" aria-label="Visitors per day" style={{ position: "relative", height: H, display: "flex", alignItems: "flex-end", gap: 2 }} onMouseLeave={() => setHover(null)}>
              {daily.map((d, i) => (
                <div
                  key={d.date}
                  role="listitem"
                  aria-label={`${fmtDay(d.date)}: ${d.visitors} visitors, ${d.views} page views`}
                  tabIndex={0}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  // The hit target is the full column, larger than the bar itself.
                  style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", cursor: "default", outline: "none" }}
                >
                  <div
                    style={{
                      width: "100%",
                      maxWidth: 28,
                      margin: "0 auto",
                      height: d.visitors ? Math.max(2, (d.visitors / top) * H) : 0,
                      background: hover === i ? BAR_HOVER : BAR,
                      borderRadius: "4px 4px 0 0",
                      transition: "height 300ms ease, background 120ms",
                    }}
                  />
                </div>
              ))}
            </div>
            {h && hover !== null && (
              <div
                role="status"
                style={{
                  position: "absolute",
                  bottom: H + 8,
                  left: `${((hover + 0.5) / daily.length) * 100}%`,
                  transform: "translateX(-50%)",
                  background: "var(--card-bg-color)",
                  border: "1px solid var(--card-border-color)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                  boxShadow: "0 4px 14px rgba(0,0,0,.15)",
                  pointerEvents: "none",
                  color: "var(--card-fg-color)",
                }}
              >
                <strong>{fmtDay(h.date)}</strong>
                <div>{num(h.visitors)} visitors</div>
                <div style={{ color: "var(--card-muted-fg-color)" }}>{num(h.views)} page views</div>
              </div>
            )}
            {/* X axis: a handful of dates, never every day */}
            <div aria-hidden="true" style={{ display: "flex", gap: 2, marginTop: 6 }}>
              {daily.map((d, i) => (
                <span key={d.date} style={{ flex: 1, fontSize: 11, textAlign: "center", color: "var(--card-muted-fg-color)", whiteSpace: "nowrap", overflow: "visible" }}>
                  {i % labelEvery === 0 ? fmtDay(d.date) : ""}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      <Flex justify="flex-end">
        <Button fontSize={1} mode="bleed" text={asTable ? "Show chart" : "Show as table"} onClick={() => setAsTable((x) => !x)} />
      </Flex>
    </Stack>
  );
}

/** A ranked list with an inline proportion bar. */
function Ranked({ title, rows, empty, mono }: { title: string; rows: { label: string; value: number }[]; empty: string; mono?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card padding={4} radius={3} border>
      <Stack gap={4}>
        <Heading as="h2" size={1}>{title}</Heading>
        {rows.length === 0 ? (
          <Text size={1} muted>{empty}</Text>
        ) : (
          <Stack gap={3}>
            {rows.map((r) => (
              <Stack key={r.label} gap={2}>
                <Flex gap={3}>
                  <Box flex={1} style={{ minWidth: 0 }}>
                    <Text size={1} textOverflow="ellipsis" style={mono ? { fontFamily: "ui-monospace, monospace" } : undefined}>{r.label}</Text>
                  </Box>
                  <Text size={1} weight="semibold">{num(r.value)}</Text>
                </Flex>
                <div aria-hidden="true" style={{ height: 4, borderRadius: 2, background: "var(--card-border-color)" }}>
                  <div style={{ height: "100%", width: `${(r.value / max) * 100}%`, borderRadius: 2, background: BAR }} />
                </div>
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

export const statisticsTool: Tool = {
  name: "statistics",
  title: "Statistics",
  icon: ChartUpwardIcon,
  component: StatisticsTool,
};
