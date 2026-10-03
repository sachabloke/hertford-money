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
  let text = buffer.toString("utf8");
  if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buffer);
  return text.replace(/^﻿/, "");
}

export function readCsv(buffer: Buffer, opts: { delimiter?: string } = {}): TableData {
  const text = decode(buffer);
  const delimiter = opts.delimiter ?? guessDelimiter(text);
  let records: string[][];
  try {
    records = parse(text, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, trim: true, bom: true });
  } catch (e) {
    throw new FormatChangedError(`CSV could not be parsed: ${(e as Error).message}`);
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
