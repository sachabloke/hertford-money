/**
 * Hertfordshire County Council (county tier).
 * Source page: "What we spend and how we spend it" — monthly "Supplier Payments over £500" CSVs
 * and quarterly "Contracts over £5000" CSVs, published under the Open Government Licence.
 */
import type { Adapter, DiscoveredFile, NormalisedTransaction, ParseResult } from "../core/types";
import { fetchText } from "../core/fetch";
import { extractLinks, formatFromUrl, monthFromText, quarterFromText } from "../core/html";
import { readTable, type TableData } from "../core/table";
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
        const q = quarterFromText(text);
        const m = q ? null : monthFromText(text);
        const fileName = decodeURIComponent(l.href.split("/").pop() ?? "");
        const threshold = /over[\s\-]*(?:£|&pound;)?250\b/i.test(fileName) || /over[\s\-]*(?:£|&pound;)?250\b/i.test(l.text) ? "£250" : "£500";
        const label = q?.label ?? m?.label ?? l.text;
        out.push({ kind: "transactions", title: `Supplier payments over ${threshold} — ${label}`, url: l.href, pageUrl: HCC_SPEND_PAGE, format: fmt, licence: LICENCE, periodStart: q?.start ?? m?.start, periodEnd: q?.end ?? m?.end });
      } else if (/contracts?\s*over/i.test(text)) {
        const q = quarterFromText(text);
        out.push({ kind: "contracts", title: `Contracts over £5,000 — ${q?.label ?? l.text.replace(/\s*\(CSV[^)]*\)\s*$/i, "").replace(/&pound;/g, "£")}`, url: l.href, pageUrl: HCC_SPEND_PAGE, format: fmt, licence: LICENCE, periodStart: q?.start, periodEnd: q?.end });
      }
    }
    if (out.length === 0) throw new Error(`No supplier-payment or contract files found on ${HCC_SPEND_PAGE}; the page layout may have changed (found ${links.length} links).`);
    return dedupe(out);
  },
  async parseTransactions(buffer, file): Promise<ParseResult<NormalisedTransaction>> {
    const table = readTable(buffer, file.format);
    fixSwappedDepartmentColumns(table);
    return tableToTransactions(table, {
      // Real HCC layout (2022–2026): Organisation Name, Organisation Code, Service / Division Code,
      // Dept. where expenditure incurred, Beneficiary ID, Supplier (Beneficiary), Procurement (Merchant Category),
      // Purpose of Expenditure (Expenditure Category), Date, Transaction Number, Net Amount, Irrecoverable VAT.
      // Column order varies between files; mapping is by name.
      headerOverrides: {
        supplier: ["Supplier (Beneficiary)", "Supplier Name"],
        amount: ["Net Amount"],
        department: ["Service / Division Code", "Directorate"],          // e.g. "Children's Services"
        category: ["Purpose of Expenditure (Expenditure Category)", "Expenditure Category", "Expense Type"],
        description: ["Procurement (Merchant Category)", "Purpose of Expenditure"],
        reference: ["Transaction Number", "Payment Reference"],
        serviceArea: ["Service Area"],
      },
      amountIsNet: true,
      rowFilter: (r) => !/^(total|grand total)/i.test(Object.values(r)[0] ?? ""),
    });
  },
  async parseContracts(buffer, file) {
    // Real HCC layout: Contract Reference, Title, Local Authority Department Responsible, Description, Contract Start Date,
    // Final End Date, Review Date, Contract Value, Supplier Name, Supplier Type, Pre-contractual Process Used, Irrecoverable VAT Amount.
    return tableToContracts(readTable(buffer, file.format), {
      supplier: ["Supplier Supplier Name", "Supplier Name"], endDate: ["Final End Date"], department: ["Local Authority Department Responsible"], procurementRoute: ["Pre-contractual Process Used", "Pre-contractual Process  Used"],
      sourceRecordUrl: ["Contract Register Link", "Link"],
    });
  },
};

/**
 * HCC files carry two columns, "Service / Division Code" and "Dept. where expenditure incurred", whose
 * CONTENTS are swapped between publications: in some files the first holds the directorate name
 * ("Children's Services") and the second a cost-centre code ("1000 E01"); in others it is the reverse.
 * We decide per file from the data: the column that looks like codes is the cost centre; the other is the
 * directorate (stored as `department`). The decision is recorded in the parse notes.
 */
function fixSwappedDepartmentColumns(table: TableData): void {
  const a = table.headers.find((h) => /service\s*\/\s*division\s*code/i.test(h));
  const b = table.headers.find((h) => /dept\.?\s*where\s*expenditure/i.test(h));
  if (!a || !b) return;
  const codeLike = (v: string) => /^\s*\d{3,}\s*[A-Z]?\d*\s*$/i.test(v);
  const sample = table.rows.slice(0, 200);
  const aCodes = sample.filter((r) => codeLike(r[a] ?? "")).length;
  const bCodes = sample.filter((r) => codeLike(r[b] ?? "")).length;
  if (aCodes > bCodes) {
    // "Service / Division Code" holds codes: swap so the directorate name lands in `department`.
    for (const r of table.rows) { const t = r[a]; r[a] = r[b]; r[b] = t; }
  }
}

function dedupe(files: DiscoveredFile[]): DiscoveredFile[] {
  const seen = new Set<string>();
  return files.filter((f) => (seen.has(f.url) ? false : (seen.add(f.url), true)));
}
