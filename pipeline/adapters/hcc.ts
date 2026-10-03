/**
 * Hertfordshire County Council (county tier).
 * Source page: "What we spend and how we spend it" — monthly "Supplier Payments over £500" CSVs
 * and quarterly "Contracts over £5000" CSVs, published under the Open Government Licence.
 */
import type { Adapter, DiscoveredFile, NormalisedTransaction, ParseResult } from "../core/types";
import { fetchText } from "../core/fetch";
import { extractLinks, formatFromUrl, monthFromText, quarterFromText } from "../core/html";
import { readTable } from "../core/table";
import { tableToContracts, tableToTransactions } from "../core/generic";

export const HCC_SPEND_PAGE =
  "https://www.hertfordshire.gov.uk/about-the-council/freedom-of-information-and-council-data/open-data-statistics-about-hertfordshire/what-we-spend-and-how-we-spend-it/what-we-spend-and-how-we-spend-it.aspx";
export const HCC_CONTRACT_REGISTER = "https://www.hertfordshire.gov.uk/ContractRegister/";
const LICENCE = "Open Government Licence v3.0 (stated on the council's open data pages)";

export const hcc: Adapter = {
  id: "hcc",
  authority: {
    id: "hcc",
    name: "Hertfordshire County Council",
    shortName: "Herts County Council",
    tier: "county",
    area: "Hertfordshire",
    website: "https://www.hertfordshire.gov.uk/",
    onsCode: "E10000015",
    notes: "Upper-tier authority: adult social care, children's services, highways, education, waste disposal, libraries, fire and rescue.",
  },
  async discover() {
    const html = await fetchText(HCC_SPEND_PAGE);
    const links = extractLinks(html, HCC_SPEND_PAGE);
    const out: DiscoveredFile[] = [];
    for (const l of links) {
      const fmt = formatFromUrl(l.href);
      if (!fmt || fmt === "pdf" || fmt === "html") continue;
      const text = `${l.text} ${decodeURIComponent(l.href.split("/").pop() ?? "")}`;
      if (/supplier\s*payments|payments\s*over|spend\s*over/i.test(text)) {
        const m = monthFromText(text);
        out.push({ kind: "transactions", title: `Supplier payments over £500 — ${m?.label ?? l.text}`, url: l.href, pageUrl: HCC_SPEND_PAGE, format: fmt, licence: LICENCE, periodStart: m?.start, periodEnd: m?.end });
      } else if (/contracts?\s*over/i.test(text)) {
        const q = quarterFromText(text);
        out.push({ kind: "contracts", title: `Contracts over £5,000 — ${q?.label ?? l.text}`, url: l.href, pageUrl: HCC_SPEND_PAGE, format: fmt, licence: LICENCE, periodStart: q?.start, periodEnd: q?.end });
      }
    }
    if (out.length === 0) throw new Error(`No supplier-payment or contract files found on ${HCC_SPEND_PAGE}; the page layout may have changed (found ${links.length} links).`);
    return dedupe(out);
  },
  async parseTransactions(buffer, file): Promise<ParseResult<NormalisedTransaction>> {
    const table = readTable(buffer, file.format);
    return tableToTransactions(table, {
      headerOverrides: {
        department: ["Directorate", "Department Name", "Service Division"],
        category: ["Expense Type", "Expenditure Category", "Subjective"],
        description: ["Purpose of Expenditure", "Expense Description"],
        reference: ["Transaction Number", "Payment Reference"],
      },
      rowFilter: (r) => !/^(total|grand total)/i.test(Object.values(r)[0] ?? ""),
    });
  },
  async parseContracts(buffer, file) {
    return tableToContracts(readTable(buffer, file.format), { sourceRecordUrl: ["Contract Register Link", "Link"] });
  },
};

function dedupe(files: DiscoveredFile[]): DiscoveredFile[] {
  const seen = new Set<string>();
  return files.filter((f) => (seen.has(f.url) ? false : (seen.add(f.url), true)));
}
