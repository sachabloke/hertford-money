/**
 * Decisions importer for ModernGov-based committee systems (used by Hertfordshire County Council
 * and East Herts District Council). It reads a decisions listing page, follows each decision /
 * agenda-item page, downloads the attached report PDFs, and extracts the standard report sections
 * ("Recommendation", "Reasons", "Alternative options", "Financial implications", "Decision") by
 * heading. Nothing is paraphrased: extracted text is stored verbatim and labelled "extracted".
 * If the listing page yields no decision links the run fails visibly.
 */
import { prisma } from "./db";
import { fetchText, downloadAndArchive } from "./fetch";
import { extractLinks } from "./html";
import { pdfText } from "./pdf";
import { parseUkDate } from "./parse";
import { log } from "./import";

export const MODERNGOV_DEFAULTS: Record<string, { base: string; listing: string }> = {
  hcc: { base: "https://democracy.hertfordshire.gov.uk/", listing: "https://democracy.hertfordshire.gov.uk/mgDelegatedDecisions.aspx?bcr=1&DM=0&DS=2&K=0&DR=&V=0" },
  ehdc: { base: "https://democracy.eastherts.gov.uk/", listing: "https://democracy.eastherts.gov.uk/mgDelegatedDecisions.aspx?bcr=1&DM=0&DS=2&K=0&DR=&V=0" },
};

const SECTION_PATTERNS: Array<[keyof Extracted, RegExp]> = [
  ["proposal", /^(?:\d+[\.\)]?\s*)?(recommendations?(?: to [a-z ]+)?|proposal|purpose of (?:the )?report|summary)\s*:?\s*$/i],
  ["councilReason", /^(?:\d+[\.\)]?\s*)?(reasons? for (?:the )?(?:recommendations?|decision)|reasons?)\s*:?\s*$/i],
  ["alternatives", /^(?:\d+[\.\)]?\s*)?(alternative options? (?:considered)?(?: and rejected)?|other options? considered|options? considered)\s*:?\s*$/i],
  ["financialImplications", /^(?:\d+[\.\)]?\s*)?(financial implications?|finance implications?|financial (?:and )?(?:resource|budget) implications?|resource implications?)\s*:?\s*$/i],
  ["outcome", /^(?:\d+[\.\)]?\s*)?(decision|decisions?|resolved|the (?:cabinet|committee|council) (?:resolved|decided))\s*:?\s*$/i],
];
// A heading-like line: starts with a capital, at most six words, no sentence punctuation.
const ANY_HEADING = /^(?:\d+[\.\)]?\s*)?[A-Z][A-Za-z&\/\-]*(?:\s+[A-Za-z&\/\-]+){0,5}\s*:?\s*$/;

interface Extracted { proposal?: string; councilReason?: string; alternatives?: string; financialImplications?: string; outcome?: string }

/** Pull the standard sections out of a council report's text. Conservative: a section ends at the next heading-like line. */
export function extractSections(text: string): Extracted {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim());
  const out: Extracted = {};
  let current: keyof Extracted | null = null;
  let buf: string[] = [];
  const flush = () => { if (current && buf.length && !out[current]) out[current] = buf.join(" ").replace(/\s+/g, " ").trim().slice(0, 2000); buf = []; };
  for (const line of lines) {
    const hit = SECTION_PATTERNS.find(([, re]) => re.test(line));
    if (hit) { flush(); current = hit[0]; continue; }
    if (current && ANY_HEADING.test(line) && buf.length >= 1) { flush(); current = null; continue; }
    if (current && line) buf.push(line);
  }
  flush();
  return out;
}

export async function importDecisions(authorityId: string, opts: { listingUrl?: string; limit?: number } = {}): Promise<{ found: number; imported: number; failed: number }> {
  const cfg = MODERNGOV_DEFAULTS[authorityId];
  const listing = opts.listingUrl ?? cfg?.listing;
  if (!listing) throw new Error(`No decisions listing is configured for ${authorityId}. Pass --url <listing page>.`);
  const html = await fetchText(listing);
  const links = extractLinks(html, listing).filter((l) => /(ieDecisionDetails\.aspx\?(?:AIId|ID)=\d+|mgAi\.aspx\?ID=\d+|mgIssueHistoryHome\.aspx\?IId=\d+)/i.test(l.href));
  const seen = new Set<string>();
  const targets = links.filter((l) => (seen.has(l.href) ? false : (seen.add(l.href), true))).slice(0, opts.limit ?? 50);
  if (!targets.length) throw new Error(`No decision links found on ${listing} (page returned ${html.length} bytes, ${extractLinks(html, listing).length} links). The listing URL may be wrong for this council; pass --url.`);
  let imported = 0, failed = 0;
  for (const t of targets) {
    try {
      const page = await fetchText(t.href);
      const title = (page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? t.text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const dateText = page.match(/(?:Decision (?:date|made)|Date of decision|Meeting date)[^<]*<\/[a-z]+>\s*(?:<[^>]+>\s*)*([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+[0-9]{4}|[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i)?.[1] ?? page.match(/\b([0-9]{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20[0-9]{2})\b/)?.[1];
      const decisionDate = dateText ? parseUkDate(dateText.replace(/(\d)(st|nd|rd|th)/, "$1")) : null;
      const body = page.match(/(?:Decision Maker|Decision maker|Decision made by|Committee)[^<]*<\/[a-z]+>\s*(?:<[^>]+>\s*)*([^<]{3,80})</i)?.[1]?.trim();
      const docs = extractLinks(page, t.href).filter((l) => /\/documents\/s\d+\/.*\.pdf/i.test(l.href)).slice(0, 4);
      let sections: Extracted = {};
      const docRecords: Array<{ title: string; url: string; text: string }> = [];
      for (const d of docs) {
        try {
          const archived = await downloadAndArchive(authorityId, d.href);
          const { text } = await pdfText(archived.buffer);
          docRecords.push({ title: d.text || d.href.split("/").pop()!, url: d.href, text });
          if (!sections.proposal) sections = { ...extractSections(text), ...sections };
        } catch (e) { console.warn(`  document skipped: ${d.href}: ${(e as Error).message}`); }
      }
      const decisionText = page.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
      const pageSections = extractSections(decisionText);
      sections = { ...pageSections, ...sections, outcome: sections.outcome ?? pageSections.outcome };
      const decision = await prisma.decision.upsert({
        where: { authorityId_sourceUrl: { authorityId, sourceUrl: t.href } },
        update: { title, decisionDate, body, ...sections, summaryKind: "extracted" },
        create: { authorityId, title, decisionDate, body, sourceUrl: t.href, ...sections, summaryKind: "extracted", externalId: t.href.match(/(?:AIId|ID|IId)=(\d+)/i)?.[1] },
      });
      for (const d of docRecords) {
        await prisma.document.upsert({
          where: { authorityId_sourceUrl: { authorityId, sourceUrl: d.url } },
          update: { title: d.title, decisionId: decision.id, textExcerpt: d.text.slice(0, 2000), fullText: d.text.slice(0, 200_000) },
          create: { authorityId, title: d.title, kind: "report", sourceUrl: d.url, decisionId: decision.id, meetingDate: decisionDate, bodyName: body, textExcerpt: d.text.slice(0, 2000), fullText: d.text.slice(0, 200_000) },
        });
      }
      imported++;
      console.log(`• ${title.slice(0, 80)} (${decisionDate?.toISOString().slice(0, 10) ?? "no date"}; ${docRecords.length} docs; sections: ${Object.keys(sections).filter((k) => sections[k as keyof Extracted]).join(", ") || "none"})`);
    } catch (e) { failed++; console.warn(`FAILED ${t.href}: ${(e as Error).message}`); }
  }
  await log({ adapter: authorityId, stage: "import", status: failed && !imported ? "failed" : "success", message: `decisions: ${imported} imported, ${failed} failed from ${listing}` });
  return { found: targets.length, imported, failed };
}
