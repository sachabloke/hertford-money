import { describe, it, expect } from "vitest";
import { parseAmount, parseUkDate, financialYear, mapHeaders, TRANSACTION_HEADER_CANDIDATES } from "../pipeline/core/parse";
import { normaliseSupplierName, isRedactedName } from "../pipeline/core/supplier";
import { monthFromText, quarterFromText, extractLinks } from "../pipeline/core/html";
import { readCsv } from "../pipeline/core/table";
import { tableToTransactions } from "../pipeline/core/generic";
import { validateTransactions } from "../pipeline/core/validate";
import { readFileSync } from "node:fs";

describe("parseAmount", () => {
  it("handles UK formats", () => {
    expect(parseAmount("£1,234.56")).toBe(1234.56);
    expect(parseAmount("(1,234.56)")).toBe(-1234.56);
    expect(parseAmount("-500")).toBe(-500);
    expect(parseAmount("1,000.00 CR")).toBe(-1000);
    expect(parseAmount("1234.5-")).toBe(-1234.5);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("n/a")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount(12.345)).toBe(12.35);
  });
});

describe("parseUkDate", () => {
  it("parses day-first and ISO formats only", () => {
    expect(parseUkDate("03/04/2025")?.toISOString()).toBe("2025-04-03T00:00:00.000Z");
    expect(parseUkDate("2025-04-03")?.toISOString()).toBe("2025-04-03T00:00:00.000Z");
    expect(parseUkDate("3 Apr 2025")?.toISOString()).toBe("2025-04-03T00:00:00.000Z");
    expect(parseUkDate("03-APR-25")?.toISOString()).toBe("2025-04-03T00:00:00.000Z");
    expect(parseUkDate("31/02/2025")).toBeNull();
    expect(parseUkDate("13/13/2025")).toBeNull();
    expect(parseUkDate(45748)?.toISOString()).toBe("2025-04-01T00:00:00.000Z"); // Excel serial
  });
  it("financial year starts 1 April", () => {
    expect(financialYear(new Date(Date.UTC(2025, 2, 31)))).toBe("2024/25");
    expect(financialYear(new Date(Date.UTC(2025, 3, 1)))).toBe("2025/26");
  });
});

describe("supplier normalisation", () => {
  it("collapses trivial spelling differences only", () => {
    const k = normaliseSupplierName("ACME LTD");
    expect(normaliseSupplierName("Acme Limited")).toBe(k);
    expect(normaliseSupplierName("ACME LTD.")).toBe(k);
    expect(normaliseSupplierName("  acme   ltd ")).toBe(k);
    expect(normaliseSupplierName("Acme & Sons Ltd")).toBe(normaliseSupplierName("ACME AND SONS LIMITED"));
    expect(normaliseSupplierName("ACME PLC")).not.toBe(k);
    expect(normaliseSupplierName("ACME HOLDINGS LTD")).not.toBe(k);
    expect(normaliseSupplierName("ACME")).not.toBe(k); // no legal form: kept separate (conservative)
  });
  it("detects redactions", () => {
    expect(isRedactedName("REDACTED")).toBe(true);
    expect(isRedactedName("Name Withheld")).toBe(true);
    expect(isRedactedName("Redacted Builders Ltd")).toBe(true);
    expect(isRedactedName("Acme Ltd")).toBe(false);
  });
});

describe("html helpers", () => {
  it("extracts month/quarter periods from link text", () => {
    expect(monthFromText("Supplier Payments over £500 July 2026 (CSV 4MB)")).toMatchObject({ start: "2026-07-01", end: "2026-07-31" });
    expect(monthFromText("supplier-payments-jul-26.csv")).toMatchObject({ start: "2026-07-01" });
    expect(quarterFromText("Contracts over £5000 April - June 2026")).toMatchObject({ start: "2026-04-01", end: "2026-06-30" });
    expect(quarterFromText("Contracts over £5000 Oct - Dec 2025")).toMatchObject({ start: "2025-10-01", end: "2025-12-31" });
  });
  it("extracts absolute links", () => {
    const links = extractLinks('<a href="/media/a.csv">A <b>file</b></a> <a href="#x">no</a>', "https://example.gov.uk/page");
    expect(links).toEqual([{ href: "https://example.gov.uk/media/a.csv", text: "A file" }]);
  });
});

describe("header mapping", () => {
  it("maps real-world header spellings", () => {
    const { map, missing } = mapHeaders(["Directorate", "Supplier Name", "Amount (£)", "Payment Date", "Transaction Number"], TRANSACTION_HEADER_CANDIDATES, ["date", "supplier", "amount"]);
    expect(missing).toEqual([]);
    expect(map).toMatchObject({ date: "Payment Date", supplier: "Supplier Name", amount: "Amount (£)", department: "Directorate", reference: "Transaction Number" });
  });
  it("fails visibly when a required column is absent", () => {
    const csv = Buffer.from("Something,Other,Third\n1,2,3\n");
    expect(() => tableToTransactions(readCsv(csv))).toThrow(/Required columns not found/);
  });
});

describe("fixture CSV → transactions → validation", () => {
  const buf = readFileSync(new URL("./fixtures/fixture-payments.csv", import.meta.url));
  it("skips the title line, rejects bad rows, ignores the total line, keeps credit notes", () => {
    const parsed = tableToTransactions(readCsv(buf));
    expect(parsed.headerMap.supplier).toBe("Supplier Name");
    expect(parsed.rows).toHaveLength(6);
    expect(parsed.rejected).toHaveLength(1);
    expect(parsed.rejected[0].reason).toMatch(/unparseable date/);
    expect(parsed.rows.find((r) => r.supplierRaw === "REDACTED (as published)")).toBeTruthy();
    expect(parsed.rows.find((r) => r.amount === -500)).toBeTruthy();
    const report = validateTransactions(parsed, { maxRejectRate: 0.5 });
    expect(report.totalAmount).toBe(19600.5);
    expect(report.duplicateLookingRows).toBe(1);
    expect(report.negativeRows).toBe(1);
    expect(report.distinctSuppliers).toBe(4); // two Acme spellings count separately here; merged later by normalisation
  });
  it("fails validation when too many rows are rejected", () => {
    const parsed = tableToTransactions(readCsv(buf));
    expect(() => validateTransactions(parsed, { maxRejectRate: 0.01 })).toThrow(/Validation failed/);
  });
});

describe("decision report section extraction", async () => {
  const { extractSections } = await import("../pipeline/core/decisions");
  it("finds standard headings and keeps text verbatim", () => {
    const text = `East Herts Council Report\nCabinet\n1. Recommendation\nThat Cabinet approves the award of the waste contract to Supplier X for £2.1m per year.\n2. Reasons for recommendation\nThe current contract expires in March.\n3. Alternative options considered\nIn-house delivery was considered and rejected on cost grounds.\n4. Financial implications\nThe cost is within the approved budget.\nLegal implications\nNone.`;
    const s = extractSections(text);
    expect(s.proposal).toMatch(/approves the award/);
    expect(s.councilReason).toMatch(/expires in March/);
    expect(s.alternatives).toMatch(/In-house/);
    expect(s.financialImplications).toBe("The cost is within the approved budget.");
    expect(s.outcome).toBeUndefined();
  });
});

describe("Hertford Town Council PDF helpers", async () => {
  const { periodFromTitle, splitHtcDetails } = await import("../pipeline/adapters/htc");
  const { parsePaymentListPdf } = await import("../pipeline/core/pdf");
  it("reads periods from document titles", () => {
    expect(periodFromTitle("Payments over £100 Apr - Jun 24")).toEqual({ start: "2024-04-01", end: "2024-06-30" });
    expect(periodFromTitle("Payments Over £100 Jul 26")).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    expect(periodFromTitle("Payments over £100 June 26")).toEqual({ start: "2026-06-01", end: "2026-06-30" });
  });
  it("splits Sage details into supplier, description, reference and method", () => {
    expect(splitHtcDetails("1200 BACSGASCOYNE CECIL ESTATES - Castle Quarterly Rent")).toEqual({ supplier: "GASCOYNE CECIL ESTATES", description: "Castle Quarterly Rent", reference: undefined, extra: { "N/C": "1200", "Payment method": "BACS" } });
    expect(splitHtcDetails("BACSACORN SAFETY SERVICES - #PL2165# 15x Legionella samples")).toMatchObject({ supplier: "ACORN SAFETY SERVICES", description: "15x Legionella samples", reference: "PL2165" });
    expect(splitHtcDetails("BACSJuly 2026 - Payroll").supplier).toBe("July 2026 - Payroll");
    expect(splitHtcDetails("1200 BACSNet Pay - 1 - 24/25 -").supplier).toBe("Net Pay - 1 - 24/25 -");
  });
  it("parses tab-separated column text and refuses to guess where description meets amount", () => {
    const text = "Date\tRef\tDetails\tNet Amount\n01/07/2026BACS\tBRITISH GAS - #PL2155# 16 May 2026 to 15 June 2026\t493.77\n14/07/2026BACS\tGASCOYNE CECIL ESTATES - #PL2112# Rent in Advance\t19,182.00\n";
    const r = parsePaymentListPdf(text, { split: splitHtcDetails });
    expect(r.rows.map((x) => x.amount)).toEqual([493.77, 19182]);
    expect(r.rows[0].supplierRaw).toBe("BRITISH GAS");
  });
});

describe("non-supplier payees", async () => {
  const { isNonSupplierPayee } = await import("../pipeline/core/supplier");
  it("excludes numeric IDs and payroll lines from supplier ranking", () => {
    expect(isNonSupplierPayee("708967")).toBe(true);
    expect(isNonSupplierPayee("July 2026 - Payroll")).toBe(true);
    expect(isNonSupplierPayee("Net Pay - 1 - 24/25 -")).toBe(true);
    expect(isNonSupplierPayee("PAYE 1 - 24/25 -")).toBe(true);
    expect(isNonSupplierPayee("HMRC")).toBe(false);
    expect(isNonSupplierPayee("ACME LTD")).toBe(false);
  });
});
