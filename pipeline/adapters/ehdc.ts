/**
 * East Herts District Council (district tier).
 * Source: yearly "Council Spending Reports <year>" pages listing weekly reports
 * ("Council spending report w/c <date>"), plus the Contract Register page.
 */
import type { Adapter, DiscoveredFile, NormalisedTransaction, ParseResult } from "../core/types";
import { fetchText, DownloadError } from "../core/fetch";
import { extractLinks, formatFromUrl } from "../core/html";
import { readTable } from "../core/table";
import { tableToContracts, tableToTransactions } from "../core/generic";
import { parsePaymentListPdf, pdfText } from "../core/pdf";
import { parseUkDate, isoDate } from "../core/parse";

export const EHDC_CONTRACT_REGISTER = "https://www.eastherts.gov.uk/about-east-herts-0/contract-register";
const LICENCE = "Published under the Local Government Transparency Code 2015; see source page for licence";

function spendingPages(): string[] {
  const y = new Date().getUTCFullYear();
  const out: string[] = [];
  for (let year = y; year >= 2019; year--) {
    out.push(`https://www.eastherts.gov.uk/council-spending-reports-${year}`);
    out.push(`https://www.eastherts.gov.uk/about-east-herts-0/council-spending-reports-${year}`);
  }
  return out;
}

export const ehdc: Adapter = {
  id: "ehdc",
  authority: {
    id: "ehdc",
    name: "East Herts District Council",
    shortName: "East Herts Council",
    tier: "district",
    area: "Hertfordshire",
    website: "https://www.eastherts.gov.uk/",
    onsCode: "E07000097",
    notes: "District council for Hertford, Ware, Bishop's Stortford, Sawbridgeworth and Buntingford: planning, waste collection, housing, leisure, council tax collection.",
  },
  async discover() {
    const out: DiscoveredFile[] = [];
    let pagesFound = 0;
    for (const page of spendingPages()) {
      let html: string;
      try { html = await fetchText(page); } catch (e) { if (e instanceof DownloadError && e.status === 404) continue; throw e; }
      pagesFound++;
      for (const l of extractLinks(html, page)) {
        const fmt = formatFromUrl(l.href);
        if (!fmt || fmt === "html") continue;
        if (!/spending\s*report|w\/c|week\s*commencing/i.test(l.text)) continue;
        const dm = l.text.match(/(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/);
        const start = dm ? parseUkDate(dm[1].replace(/(\d)(st|nd|rd|th)/, "$1")) : null;
        const end = start ? new Date(start.getTime() + 6 * 86400_000) : null;
        out.push({ kind: "transactions", title: `Council spending report — ${l.text.replace(/^council spending report\s*/i, "")}`.trim(), url: l.href, pageUrl: page, format: fmt, licence: LICENCE, periodStart: start ? isoDate(start) : undefined, periodEnd: end ? isoDate(end) : undefined });
      }
    }
    try {
      const html = await fetchText(EHDC_CONTRACT_REGISTER);
      for (const l of extractLinks(html, EHDC_CONTRACT_REGISTER)) {
        const fmt = formatFromUrl(l.href);
        if (fmt && fmt !== "html" && fmt !== "pdf" && /contract/i.test(`${l.text} ${l.href}`)) out.push({ kind: "contracts", title: `Contract register — ${l.text}`, url: l.href, pageUrl: EHDC_CONTRACT_REGISTER, format: fmt, licence: LICENCE });
      }
    } catch (e) { console.warn(`[ehdc] contract register page not read: ${(e as Error).message}`); }
    if (pagesFound === 0) throw new Error("No East Herts spending-report pages were found; the URL pattern may have changed.");
    if (out.length === 0) throw new Error(`East Herts spending-report pages were found but contained no recognisable report links.`);
    const seen = new Set<string>();
    return out.filter((f) => (seen.has(f.url) ? false : (seen.add(f.url), true)));
  },
  async parseTransactions(buffer, file): Promise<ParseResult<NormalisedTransaction>> {
    if (file.format === "pdf") {
      const { text } = await pdfText(buffer);
      return parsePaymentListPdf(text);
    }
    return tableToTransactions(readTable(buffer, file.format), {
      headerOverrides: { department: ["Service Area", "Cost Centre Description", "Directorate"], category: ["Expense Type", "Expenditure Category", "Nominal Description"], description: ["Invoice Description", "Narrative"] },
    });
  },
  async parseContracts(buffer, file) {
    return tableToContracts(readTable(buffer, file.format));
  },
};
