/** Read CSV / XLSX / XLS into rows of {header: value}. Header row detection skips leading title lines. */
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { FormatChangedError } from "./types";

export interface TableData {
  headers: string[];
  rows: Array<Record<string, string>>;
  headerRowIndex: number;
  sheet?: string;
}

function decode(buffer: Buffer): string {
  // Councils export from Excel/SAP: UTF-8 (often with BOM), sometimes Windows-1252.
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) buffer = buffer.subarray(3); // UTF-8 BOM
  const utf8 = buffer.toString("utf8");
  const bad = (utf8.match(/\uFFFD/g) ?? []).length;
  // A handful of stray bytes in a multi-megabyte UTF-8 file is noise; a Windows-1252 file produces many.
  const text = bad > 0 && bad > utf8.length / 20_000 ? new TextDecoder("windows-1252").decode(buffer) : utf8;
  return text.replace(/^\uFEFF/, "");
}

export function readCsv(buffer: Buffer, opts: { delimiter?: string } = {}): TableData {
  const text = decode(buffer);
  const delimiter = opts.delimiter ?? guessDelimiter(text);
  let records: string[][];
  if (looksWholeRowQuoted(text)) {
    records = parseWholeRowQuoted(text, delimiter);
  } else {
    try {
      records = parse(text, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, trim: true, bom: true });
    } catch (e) {
      throw new FormatChangedError(`CSV could not be parsed: ${(e as Error).message}`);
    }
  }
  return fromGrid(records);
}

export function readXlsx(buffer: Buffer, sheetName?: string): TableData {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
  const name = sheetName ?? wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws) throw new FormatChangedError(`Sheet ${name} not found; sheets: ${wb.SheetNames.join(", ")}`);
  const grid = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" }) as unknown as string[][];
  const t = fromGrid(grid.map((r) => r.map((c) => (c == null ? "" : String(c)))));
  t.sheet = name;
  return t;
}

export function readTable(buffer: Buffer, format: string): TableData {
  if (format === "csv") return readCsv(buffer);
  if (format === "xlsx" || format === "xls") return readXlsx(buffer);
  throw new FormatChangedError(`Unsupported table format: ${format}`);
}

/** Some exports wrap each whole row in one pair of quotes ("a,b,c", inner quotes doubled, cells may contain line breaks). */
function looksWholeRowQuoted(text: string): boolean {
  const first = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5);
  return first.length >= 3 && first.every((l) => l.startsWith('"') && !l.includes('","') && (l.match(/,/g) ?? []).length >= 2);
}

function parseWholeRowQuoted(text: string, delimiter: string): string[][] {
  const out: string[][] = [];
  let buf = "";
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    buf = buf ? `${buf}\n${line}` : line;
    if (!buf.trim()) { buf = ""; continue; }
    // A record ends where a line ends with a quote and the next non-empty line starts a new quoted record (or EOF).
    const next = lines.slice(i + 1).find((l) => l.trim());
    if (/"\s*$/.test(buf) && (next === undefined || next.startsWith('"'))) {
      const inner = buf.trim().slice(1, -1).replace(/""/g, '"');
      let row: string[];
      try { row = (parse(inner, { delimiter, relax_column_count: true, relax_quotes: true, trim: true })[0] as string[] | undefined) ?? [inner]; }
      catch { row = inner.split(delimiter).map((c) => c.trim()); }
      out.push(row);
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.split(delimiter).map((c) => c.trim()));
  return out;
}

function guessDelimiter(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 5).join("\n");
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0, "|": 0 };
  for (const ch of head) if (ch in counts) counts[ch]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/** Find the header row: the first row with >= 3 non-empty, mostly non-numeric cells. */
function fromGrid(grid: string[][]): TableData {
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(grid.length, 30); i++) {
    const cells = grid[i].map((c) => (c ?? "").trim());
    const nonEmpty = cells.filter((c) => c !== "");
    const numeric = nonEmpty.filter((c) => /^[£$\-\d,.()\s]+$/.test(c) && /\d/.test(c));
    if (nonEmpty.length >= 3 && numeric.length <= nonEmpty.length / 3) { headerRowIndex = i; break; }
  }
  if (headerRowIndex < 0) throw new FormatChangedError("Could not find a header row (expected a row with at least 3 text column names in the first 30 lines).");
  const rawHeaders = grid[headerRowIndex].map((h) => (h ?? "").trim());
  const headers: string[] = [];
  const seen = new Map<string, number>();
  for (const h of rawHeaders) {
    const base = h || "column";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    headers.push(n === 1 ? base : `${base} (${n})`);
  }
  const rows: Array<Record<string, string>> = [];
  for (let i = headerRowIndex + 1; i < grid.length; i++) {
    const cells = grid[i];
    if (!cells || cells.every((c) => (c ?? "").trim() === "")) continue;
    const rec: Record<string, string> = {};
    headers.forEach((h, j) => (rec[h] = (cells[j] ?? "").toString().trim()));
    rec.__row = String(i + 1); // 1-based line in the source file
    rows.push(rec);
  }
  return { headers, rows, headerRowIndex };
}
