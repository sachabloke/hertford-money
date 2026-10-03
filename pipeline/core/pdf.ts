/** PDF text extraction (pdf-parse) + a generic "payment list" line parser for small councils' PDFs. */
import { createRequire } from "node:module";
import { FormatChangedError, type NormalisedTransaction, type ParseResult, type RejectedRow } from "./types";
import { parseAmount, parseUkDate } from "./parse";

const require = createRequire(import.meta.url);

export async function pdfText(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const pdfParse = require("pdf-parse") as (b: Buffer) => Promise<{ text: string; numpages: number }>;
  const data = await pdfParse(buffer);
  return { text: data.text, pages: data.numpages };
}

/**
 * Parse lines of the form  "<date> [code] [ref] <details …> <amount>" which is how Sage/Scribe/RBS
 * exports from parish and town councils usually print. Everything between the date and the amount
 * is kept verbatim as `supplierRaw` (town councils typically publish payee and purpose in one field)
 * unless the adapter supplies a splitter.
 */
export function parsePaymentListPdf(
  text: string,
  opts: { split?: (details: string) => { supplier: string; description?: string; reference?: string }; minParseRate?: number } = {},
): ParseResult<NormalisedTransaction> {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const rows: NormalisedTransaction[] = [];
  const rejected: RejectedRow[] = [];
  let candidates = 0;
  const re = /^(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s+(.*?)\s+(-?\(?£?[\d,]+\.\d{2}\)?)(?:\s+-?\(?£?[\d,]+\.\d{2}\)?){0,2}\s*$/;
  lines.forEach((line, i) => {
    const m = line.match(re);
    if (!m) return;
    candidates++;
    const date = parseUkDate(m[1]);
    const amount = parseAmount(m[3]);
    const details = m[2].trim();
    if (!date) { rejected.push({ rowNumber: i + 1, reason: `bad date ${m[1]}`, raw: line }); return; }
    if (amount === null) { rejected.push({ rowNumber: i + 1, reason: `bad amount ${m[3]}`, raw: line }); return; }
    if (!details) { rejected.push({ rowNumber: i + 1, reason: "no details", raw: line }); return; }
    const parts = opts.split ? opts.split(details) : { supplier: details };
    rows.push({ rowNumber: i + 1, date, supplierRaw: parts.supplier, amount, description: parts.description, reference: parts.reference });
  });
  if (candidates === 0) throw new FormatChangedError("No payment lines matched the '<date> … <amount>' pattern in this PDF. The council may have changed its report layout, or the PDF is scanned (no text layer).");
  return { rows, rejected, headers: ["(pdf line)"], headerMap: { date: "line start", supplier: "details", amount: "line end" }, notes: ["Parsed from PDF text; the published 'Details' field is kept verbatim as the supplier/payee."] };
}
