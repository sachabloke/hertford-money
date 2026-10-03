/** Tiny HTML link extractor (no DOM library needed): returns absolute hrefs with their link text. */
export interface Link { href: string; text: string; }

export function extractLinks(html: string, baseUrl: string): Link[] {
  const out: Link[] = [];
  const re = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[2].replace(/&amp;/g, "&").trim();
    if (!href || href.startsWith("#") || /^(javascript|mailto):/i.test(href)) continue;
    const text = m[3].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    try { out.push({ href: new URL(href, baseUrl).toString(), text }); } catch { /* ignore malformed */ }
  }
  return out;
}

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

/** "July 2026" / "Jul 2026" / "jul-26" / "2026-07" → {start, end} ISO dates of that month. */
export function monthFromText(text: string): { start: string; end: string; label: string } | null {
  const s = text.toLowerCase();
  let m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s\-_]*(20\d{2}|\d{2})\b/);
  let month = -1, year = -1;
  if (m) { month = MONTHS.findIndex((x) => x.startsWith(m![1].slice(0, 3))); year = m[2].length === 2 ? 2000 + +m[2] : +m[2]; }
  else if ((m = s.match(/\b(20\d{2})[\-_](\d{2})\b/))) { year = +m[1]; month = +m[2] - 1; }
  if (month < 0 || year < 2000) return null;
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), label: `${MONTHS[month][0].toUpperCase()}${MONTHS[month].slice(1)} ${year}` };
}

/** "April - June 2026" / "Apr-Jun 2026" / "Q1 2026/27" → quarter range. */
export function quarterFromText(text: string): { start: string; end: string; label: string } | null {
  const s = text.toLowerCase();
  const m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(?:-|–|to)\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(20\d{2})\b/);
  if (!m) return null;
  const a = MONTHS.findIndex((x) => x.startsWith(m[1])), b = MONTHS.findIndex((x) => x.startsWith(m[2]));
  const year = +m[3];
  const startYear = a > b ? year - 1 : year; // "Oct - Dec 2026" (same year) vs "Jan-Mar 2026"
  const start = new Date(Date.UTC(startYear, a, 1)), end = new Date(Date.UTC(year, b + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), label: text.trim() };
}

export function formatFromUrl(url: string): "csv" | "xlsx" | "xls" | "pdf" | "html" | "json" | null {
  const p = url.toLowerCase().split("?")[0];
  if (p.endsWith(".csv")) return "csv";
  if (p.endsWith(".xlsx")) return "xlsx";
  if (p.endsWith(".xls")) return "xls";
  if (p.endsWith(".pdf")) return "pdf";
  if (p.endsWith(".json")) return "json";
  return null;
}
