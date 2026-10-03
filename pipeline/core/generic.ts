/**
 * Generic table → NormalisedTransaction / NormalisedContract conversion shared by adapters.
 * Adapters pass extra header candidates and quirks; the core enforces required fields and
 * fails visibly when the published layout changes.
 */
import { FormatChangedError, type NormalisedContract, type NormalisedTransaction, type ParseResult, type RejectedRow } from "./types";
import { CONTRACT_HEADER_CANDIDATES, TRANSACTION_HEADER_CANDIDATES, mapHeaders, parseAmount, parseUkDate } from "./parse";
import { isRedactedName } from "./supplier";
import type { TableData } from "./table";

export interface TransactionQuirks {
  headerOverrides?: Record<string, string[]>;   // prepended candidates
  amountIsNet?: boolean;
  /** Called on each raw row before mapping; return false to skip (e.g. subtotal lines). */
  rowFilter?: (row: Record<string, string>) => boolean;
  /** Keep every unmapped column verbatim in `extra` (default true). */
  keepExtra?: boolean;
}

export function tableToTransactions(table: TableData, quirks: TransactionQuirks = {}): ParseResult<NormalisedTransaction> {
  const spec: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(TRANSACTION_HEADER_CANDIDATES)) spec[k] = [...(quirks.headerOverrides?.[k] ?? []), ...v];
  const { map, missing } = mapHeaders(table.headers, spec, ["date", "supplier", "amount"]);
  if (missing.length) {
    throw new FormatChangedError(
      `Required columns not found: ${missing.join(", ")}. Headers in file: [${table.headers.join(" | ")}]. ` +
      `If the council has renamed its columns, add the new name to the adapter's headerOverrides.`,
      { headers: table.headers, map },
    );
  }
  const rows: NormalisedTransaction[] = [];
  const rejected: RejectedRow[] = [];
  const notes: string[] = [];
  const mapped = new Set(Object.values(map));

  for (const r of table.rows) {
    const rowNumber = parseInt(r.__row, 10);
    if (quirks.rowFilter && !quirks.rowFilter(r)) continue;
    const supplierRaw = (r[map.supplier] ?? "").trim();
    const date = parseUkDate(r[map.date]);
    const amount = parseAmount(r[map.amount]);
    if (!supplierRaw) {
      // Councils sometimes leave trailing total rows; an empty supplier with no date is noise, else a reject.
      if (!r[map.date] && amount !== null) { notes.push(`row ${rowNumber}: amount with no supplier/date ignored (likely a total line)`); continue; }
      rejected.push({ rowNumber, reason: "missing supplier", raw: r }); continue;
    }
    if (!date) { rejected.push({ rowNumber, reason: `unparseable date "${r[map.date]}"`, raw: r }); continue; }
    if (amount === null) { rejected.push({ rowNumber, reason: `unparseable amount "${r[map.amount]}"`, raw: r }); continue; }
    const t: NormalisedTransaction = {
      rowNumber,
      date,
      supplierRaw: isRedactedName(supplierRaw) ? "REDACTED (as published)" : supplierRaw,
      amount,
      amountIsNet: quirks.amountIsNet,
      department: clean(r[map.department]),
      serviceArea: clean(r[map.serviceArea]),
      category: clean(r[map.category]),
      description: clean(r[map.description]),
      reference: clean(r[map.reference]),
    };
    if (quirks.keepExtra !== false) {
      const extra: Record<string, string> = {};
      for (const h of table.headers) if (!mapped.has(h) && r[h]) extra[h] = r[h];
      if (Object.keys(extra).length) t.extra = extra;
    }
    rows.push(t);
  }
  return { rows, rejected, headers: table.headers, headerMap: map, notes: dedupeNotes(notes) };
}

export function tableToContracts(table: TableData, overrides: Record<string, string[]> = {}): ParseResult<NormalisedContract> {
  const spec: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(CONTRACT_HEADER_CANDIDATES)) spec[k] = [...(overrides[k] ?? []), ...v];
  const { map, missing } = mapHeaders(table.headers, spec, ["title", "supplier"]);
  if (missing.length) {
    throw new FormatChangedError(`Required contract columns not found: ${missing.join(", ")}. Headers: [${table.headers.join(" | ")}]`, { headers: table.headers, map });
  }
  const rows: NormalisedContract[] = [];
  const rejected: RejectedRow[] = [];
  const mapped = new Set(Object.values(map));
  for (const r of table.rows) {
    const rowNumber = parseInt(r.__row, 10);
    const title = clean(r[map.title]);
    const supplierRaw = clean(r[map.supplier]);
    if (!title && !supplierRaw) continue;
    if (!title) { rejected.push({ rowNumber, reason: "missing title", raw: r }); continue; }
    if (!supplierRaw) { rejected.push({ rowNumber, reason: "missing supplier", raw: r }); continue; }
    const c: NormalisedContract = {
      rowNumber,
      title,
      supplierRaw: isRedactedName(supplierRaw) ? "REDACTED (as published)" : supplierRaw,
      reference: clean(r[map.reference]),
      description: clean(r[map.description]),
      value: parseAmount(r[map.value]) ?? undefined,
      valueBasis: map.value,
      awardDate: parseUkDate(r[map.awardDate]) ?? undefined,
      startDate: parseUkDate(r[map.startDate]) ?? undefined,
      endDate: parseUkDate(r[map.endDate]) ?? undefined,
      reviewDate: parseUkDate(r[map.reviewDate]) ?? undefined,
      department: clean(r[map.department]),
      category: clean(r[map.category]),
      procurementRoute: clean(r[map.procurementRoute]),
      sourceRecordUrl: clean(r[map.sourceRecordUrl]),
    };
    const extra: Record<string, string> = {};
    for (const h of table.headers) if (!mapped.has(h) && r[h]) extra[h] = r[h];
    if (Object.keys(extra).length) c.extra = extra;
    rows.push(c);
  }
  return { rows, rejected, headers: table.headers, headerMap: map, notes: [] };
}

function clean(v: string | undefined): string | undefined {
  const s = (v ?? "").trim();
  return s === "" ? undefined : s;
}
function dedupeNotes(notes: string[]): string[] {
  return notes.length > 10 ? [...notes.slice(0, 10), `… and ${notes.length - 10} more`] : notes;
}
