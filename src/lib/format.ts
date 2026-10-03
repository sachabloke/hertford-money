export type MoneyLike = number | string | { toNumber(): number } | null | undefined;

export function gbp(n: MoneyLike, opts: { compact?: boolean; decimals?: boolean } = {}): string {
  if (n === null || n === undefined) return "—";
  const v = typeof n === "string" ? parseFloat(n) : typeof n === "number" ? n : n.toNumber();
  if (!Number.isFinite(v)) return "—";
  if (opts.compact) {
    const abs = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    if (abs >= 1e9) return `${sign}£${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}bn`;
    if (abs >= 1e6) return `${sign}£${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}m`;
    if (abs >= 1e4) return `${sign}£${Math.round(abs / 1e3)}k`;
    return `${sign}£${Math.round(abs).toLocaleString("en-GB")}`;
  }
  return v.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: opts.decimals ? 2 : 0, maximumFractionDigits: opts.decimals ? 2 : 0 });
}

export function num(n: number | bigint | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-GB");
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function dateStr(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function financialYear(d: Date): string {
  const y = d.getUTCFullYear();
  const s = d.getUTCMonth() + 1 >= 4 ? y : y - 1;
  return `${s}/${String((s + 1) % 100).padStart(2, "0")}`;
}

export function truncate(s: string | null | undefined, n = 80): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Fixed, validated series colours (see dataviz palette). Authorities get a fixed slot by id so colour follows the entity. */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a"] as const;
export const AUTHORITY_COLOUR: Record<string, string> = { hcc: SERIES[0], ehdc: SERIES[1], htc: SERIES[2] };
export function authorityColour(id: string, index = 0): string {
  return AUTHORITY_COLOUR[id] ?? SERIES[index % SERIES.length];
}
