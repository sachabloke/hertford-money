/**
 * Hertford Town Council (parish tier).
 * Source: PDF payment lists ("payments over £100" / "payments over £500") published on hertford.gov.uk
 * under the Local Government Transparency Code for smaller authorities. Layout is a Sage-style list:
 * Date, N/C, Ref, Details, Net Amount. Discovery crawls one level from the home page to the finance /
 * transparency pages because the council does not publish a stable index URL.
 */
import type { Adapter, DiscoveredFile, NormalisedTransaction, ParseResult } from "../core/types";
import { fetchText } from "../core/fetch";
import { extractLinks, formatFromUrl } from "../core/html";
import { parsePaymentListPdf, pdfText } from "../core/pdf";
import { readTable } from "../core/table";
import { tableToTransactions } from "../core/generic";

export const HTC_HOME = "https://www.hertford.gov.uk/";
const LICENCE = "Published under the Transparency Code for Smaller Authorities; see source page for licence";
const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

function periodFromName(name: string): { start?: string; end?: string } {
  const s = name.toLowerCase();
  const range = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*-?(\d{2,4})-to-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*-?(\d{2,4})/);
  const yr = (y: string) => (y.length === 2 ? 2000 + +y : +y);
  if (range) {
    const a = MONTHS.indexOf(range[1]), b = MONTHS.indexOf(range[3]);
    return { start: new Date(Date.UTC(yr(range[2]), a, 1)).toISOString().slice(0, 10), end: new Date(Date.UTC(yr(range[4]), b + 1, 0)).toISOString().slice(0, 10) };
  }
  const one = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*-?(\d{2,4})/);
  if (one) {
    const a = MONTHS.indexOf(one[1]), y = yr(one[2]);
    return { start: new Date(Date.UTC(y, a, 1)).toISOString().slice(0, 10), end: new Date(Date.UTC(y, a + 1, 0)).toISOString().slice(0, 10) };
  }
  return {};
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
    const home = await fetchText(HTC_HOME);
    const homeLinks = extractLinks(home, HTC_HOME);
    const candidatePages = new Set<string>();
    for (const l of homeLinks) {
      if (!l.href.startsWith(HTC_HOME)) continue;
      if (/finance|transparen|payment|accounts|spend|budget|audit|publication|council-documents|documents/i.test(`${l.text} ${l.href}`)) candidatePages.add(l.href);
    }
    const out: DiscoveredFile[] = [];
    const seen = new Set<string>();
    const consider = (href: string, text: string, page: string) => {
      const fmt = formatFromUrl(href);
      if (!fmt || fmt === "html" || seen.has(href)) return;
      const name = `${text} ${decodeURIComponent(href.split("/").pop() ?? "")}`;
      if (!/payment/i.test(name) || !/(over|above)[-\s]*£?\s*(100|250|500)/i.test(name)) return;
      seen.add(href);
      const p = periodFromName(decodeURIComponent(href.split("/").pop() ?? ""));
      out.push({ kind: "transactions", title: `Payments list — ${text || href.split("/").pop()}`, url: href, pageUrl: page, format: fmt, licence: LICENCE, periodStart: p.start, periodEnd: p.end });
    };
    for (const l of homeLinks) consider(l.href, l.text, HTC_HOME);
    for (const page of candidatePages) {
      let html: string;
      try { html = await fetchText(page); } catch { continue; }
      for (const l of extractLinks(html, page)) consider(l.href, l.text, page);
    }
    if (out.length === 0) throw new Error(`No payment-list files found on hertford.gov.uk (scanned ${candidatePages.size + 1} pages). The site structure may have changed.`);
    return out;
  },
  async parseTransactions(buffer, file): Promise<ParseResult<NormalisedTransaction>> {
    if (file.format === "pdf") {
      const { text } = await pdfText(buffer);
      // Sage layout: "dd/mm/yyyy [N/C] [Ref] Details … Net". Keep Ref if it looks like one.
      return parsePaymentListPdf(text, {
        split: (details) => {
          const m = details.match(/^(?:(\d{4})\s+)?((?:BACS|DD|CHQ|SO|CARD|DC|TFR)[\w\/-]*|\d{3,})\s+(.+)$/i);
          if (m) return { supplier: m[3].trim(), reference: m[2], description: undefined };
          return { supplier: details };
        },
      });
    }
    return tableToTransactions(readTable(buffer, file.format), { headerOverrides: { supplier: ["Details", "Payee"], amount: ["Net Amount", "Net"] } });
  },
};
