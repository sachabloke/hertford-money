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
 * Extract text with column structure preserved: items on the same line are joined with TABs in x order.
 * Needed for payment lists where plain text extraction runs the description into the amount.
 */
export async function pdfTextWithColumns(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const pdfParse = require("pdf-parse") as (b: Buffer, o: { pagerender: (p: unknown) => Promise<string> }) => Promise<{ text: string; numpages: number }>;
  const pagerender = async (pageData: unknown) => {
    const p = pageData as { getTextContent: (o: Record<string, boolean>) => Promise<{ items: Array<{ str: string; transform: number[] }> }> };
    const tc = await p.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: true });
    const rows = new Map<number, Array<{ x: number; str: string }>>();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 2) * 2; // bucket by baseline (2pt tolerance)
      const x = it.transform[4];
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ x, str: it.str });
    }
    const ys = [...rows.keys()].sort((a, b) => b - a); // top of page first
    const lines = ys.map((y) => {
      const items = rows.get(y)!.sort((a, b) => a.x - b.x);
      // Every text item is its own cell; the parser decides which cells are date, details and amount.
      const cells = items.map((it) => it.str);
      return cells.join("\t");
    });
    return lines.join("\n") + "\n";
  };
  const data = await pdfParse(buffer, { pagerender });
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
  opts: { split?: (details: string) => { supplier: string; description?: string; reference?: string; extra?: Record<string, string> }; minParseRate?: number } = {},
): ParseResult<NormalisedTransaction> {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[ ]+/g, " ").trim()).filter(Boolean);
  const rows: NormalisedTransaction[] = [];
  const rejected: RejectedRow[] = [];
  let candidates = 0;
  // If the PDF carries a header row (tab-separated), map columns by name for rows with the same cell count.
  let header: { count: number; date: number; supplier: number; amount: number; ref?: number; desc?: number; details?: number } | null = null;
  const headerLine = lines.find((l) => l.includes("\t") && /\bdate\b/i.test(l) && /amount|\bnet\b/i.test(l) && !/^\d/.test(l));
  if (headerLine) {
    const h = headerLine.split("\t").map((c) => c.trim().toLowerCase());
    const idx = (...names: RegExp[]) => { for (const re of names) { const i = h.findIndex((c) => re.test(c)); if (i >= 0) return i; } return -1; };
    const date = idx(/^date$/, /date/), supplier = idx(/^supplier name$/, /^payee/, /^supplier$/, /^name$/), amount = idx(/^net amount$/, /^amount$/, /^net$/, /amount/);
    if (date >= 0 && amount >= 0) header = { count: h.length, date, supplier: supplier >= 0 ? supplier : -1, amount, ref: opt(idx(/^ref/, /reference/, /^no$/)), desc: opt(idx(/^description$/, /^narrative$/)), details: opt(idx(/^details$/)) };
  }
  function opt(i: number) { return i >= 0 ? i : undefined; }
  // Date at the start, amount (optionally followed by VAT/total columns) at the end. Some councils' PDFs run the
  // columns together with no spaces ("01/07/2026BACSACME LTD - Works400.00"), so separators are optional.
  const re = /^(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s*(.*?)\s*(-?\(?£?\d{1,3}(?:,\d{3})*\.\d{2}\)?|-?\(?£?\d+\.\d{2}\)?)(?:\s+-?\(?£?[\d,]+\.\d{2}\)?){0,2}\s*$/;
  lines.forEach((line, i) => {
    let m: RegExpMatchArray | null = null;
    let cells: string[] | null = null;
    if (line.includes("\t")) {
      const raw = line.split("\t").map((c) => c.trim());
      if (header && raw.length === header.count && parseUkDate(raw[header.date]) && parseAmount(raw[header.amount]) !== null) {
        candidates++;
        const refCell = header.ref !== undefined ? raw[header.ref] || undefined : undefined;
        if (header.supplier >= 0) {
          let supplier = raw[header.supplier].replace(/\s+/g, " ").trim();
          const dbl = supplier.match(/^(.{4,}?) \1$/); if (dbl) supplier = dbl[1]; // name printed twice (PDF artefact)
          let descParts = [header.details !== undefined ? raw[header.details] : "", header.desc !== undefined ? raw[header.desc] : ""].filter(Boolean);
          // Details often repeat the name ("ACME LTD - #PL12# Works"); keep the part that adds information.
          descParts = descParts.map((d) => (d.toUpperCase().startsWith(supplier.toUpperCase()) ? d.slice(supplier.length).replace(/^\s*-\s*/, "").trim() : d)).filter(Boolean);
          const inv = descParts.join(" ").match(/#(PL\d+)#/i);
          const description = descParts.join(" — ").replace(/\s*#PL\d+#\s*/i, " ").replace(/\s+/g, " ").trim() || undefined;
          const method = refCell?.match(/^\(?\s*(DIRECT DEBIT|STANDING ORDER|BACS|CHQ|CHEQUE|CARD|DD|SO|TFR|TRANSFER|CASH)\s*\)?$/i);
          if (!supplier) { rejected.push({ rowNumber: i + 1, reason: "no supplier", raw: line }); return; }
          rows.push({ rowNumber: i + 1, date: parseUkDate(raw[header.date])!, supplierRaw: supplier, amount: parseAmount(raw[header.amount])!, description, reference: inv?.[1] ?? (method ? undefined : refCell), extra: method ? { "Payment method": method[1].toUpperCase() } : undefined });
        } else {
          // Only a combined "Details" column: let the adapter's splitter separate payee from purpose.
          const details = [refCell ?? "", raw[header.details ?? -1] ?? ""].join(" ").trim();
          if (!details) { rejected.push({ rowNumber: i + 1, reason: "no details", raw: line }); return; }
          const parts = opts.split ? opts.split(details) : { supplier: details };
          rows.push({ rowNumber: i + 1, date: parseUkDate(raw[header.date])!, supplierRaw: parts.supplier, amount: parseAmount(raw[header.amount])!, description: parts.description, reference: parts.reference, extra: parts.extra });
        }
        return;
      }
      cells = raw.filter(Boolean);
      const dm = cells[0]?.match(/^(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s*(.*)$/);
      if (cells.length < 2 || !dm) return;
      cells = [dm[1], ...(dm[2] ? [dm[2]] : []), ...cells.slice(1)];
      // Occasionally the amount is glued to the end of the last text cell ("… services 613.60"); split it off.
      const last = cells[cells.length - 1];
      const glued = last.match(/^(.*\S)\s+(-?\(?£?\d{1,3}(?:,\d{3})*\.\d{2}\)?)$/);
      if (glued && !/^-?\(?£?[\d,]+\.\d{2}\)?$/.test(last)) cells = [...cells.slice(0, -1), glued[1], glued[2]];
      if (cells.length < 3) return;
    } else {
      m = line.match(re);
      if (!m) return;
    }
    candidates++;
    const dateStr = cells ? cells[0] : m![1];
    const amountStr = cells ? cells[cells.length - 1] : m![3];
    const details = cells ? cells.slice(1, -1).join(" ").trim() : m![2].trim();
    const date = parseUkDate(dateStr);
    const amount = parseAmount(amountStr);
    if (!date) { rejected.push({ rowNumber: i + 1, reason: `bad date ${dateStr}`, raw: line }); return; }
    if (amount === null) { rejected.push({ rowNumber: i + 1, reason: `bad amount ${amountStr}`, raw: line }); return; }
    if (!details) { rejected.push({ rowNumber: i + 1, reason: "no details", raw: line }); return; }
    const parts = opts.split ? opts.split(details) : { supplier: details };
    rows.push({ rowNumber: i + 1, date, supplierRaw: parts.supplier, amount, description: parts.description, reference: parts.reference, extra: parts.extra });
  });
  if (candidates === 0) throw new FormatChangedError("No payment lines matched the '<date> … <amount>' pattern in this PDF. The council may have changed its report layout, or the PDF is scanned (no text layer).");
  return { rows, rejected, headers: ["(pdf line)"], headerMap: { date: "line start", supplier: "details", amount: "line end" }, notes: ["Parsed from PDF text; the published 'Details' field is kept verbatim as the supplier/payee."] };
}
