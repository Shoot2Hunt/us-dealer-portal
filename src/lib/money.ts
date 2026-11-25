/** $1,234.50. A plain module (not "use client"), so server pages and client components can both call it. */
export const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
