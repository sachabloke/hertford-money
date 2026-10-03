/**
 * Conservative supplier-name normalisation.
 *
 * We produce a deterministic key so that trivially different spellings of the SAME legal
 * form collapse together (case, punctuation, whitespace, "LTD" vs "LIMITED", trailing
 * dots). We deliberately do NOT strip legal suffixes entirely, do NOT fuzzy-match, and do
 * NOT merge "ACME LTD" with "ACME PLC" or "ACME HOLDINGS LTD": those may be different
 * companies. Uncertain matches are left separate; a human can merge them later via
 * SupplierAlias with confidence = "manual".
 */

const SUFFIX_CANON: Array<[RegExp, string]> = [
  [/\b(limited|ltd\.?|ltd)\b/g, "ltd"],
  [/\b(public limited company|plc\.?)\b/g, "plc"],
  [/\b(limited liability partnership|llp\.?)\b/g, "llp"],
  [/\b(community interest company|cic\.?)\b/g, "cic"],
  [/\b(incorporated|inc\.?)\b/g, "inc"],
  [/\b(company|co\.?)\b/g, "co"],
  [/\band\b/g, "and"],
  [/\bt\/a\b/g, "ta"],
];

export function normaliseSupplierName(raw: string): string {
  let s = raw.normalize("NFKD").replace(/[̀-ͯ]/g, ""); // strip accents
  s = s.toLowerCase();
  s = s.replace(/[’'`]/g, "");            // o'neill -> oneill
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9/ ]+/g, " ");    // punctuation -> space (keep / for the canon step)
  for (const [re, rep] of SUFFIX_CANON) s = s.replace(re, rep);
  s = s.replace(/\//g, " ");
  s = s.replace(/\bthe\b/g, " ");          // leading/trailing "the" is unstable in council data
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** Names that councils use to redact individuals; these are never a "supplier". */
export function isRedactedName(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  return (
    s === "" ||
    /^(redacted|name withheld|withheld|personal|individual|private individual|confidential|various|sundry)\b/.test(s) ||
    /\b(redacted|name withheld|personal information)\b/.test(s)
  );
}

/**
 * Payee strings that are not an organisation and must not be ranked or flagged as a "supplier":
 * numeric-only IDs (councils publish these for individuals, e.g. direct payments) and payroll / PAYE /
 * pension lines that small councils list by month. The rows keep their published text and count in totals.
 */
export function isNonSupplierPayee(raw: string): boolean {
  const s = raw.trim();
  return /^\d+$/.test(s) || /\bpayroll\b|^net pay\b|^paye\b|employee\/employer pension/i.test(s);
}

/** Pick the display spelling: the most frequent raw spelling, ties broken by the shortest. */
export function chooseDisplayName(counts: Map<string, number>): string {
  let best = "";
  let bestN = -1;
  for (const [name, n] of counts) {
    if (n > bestN || (n === bestN && name.length < best.length)) {
      best = name;
      bestN = n;
    }
  }
  return best;
}
