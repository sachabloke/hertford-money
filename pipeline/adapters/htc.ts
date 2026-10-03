/**
 * Hertford Town Council (parish tier).
 * Source: the "Financial and Transparency Documents" page on hertford.gov.uk. The page loads its document list
 * from a JSON feed (async/internal/archives/?id=…) grouped by heading; the "Payments over £100" group holds one
 * PDF per month (or per few months). Each PDF is a Sage-style list: Date, [N/C], Ref (payment method), Details
 * ("SUPPLIER - what for"), Net Amount. Published under the Transparency Code for Smaller Authorities.
 */
import type { Adapter, DiscoveredFile, NormalisedTransaction, ParseResult } from "../core/types";
import { fetchText } from "../core/fetch";
import { extractLinks } from "../core/html";
import { parsePaymentListPdf, pdfTextWithColumns } from "../core/pdf";
import { FormatChangedError } from "../core/types";
import { readTable } from "../core/table";
import { tableToTransactions } from "../core/generic";

export const HTC_HOME = "https://www.hertford.gov.uk/";
export const HTC_FINANCE_PAGE = "https://www.hertford.gov.uk/financial-and-transparency-documents/";
const LICENCE = "Published under the Transparency Code for Smaller Authorities; see source page for licence";
const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

interface FeedGroup { title: string; documents: Array<{ name: string; url: string; size?: string; type?: string }> }

/** "Apr - Jun 24", "Jul 26", "Nov 24", "apr-jun-24" → calendar period. */
export function periodFromTitle(title: string): { start?: string; end?: string } {
  const s = title.toLowerCase().replace(/£/g, "");
  const yr = (y: string) => (y.length === 2 ? 2000 + +y : +y);
  const mi = (m: string) => MONTHS.indexOf(m.slice(0, 3));
  let m = s.match(/\b([a-z]{3,9})\s*(?:-|–|to)\s*([a-z]{3,9})\s*-?\s*(\d{2}|20\d{2})\b/);
  if (m && mi(m[1]) >= 0 && mi(m[2]) >= 0) {
    const y = yr(m[3]);
    const a = mi(m[1]), b = mi(m[2]);
    return { start: new Date(Date.UTC(a > b ? y - 1 : y, a, 1)).toISOString().slice(0, 10), end: new Date(Date.UTC(y, b + 1, 0)).toISOString().slice(0, 10) };
  }
  m = s.match(/\b([a-z]{3,9})\s*-?\s*(\d{2}|20\d{2})\b/);
  if (m && mi(m[1]) >= 0) {
    const y = yr(m[2]), a = mi(m[1]);
    return { start: new Date(Date.UTC(y, a, 1)).toISOString().slice(0, 10), end: new Date(Date.UTC(y, a + 1, 0)).toISOString().slice(0, 10) };
  }
  return {};
}

/** Split Sage "Details": "[1200 ]BACS|DIRECT DEBIT|… SUPPLIER - description". */
export function splitHtcDetails(details: string): { supplier: string; description?: string; reference?: string; extra?: Record<string, string> } {
  let s = details.replace(/\s+/g, " ").trim();
  const extra: Record<string, string> = {};
  const nc = s.match(/^(\d{4})\s+/);
  if (nc) { extra["N/C"] = nc[1]; s = s.slice(nc[0].length); }
  // Payment method: "BACS", "(BACS)", "Bacs", "DIRECT DEBIT", "DD" … possibly preceded by a Sage supplier code ("EHD01").
  const code = s.match(/^([A-Z]{2,4}\d{2})\s+/);
  if (code) { extra["Supplier code"] = code[1]; s = s.slice(code[0].length); }
  const method = s.match(/^\(?\s*(DIRECT DEBIT|STANDING ORDER|BACS|BAC|CHQ|CHEQUE|CARD|DD|SO|TFR|TRANSFER|CASH)\s*\)?\s*/i);
  if (method) { extra["Payment method"] = method[1].toUpperCase(); s = s.slice(method[0].length); }
  const inv = s.match(/#(PL\d+)#/i);
  const reference = inv?.[1];
  s = s.replace(/\s*#PL\d+#\s*/i, " ").replace(/\s+/g, " ").trim();
  let dash = s.indexOf(" - ");
  // 2021-era lists join supplier and purpose with a bare hyphen: "HY Solicitors-Renewal of …".
  if (dash < 0) { const m = s.match(/^([^-]{3,}?)-(?=[A-Z])/); if (m) dash = m[1].length; }
  let supplier = dash > 0 ? s.slice(0, dash).trim() : s;
  let description = dash > 0 ? s.slice(dash).replace(/^\s*-\s*/, "").trim() : undefined;
  // A name printed twice ("ACME LTD ACME LTD") is a PDF artefact, not two suppliers.
  const dbl = supplier.match(/^(.{4,}?) \1$/);
  if (dbl) supplier = dbl[1];
  // Payroll / HMRC / pension lines are published as "July 2026 - Payroll", "Net Pay - 1 - 24/25", "PAYE 1 - 24/25":
  // the part before the dash is not a supplier, so keep the published text whole.
  if (/^(net pay|paye|employee\/employer pension|[a-z]+ 20\d{2}|business card htc)$/i.test(supplier) || /payroll|net pay|paye\b|pension/i.test(s) && !/\bltd\b|limited|plc/i.test(supplier)) {
    supplier = s; description = undefined;
  }
  return { supplier, description, reference, extra: Object.keys(extra).length ? extra : undefined };
}

async function feedGroups(): Promise<{ groups: FeedGroup[]; pageUrl: string }> {
  const html = await fetchText(HTC_FINANCE_PAGE);
  const ids = [...html.matchAll(/data-url="async\/internal\/archives\/\?id=(\d+)"/g)].map((m) => m[1]);
  if (!ids.length) throw new Error(`No document feed found on ${HTC_FINANCE_PAGE}; the page layout may have changed.`);
  const groups: FeedGroup[] = [];
  for (const id of [...new Set(ids)]) {
    const json = await fetchText(`${HTC_HOME}async/internal/archives/?id=${id}`);
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { throw new Error(`Document feed id=${id} is not JSON any more.`); }
    if (Array.isArray(parsed)) groups.push(...(parsed as FeedGroup[]));
  }
  return { groups, pageUrl: HTC_FINANCE_PAGE };
}

export const htc: Adapter = {
  id: "htc",
  authority: {
    id: "htc",
    name: "Hertford Town Council",
    shortName: "Hertford Town Council",
    tier: "parish",
    area: "Hertfordshire",
    website: HTC_HOME,
    notes: "Town (parish) council: Hertford Castle, allotments, markets, community grants, Christmas lights, civic events. Funded mainly by its precept on council tax.",
  },
  async discover() {
    const { groups, pageUrl } = await feedGroups();
    const out: DiscoveredFile[] = [];
    for (const g of groups) {
      if (!/payments?\s*(over|above)/i.test(g.title)) continue;
      for (const d of g.documents) {
        // The feed sometimes carries a mojibake pound sign ("Â£") in older file names; the real files use "£".
        const url = new URL(d.url.replace(/\\\//g, "/").replace(/(?:Ã¢|Ã‚|Â)+£/g, "£"), HTC_HOME).toString();
        const fmt = /\.pdf$/i.test(url) ? "pdf" : /\.xlsx$/i.test(url) ? "xlsx" : /\.csv$/i.test(url) ? "csv" : null;
        if (!fmt) continue;
        const p = periodFromTitle(d.name);
        out.push({ kind: "transactions", title: `${g.title.replace(/\s+/g, " ").trim()} — ${d.name.replace(/^payments? over £\d+\s*/i, "").trim()}`, url, pageUrl, format: fmt, licence: LICENCE, periodStart: p.start, periodEnd: p.end });
      }
    }
    // The council moved from "over £500" to "over £100" lists in 2024 and both exist for some months. Importing both
    // would double count, so where an "over £100" list covers a period, the "over £500" list for that period is dropped.
    const thresholdOf = (f: DiscoveredFile) => parseInt(f.title.match(/£\s*(\d+)/)?.[1] ?? "0", 10);
    const low = out.filter((f) => thresholdOf(f) > 0 && thresholdOf(f) === Math.min(...out.map(thresholdOf).filter((t) => t > 0)));
    const overlaps = (a: DiscoveredFile, b: DiscoveredFile) => !!(a.periodStart && a.periodEnd && b.periodStart && b.periodEnd) && a.periodStart <= b.periodEnd && b.periodStart <= a.periodEnd;
    const kept = out.filter((f) => low.includes(f) || !low.some((l) => overlaps(l, f)));
    if (kept.length !== out.length) console.warn(`[htc] ${out.length - kept.length} higher-threshold lists skipped because an "over £${thresholdOf(low[0])}" list covers the same months.`);
    out.length = 0; out.push(...kept);
    if (!out.length) {
      // Fallback: plain links on the page.
      const html = await fetchText(HTC_FINANCE_PAGE);
      for (const l of extractLinks(html, HTC_FINANCE_PAGE)) if (/payments?.*\.pdf$/i.test(l.href)) out.push({ kind: "transactions", title: l.text || l.href, url: l.href, pageUrl: HTC_FINANCE_PAGE, format: "pdf", licence: LICENCE, ...periodFromTitle(l.text) });
    }
    if (!out.length) throw new Error(`No "Payments over £…" documents found in the Hertford Town Council document feed (${groups.length} groups: ${groups.map((g) => g.title).join("; ")}).`);
    return out;
  },
  async parseTransactions(buffer, file): Promise<ParseResult<NormalisedTransaction>> {
    if (file.format === "pdf") {
      const { text } = await pdfTextWithColumns(buffer);
      // 2017–2018 lists use a stacked layout (supplier printed on the line above type/date/ref/amounts, cells split
      // across lines). It cannot be read reliably from the text layer, so it is refused rather than guessed.
      if (/Supplier\tType\tDate/i.test(text) || /Supplier\tDetails\tAmount\tAmount\tAmount/i.test(text) || /^Type\tDate\tRef$/m.test(text)) {
        throw new FormatChangedError("Unsupported 2017–2018 Hertford Town Council layout (supplier and payment printed on separate lines). Not imported.");
      }
      const r = parsePaymentListPdf(text, { split: splitHtcDetails });
      r.notes.push("Hertford Town Council publishes net amounts (Sage 'Net Amount' column).");
      for (const row of r.rows) row.amountIsNet = true;
      return r;
    }
    return tableToTransactions(readTable(buffer, file.format), { headerOverrides: { supplier: ["Details", "Payee"], amount: ["Net Amount", "Net"] } });
  },
};
