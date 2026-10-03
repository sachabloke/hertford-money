/** Deterministic parsing helpers for UK council data: amounts, dates, financial years, headers. */

export function slugHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/£/g, "gbp")
    .replace(/[^a-z0-9]+/g, "");
}

/** Parse "£1,234.56", "(1,234.56)", "-1234.56", "1234.56 CR", "1,234.56-" into a number, or null. */
export function parseAmount(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? round2(v) : null;
  let s = String(v).trim();
  if (s === "" || /^(n\/?a|null|-)$/i.test(s)) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/\bcr\b/i.test(s)) { negative = true; s = s.replace(/\bcr\b/i, ""); }
  if (/^-/.test(s)) { negative = true; s = s.slice(1); }
  if (/-$/.test(s)) { negative = true; s = s.slice(0, -1); }
  s = s.replace(/[£$€,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return round2(negative ? -n : n);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse UK-style dates: dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, yyyy-mm-dd, dd MMM yyyy, dd-MMM-yy,
 * Excel serial numbers. Returns a UTC midnight Date or null. Never guesses US month-first order.
 */
export function parseUkDate(v: string | number | Date | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : utc(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === "number") {
    if (v > 20000 && v < 80000) { // Excel serial (1954–2119)
      const ms = Math.round((v - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return utc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/))) return utc(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:\s.*)?$/))) return utc(+m[3], +m[2], +m[1]);
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2})$/))) return utc(2000 + +m[3], +m[2], +m[1]);
  if ((m = s.match(/^(\d{1,2})[\s\-\/]([a-z]{3,9})[\s\-\/](\d{2,4})$/i))) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!mo) return null;
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return utc(y, mo, +m[1]);
  }
  if ((m = s.match(/^([a-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/i))) { // "April 3, 2025" — rare but seen
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (!mo) return null;
    return utc(+m[3], mo, +m[2]);
  }
  return null;
}

function utc(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // e.g. 31/02
  return dt;
}

/** UK local-government financial year runs 1 April – 31 March. */
export function financialYear(d: Date): string {
  const y = d.getUTCFullYear();
  const startYear = d.getUTCMonth() + 1 >= 4 ? y : y - 1;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function fyStart(fy: string): Date {
  const y = parseInt(fy.slice(0, 4), 10);
  return new Date(Date.UTC(y, 3, 1));
}
export function fyEnd(fy: string): Date {
  const y = parseInt(fy.slice(0, 4), 10);
  return new Date(Date.UTC(y + 1, 2, 31));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Map logical fields to the headers actually present. `candidates` is ordered by preference.
 * Matching is on slugged header names so "Supplier Name" == "supplier_name" == "SUPPLIER NAME".
 */
export function mapHeaders(
  headers: string[],
  spec: Record<string, string[]>,
  required: string[],
): { map: Record<string, string>; missing: string[] } {
  const slugged = headers.map((h) => [slugHeader(h), h] as const);
  const map: Record<string, string> = {};
  const used = new Set<string>();
  for (const [field, cands] of Object.entries(spec)) {
    for (const c of cands) {
      const hit = slugged.find(([s, h]) => s === slugHeader(c) && !used.has(h));
      if (hit) { map[field] = hit[1]; used.add(hit[1]); break; }
    }
  }
  const missing = required.filter((f) => !(f in map));
  return { map, missing };
}

export const TRANSACTION_HEADER_CANDIDATES: Record<string, string[]> = {
  date: ["payment date", "date paid", "date of payment", "paid date", "transaction date", "date", "invoice date", "effective date", "document date", "posting date", "cleared date"],
  supplier: ["supplier name", "supplier", "payee name", "payee", "vendor name", "vendor", "beneficiary", "creditor", "supplier/payee", "name", "merchant"],
  amount: ["net amount", "amount paid", "amount (£)", "amount gbp", "amount excl vat", "amount ex vat", "net", "payment amount", "invoice amount", "total amount", "amount", "value", "total", "gross amount", "net value", "line value", "sum"],
  department: ["department", "directorate", "department name", "service division", "division", "cost centre description", "cost centre name", "cost centre", "organisational unit", "body name"],
  serviceArea: ["service area", "service area name", "service category", "service", "service label", "service description", "area"],
  category: ["expense type", "expense category", "expenditure category", "expenses type", "expense area", "expense description", "account description", "subjective description", "nominal description", "expense type description", "category", "type of expenditure", "spend category", "capital or revenue", "account name"],
  description: ["description", "purpose", "narrative", "details", "purpose of expenditure", "invoice description", "transaction description", "detail", "line description", "item description", "purpose of spend"],
  reference: ["transaction number", "transaction no", "transaction ref", "transaction reference", "transaction id", "reference", "ref", "invoice number", "invoice no", "payment reference", "payment ref", "document number", "document no", "doc no", "voucher number", "voucher", "payment number", "ref no"],
};

export const CONTRACT_HEADER_CANDIDATES: Record<string, string[]> = {
  reference: ["contract reference", "contract ref", "reference", "ref", "contract id", "contract number", "id", "unique reference"],
  title: ["contract title", "title", "contract name", "name", "contract description", "description of contract", "subject"],
  description: ["description", "contract description", "purpose", "details", "scope", "summary"],
  supplier: ["supplier name", "supplier", "contractor", "provider", "awarded to", "vendor", "supplier/contractor", "contractor name"],
  value: ["contract value", "total contract value", "value", "value (£)", "estimated value", "annual value", "total value", "contract value (£)", "amount", "estimated contract value"],
  awardDate: ["award date", "date awarded", "awarded", "date of award", "contract award date"],
  startDate: ["start date", "contract start date", "commencement date", "start", "effective date"],
  endDate: ["end date", "contract end date", "expiry date", "expiry", "end", "finish date", "termination date"],
  reviewDate: ["review date", "extension date", "option to extend", "extension end date"],
  department: ["department", "directorate", "service", "service area", "business unit", "division", "contracting department"],
  category: ["category", "contract type", "type", "procurement category", "classification", "cpv description", "category description"],
  procurementRoute: ["procurement route", "procurement method", "procurement process", "route to market", "procurement procedure", "tender process", "process", "method"],
  sourceRecordUrl: ["url", "link", "contract url", "source", "web link", "hyperlink"],
};
