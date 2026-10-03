/**
 * Dataset validation. Produces a machine-readable report that is stored on the ImportRun
 * and shown on the Sources page. Hard failures throw; soft issues are counted.
 */
import { createHash } from "node:crypto";
import type { NormalisedTransaction, ParseResult, RejectedRow } from "./types";
import { round2 } from "./parse";

export interface ValidationReport {
  rowsParsed: number;
  rowsRejected: number;
  rejectedSample: RejectedRow[];
  totalAmount: number;
  positiveTotal: number;
  negativeTotal: number;
  negativeRows: number;
  minDate: string | null;
  maxDate: string | null;
  datesOutsidePeriod: number;
  distinctSuppliers: number;
  duplicateLookingRows: number;      // identical (date, supplier, amount, reference) within the file
  headers: string[];
  headerMap: Record<string, string>;
  notes: string[];
  warnings: string[];
  publishedTotal?: number;            // if the council states a total somewhere, compared here
  publishedTotalMatches?: boolean;
}

export function rowHash(t: NormalisedTransaction): string {
  const key = [
    t.date.toISOString().slice(0, 10),
    t.supplierRaw.trim().toLowerCase(),
    t.amount.toFixed(2),
    (t.reference ?? "").trim().toLowerCase(),
    (t.description ?? "").trim().toLowerCase(),
    (t.category ?? "").trim().toLowerCase(),
    (t.department ?? "").trim().toLowerCase(),
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

export function validateTransactions(
  parsed: ParseResult<NormalisedTransaction>,
  opts: { periodStart?: Date; periodEnd?: Date; maxRejectRate?: number } = {},
): ValidationReport {
  const warnings: string[] = [];
  let total = 0, pos = 0, neg = 0, negRows = 0, outside = 0;
  let minDate: Date | null = null, maxDate: Date | null = null;
  const suppliers = new Set<string>();
  const seen = new Map<string, number>();
  let dupes = 0;

  for (const t of parsed.rows) {
    total += t.amount;
    if (t.amount < 0) { neg += t.amount; negRows++; } else pos += t.amount;
    if (!minDate || t.date < minDate) minDate = t.date;
    if (!maxDate || t.date > maxDate) maxDate = t.date;
    if (opts.periodStart && t.date < opts.periodStart) outside++;
    if (opts.periodEnd && t.date > opts.periodEnd) outside++;
    suppliers.add(t.supplierRaw.trim().toLowerCase());
    const k = `${t.date.toISOString().slice(0, 10)}|${t.supplierRaw.trim().toLowerCase()}|${t.amount.toFixed(2)}|${t.reference ?? ""}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n > 1) dupes++;
  }

  const rowsParsed = parsed.rows.length;
  const rowsRejected = parsed.rejected.length;
  const rejectRate = rowsParsed + rowsRejected === 0 ? 1 : rowsRejected / (rowsParsed + rowsRejected);
  const maxRejectRate = opts.maxRejectRate ?? 0.02;

  if (rowsParsed === 0) throw new Error("Validation failed: no rows could be parsed from the file.");
  // A single unreadable line in a small file is recorded (rejectedSample) but does not block the file.
  if (rejectRate > maxRejectRate && rowsRejected > 1) {
    throw new Error(
      `Validation failed: ${rowsRejected} of ${rowsParsed + rowsRejected} rows rejected (${(rejectRate * 100).toFixed(1)}% > ${(maxRejectRate * 100).toFixed(1)}%). ` +
      `First reasons: ${parsed.rejected.slice(0, 3).map((r) => `row ${r.rowNumber}: ${r.reason}`).join("; ")}`,
    );
  }
  if (outside > rowsParsed * 0.2) warnings.push(`${outside} rows dated outside the dataset's stated period.`);
  if (dupes > 0) warnings.push(`${dupes} duplicate-looking rows (same date, supplier, amount and reference). They are imported and flagged, not dropped: councils do make repeated identical payments.`);
  if (negRows > 0) warnings.push(`${negRows} negative rows (credit notes / refunds) totalling £${round2(neg).toLocaleString("en-GB")}. Included in totals as published.`);

  return {
    rowsParsed,
    rowsRejected,
    rejectedSample: parsed.rejected.slice(0, 20),
    totalAmount: round2(total),
    positiveTotal: round2(pos),
    negativeTotal: round2(neg),
    negativeRows: negRows,
    minDate: minDate ? minDate.toISOString().slice(0, 10) : null,
    maxDate: maxDate ? maxDate.toISOString().slice(0, 10) : null,
    datesOutsidePeriod: outside,
    distinctSuppliers: suppliers.size,
    duplicateLookingRows: dupes,
    headers: parsed.headers,
    headerMap: parsed.headerMap,
    notes: parsed.notes,
    warnings,
  };
}
