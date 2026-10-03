/**
 * "Ask Hertford Money": deterministic question answering.
 *
 * Code calculates, AI explains. This module turns a question into one of a fixed set of
 * database queries and returns numbers + the records they came from. It never estimates.
 * An optional AI step (api/ask) may rephrase the result but cannot add numbers.
 */
import { prisma } from "./db";
import { listContracts, listDecisions, listFlags, spendByCategory, topSuppliers, unifiedSearch, categoryByYear, getSupplier, getOverview } from "./queries";
import { gbp, num, pct } from "./format";

export interface AskNumber { label: string; value: string; kind: "fact" | "calc" }
export interface AskLink { label: string; href: string }
export interface AskTable { title: string; columns: string[]; rows: Array<Array<string>> }
export interface AskResult {
  question: string;
  intent: string;
  answer: string;
  numbers: AskNumber[];
  why: string;
  tables: AskTable[];
  evidence: AskLink[];      // links inside Hertford Money (records)
  sources: AskLink[];       // original council files
  insufficient: boolean;
  scope: { authorityId?: string; authorityName?: string; financialYear?: string };
}

const AUTH_PATTERNS: Array<[RegExp, string]> = [
  [/\b(hertfordshire county|county council|hcc|the county)\b/i, "hcc"],
  [/\b(east herts|district council|ehdc|the district)\b/i, "ehdc"],
  [/\b(hertford town|town council|htc|the town)\b/i, "htc"],
];

function detectScope(q: string) {
  const authorityId = AUTH_PATTERNS.find(([re]) => re.test(q))?.[1];
  const fy = q.match(/\b(20\d{2})\s*[\/\-–]\s*(\d{2,4})\b/);
  const financialYear = fy ? `${fy[1]}/${fy[2].slice(-2)}` : undefined;
  return { authorityId, financialYear };
}

async function latestFy(authorityId?: string): Promise<string | undefined> {
  const r = await prisma.transaction.findFirst({ where: { dataset: { isFixture: false }, ...(authorityId ? { authorityId } : {}) }, orderBy: { date: "desc" }, select: { financialYear: true } });
  return r?.financialYear;
}

async function authorityName(id?: string) {
  if (!id) return undefined;
  return (await prisma.authority.findUnique({ where: { id } }))?.name;
}

function base(question: string, intent: string, scope: AskResult["scope"]): AskResult {
  return { question, intent, answer: "", numbers: [], why: "", tables: [], evidence: [], sources: [], insufficient: false, scope };
}

async function sourcesFor(authorityId?: string): Promise<AskLink[]> {
  const ds = await prisma.sourceDataset.findMany({ where: { isFixture: false, ...(authorityId ? { authorityId } : {}) }, orderBy: { periodStart: "desc" }, take: 6, select: { title: true, sourceUrl: true } });
  return ds.map((d) => ({ label: d.title, href: d.sourceUrl }));
}

export async function ask(questionRaw: string): Promise<AskResult> {
  const q = questionRaw.trim();
  const scope = detectScope(q);
  const aName = await authorityName(scope.authorityId);
  const s = { ...scope, authorityName: aName };
  const overview = await getOverview();
  if (overview.transactions === 0) {
    const r = base(q, "no-data", s);
    r.insufficient = true;
    r.answer = "No council data has been imported yet, so there is nothing to answer from. Hertford Money never estimates figures.";
    r.why = "Run the data pipeline to import the councils' published payment files.";
    return r;
  }

  // 1. Largest suppliers
  if (/\b(largest|biggest|top|main|major)\b.*\bsuppliers?\b|\bsuppliers?\b.*\b(largest|biggest|most)\b|who (gets|receives) the most/i.test(q)) {
    const fy = scope.financialYear ?? (/\bthis year|latest|current\b/i.test(q) ? await latestFy(scope.authorityId) : undefined);
    const r = base(q, "top-suppliers", { ...s, financialYear: fy });
    const { rows } = await topSuppliers({ authorityId: scope.authorityId, financialYear: fy, limit: 10 });
    if (!rows.length) { r.insufficient = true; r.answer = "No supplier totals are available for that scope."; return r; }
    r.answer = `The ${rows.length} suppliers receiving the most from ${aName ?? "the three councils"}${fy ? ` in ${fy}` : " across all indexed years"} are listed below. ${rows[0].name} received the most (${gbp(rows[0].total)}).`;
    r.numbers = rows.slice(0, 3).map((x) => ({ label: x.name, value: gbp(x.total), kind: "calc" as const }));
    r.tables.push({ title: "Largest suppliers", columns: ["Supplier", "Total", "Payments"], rows: rows.map((x) => [x.name, gbp(x.total), num(x.count)]) });
    r.why = "Totals are the sum of every published payment row linked to each supplier after conservative name matching. Payment files only include payments above the council's reporting threshold.";
    r.evidence = rows.map((x) => ({ label: x.name, href: `/suppliers/${x.supplierId}` }));
    r.sources = await sourcesFor(scope.authorityId);
    return r;
  }

  // 2. Council tax / where money goes
  if (/council tax|where does (my|the) money go|what is (the )?money spent on|how is money spent/i.test(q)) {
    const fy = scope.financialYear ?? (await latestFy(scope.authorityId));
    const r = base(q, "where-money-goes", { ...s, financialYear: fy });
    const cats = await spendByCategory({ authorityId: scope.authorityId, financialYear: fy, field: "category", limit: 12 });
    const deps = cats.filter((c) => c.name).length ? [] : await spendByCategory({ authorityId: scope.authorityId, financialYear: fy, field: "department", limit: 12 });
    const list = cats.filter((c) => c.name).length ? cats : deps;
    const total = list.reduce((a, c) => a + c.total, 0);
    if (!list.length) { r.insufficient = true; r.answer = "The published payment files for this scope do not state a category or department, so spending cannot be broken down."; return r; }
    r.answer = `Published payments${aName ? ` by ${aName}` : ""} in ${fy} break down by the council's own labels as below. Note: payment files are not the council tax budget. Council tax is only one part of council income (alongside government grants, fees and business rates), and the files list individual payments above a threshold rather than the full accounts.`;
    r.numbers = list.slice(0, 3).map((c) => ({ label: c.name ?? "(not stated)", value: gbp(c.total), kind: "calc" as const }));
    r.tables.push({ title: `Payments by ${cats.filter((c) => c.name).length ? "category" : "department"}, ${fy}`, columns: ["Label", "Total", "Share of listed"], rows: list.map((c) => [c.name ?? "(not stated)", gbp(c.total), total ? `${((c.total / total) * 100).toFixed(1)}%` : "—"]) });
    r.why = "Shares are of the labelled payments shown, not of the council's total budget. For the budget itself, see the council's budget documents linked on the Sources page.";
    r.evidence = list.filter((c) => c.name).slice(0, 8).map((c) => ({ label: c.name!, href: `/transactions?category=${encodeURIComponent(c.name!)}${scope.authorityId ? `&authority=${scope.authorityId}` : ""}&fy=${encodeURIComponent(fy ?? "")}` }));
    r.sources = await sourcesFor(scope.authorityId);
    return r;
  }

  // 3. Unusual / anomalies
  if (/unusual|anomal|odd|strange|suspicious|worth looking|flag/i.test(q)) {
    const r = base(q, "flags", s);
    const flags = await listFlags({ authorityId: scope.authorityId });
    if (!flags.length) { r.insufficient = true; r.answer = "No statistical flags are currently recorded for this scope. Either nothing met a rule's threshold or flags have not been computed."; return r; }
    r.answer = `${flags.length} patterns in the published data meet a flag rule${aName ? ` for ${aName}` : ""}. A flag means the numbers are unusual under a stated rule; it is not evidence of waste or wrongdoing.`;
    r.tables.push({ title: "Flags", columns: ["Flag", "Rule", "Authority"], rows: flags.slice(0, 15).map((f) => [f.title, f.rule.replace(/_/g, " "), f.authority.shortName]) });
    r.why = "Rules compare each supplier's or category's totals with its own history and with thresholds that scale with the council's size. Full method on the Sources page.";
    r.evidence = flags.slice(0, 15).map((f) => ({ label: f.title, href: `/investigate/${f.id}` }));
    return r;
  }

  // 4. Fastest increases
  if (/increas(ed|ing)? (the )?(fastest|most)|grew (the )?(fastest|most)|biggest (increase|rise|growth)|rising fastest|gone up (the )?most/i.test(q)) {
    const r = base(q, "fastest-increase", s);
    const flags = (await listFlags({ authorityId: scope.authorityId, rule: "supplier_rapid_increase" })).slice(0, 10);
    const cats = (await listFlags({ authorityId: scope.authorityId, rule: "category_yoy_change" })).filter((f) => (f.evidence as { changePct?: number }).changePct! > 0).slice(0, 10);
    if (!flags.length && !cats.length) { r.insufficient = true; r.answer = "No supplier or category shows an increase large enough to meet the flag rules in the indexed data, or there is not yet more than one year of data to compare."; return r; }
    r.answer = `The suppliers and categories with the largest increases under the flag rules${aName ? ` for ${aName}` : ""} are listed below.`;
    if (flags.length) r.tables.push({ title: "Suppliers with the largest increases", columns: ["Supplier", "Period", "Increase"], rows: flags.map((f) => [f.supplier?.displayName ?? f.title, f.periodLabel ?? "", pct((f.evidence as { increasePct?: number }).increasePct)]) });
    if (cats.length) r.tables.push({ title: "Categories with the largest increases", columns: ["Category", "Years", "Change"], rows: cats.map((f) => { const e = f.evidence as { category?: string; from?: { year: string; total: number }; to?: { year: string; total: number }; changePct?: number }; return [e.category ?? "", `${e.from?.year} → ${e.to?.year}`, `${pct(e.changePct)} (${gbp(e.from?.total)} → ${gbp(e.to?.total)})`]; }) });
    r.why = "Increases are computed between financial years (or the same months of consecutive years when the latest year is incomplete). Only increases above the size thresholds in the methodology are listed.";
    r.evidence = [...flags, ...cats].map((f) => ({ label: f.title, href: `/investigate/${f.id}` }));
    return r;
  }

  // 5. Contracts awarded
  if (/contracts?\b.*\b(awarded|signed|let|started|this year|large|biggest|largest)|\b(largest|biggest|large)\b.*contracts?/i.test(q)) {
    const year = q.match(/\b(20\d{2})\b/) ? Number(q.match(/\b(20\d{2})\b/)![1]) : /this year/i.test(q) ? new Date().getUTCFullYear() : undefined;
    const r = base(q, "contracts", s);
    const { rows, count } = await listContracts({ authorityId: scope.authorityId, year, pageSize: 15 });
    if (!count) { r.insufficient = true; r.answer = `No contracts${year ? ` starting or awarded in ${year}` : ""} are in the imported contract registers${aName ? ` for ${aName}` : ""}.`; return r; }
    r.answer = `${num(count)} contracts${year ? ` starting or awarded in ${year}` : ""} appear in the imported registers${aName ? ` for ${aName}` : ""}; the largest by stated value are below.`;
    r.tables.push({ title: "Largest contracts", columns: ["Contract", "Supplier", "Value", "Start"], rows: rows.map((c) => [c.title, c.supplierRaw, gbp(c.value), c.startDate ? c.startDate.toISOString().slice(0, 10) : "—"]) });
    r.why = "Values are as stated in each council's register (total or annual, as published). Registers usually list contracts above £5,000.";
    r.evidence = rows.map((c) => ({ label: c.title, href: `/contracts/${c.id}` }));
    r.sources = (await prisma.sourceDataset.findMany({ where: { kind: "contracts", isFixture: false }, take: 5 })).map((d) => ({ label: d.title, href: d.sourceUrl }));
    return r;
  }

  // 6. Decisions
  if (/decisions?\b.*\b(month|week|recent|latest|being made)|what (is|are) (the council|they) deciding/i.test(q)) {
    const r = base(q, "decisions", s);
    const now = new Date();
    const month = /this month/i.test(q) ? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}` : undefined;
    const { rows, count } = await listDecisions({ authorityId: scope.authorityId, month });
    if (!count) { r.insufficient = true; r.answer = `No decisions${month ? " for this month" : ""} have been imported${aName ? ` for ${aName}` : ""} yet.`; return r; }
    r.answer = `${num(count)} decisions${month ? " this month" : ""} are indexed${aName ? ` for ${aName}` : ""}.`;
    r.tables.push({ title: "Decisions", columns: ["Decision", "Body", "Date"], rows: rows.slice(0, 15).map((d) => [d.title, d.body ?? "", d.decisionDate ? d.decisionDate.toISOString().slice(0, 10) : "—"]) });
    r.evidence = rows.slice(0, 15).map((d) => ({ label: d.title, href: `/decisions/${d.id}` }));
    r.why = "Decisions come from the councils' committee systems; each page shows the council's own stated reasons.";
    return r;
  }

  // 7. What does X receive money for / why did spending on X change / how much on X
  const m = q.match(/(?:what (?:does|did|is|was) (.+?) (?:receive|get|paid|being paid)(?: money)?(?: for)?|why (?:did|has|is) (?:spending|payments?)(?: on| to)? (.+?) (?:increase|rise|go up|change|grow|fall|drop)|how much (?:do|does|did|has|have|is|was|were) (?:the )?(?:council|councils|they|we|[a-z ]*council)? ?(?:spend|spent|pay|paid)(?: on| to| for)? (.+?)(?: in \d{4}.*)?|how (?:has|much has|did) (.+?) (?:spending |expenditure )?(?:changed|change|grown|moved))\??$/i);
  const term = (m?.[1] ?? m?.[2] ?? m?.[3] ?? m?.[4])?.replace(/^(the|on|to|for)\s+/i, "").replace(/[?.]$/, "").trim();
  if (term) {
    const r = base(q, "term-breakdown", s);
    const sup = await topSuppliers({ q: term, authorityId: scope.authorityId, limit: 3 });
    const catRows = await prisma.transaction.groupBy({ by: ["category"], where: { dataset: { isFixture: false }, category: { contains: term, mode: "insensitive" }, ...(scope.authorityId ? { authorityId: scope.authorityId } : {}) }, _sum: { amount: true }, _count: true, orderBy: { _sum: { amount: "desc" } }, take: 3 });
    const depRows = await prisma.transaction.groupBy({ by: ["department"], where: { dataset: { isFixture: false }, department: { contains: term, mode: "insensitive" }, ...(scope.authorityId ? { authorityId: scope.authorityId } : {}) }, _sum: { amount: true }, _count: true, orderBy: { _sum: { amount: "desc" } }, take: 3 });
    const descAgg = await prisma.transaction.aggregate({ where: { dataset: { isFixture: false }, description: { contains: term, mode: "insensitive" }, ...(scope.authorityId ? { authorityId: scope.authorityId } : {}) }, _sum: { amount: true }, _count: true });
    const parts: string[] = [];
    if (sup.rows.length) {
      const top = sup.rows[0];
      const detail = await getSupplier(top.supplierId);
      parts.push(`Supplier “${top.name}” has received ${gbp(top.total)} over ${num(top.count)} published payments${aName ? ` from ${aName}` : ""}.`);
      r.numbers.push({ label: `${top.name} (supplier)`, value: gbp(top.total), kind: "calc" });
      if (detail) {
        r.tables.push({ title: `${top.name} by financial year`, columns: ["Year", "Authority", "Total"], rows: detail.supplier.stats.map((x) => [x.financialYear, x.authority.shortName, gbp(Number(x.total))]) });
        if (detail.categories.length) r.tables.push({ title: `${top.name}: categories as published`, columns: ["Category", "Total"], rows: detail.categories.slice(0, 8).map((c) => [c.category ?? "(not stated)", gbp(c.total)]) });
        if (detail.supplier.contracts.length) r.tables.push({ title: `Contracts naming ${top.name}`, columns: ["Contract", "Authority", "Value"], rows: detail.supplier.contracts.slice(0, 8).map((c) => [c.title, c.authority.shortName, gbp(c.value)]) });
        r.evidence.push({ label: `${top.name} supplier page`, href: `/suppliers/${top.supplierId}` });
        for (const c of detail.supplier.contracts.slice(0, 5)) r.evidence.push({ label: `Contract: ${c.title}`, href: `/contracts/${c.id}` });
        for (const f of detail.supplier.flags.slice(0, 3)) r.evidence.push({ label: `Flag: ${f.title}`, href: `/investigate/${f.id}` });
        r.sources.push(...detail.datasets.slice(0, 5).map((d) => ({ label: d.title, href: d.sourceUrl })));
      }
      if (sup.rows.length > 1) parts.push(`Other matching suppliers: ${sup.rows.slice(1).map((x) => `${x.name} (${gbp(x.total)})`).join(", ")}.`);
    }
    for (const c of catRows) {
      const byYear = await categoryByYear({ authorityId: scope.authorityId, category: c.category! });
      parts.push(`Payments categorised “${c.category}” total ${gbp(Number(c._sum.amount))} over ${num(c._count)} rows.`);
      r.numbers.push({ label: `Category “${c.category}”`, value: gbp(Number(c._sum.amount)), kind: "calc" });
      r.tables.push({ title: `“${c.category}” by financial year`, columns: ["Year", "Total", "Payments"], rows: byYear.map((y) => [y.financialYear, gbp(y.total), num(y.count)]) });
      r.evidence.push({ label: `Payments in “${c.category}”`, href: `/transactions?category=${encodeURIComponent(c.category!)}${scope.authorityId ? `&authority=${scope.authorityId}` : ""}` });
    }
    for (const d of depRows) {
      parts.push(`Payments from the department “${d.department}” total ${gbp(Number(d._sum.amount))} over ${num(d._count)} rows.`);
      r.evidence.push({ label: `Payments from “${d.department}”`, href: `/transactions?department=${encodeURIComponent(d.department!)}${scope.authorityId ? `&authority=${scope.authorityId}` : ""}` });
    }
    if (!sup.rows.length && !catRows.length && !depRows.length && descAgg._count) {
      parts.push(`No supplier or category is called “${term}”, but ${num(descAgg._count)} payment descriptions mention it, totalling ${gbp(Number(descAgg._sum.amount))}.`);
      r.numbers.push({ label: `Descriptions mentioning “${term}”`, value: gbp(Number(descAgg._sum.amount)), kind: "calc" });
      r.evidence.push({ label: `Payments mentioning “${term}”`, href: `/transactions?q=${encodeURIComponent(term)}` });
    }
    if (!parts.length) { r.insufficient = true; r.answer = `Nothing in the indexed data matches “${term}”. Try a different word, or search the raw payments.`; r.evidence.push({ label: `Search “${term}”`, href: `/search?q=${encodeURIComponent(term)}` }); return r; }
    r.answer = parts.join(" ");
    r.why = /why/i.test(q)
      ? "Payment files record what was paid, not why. The year-by-year and category tables show where the change sits; the council's reasons, if published, are in its committee papers and contract register, linked under Evidence."
      : "Figures are sums of published payment rows matching the name you gave, by supplier name, by the council's category label, by department, or by description text. Matching is on text, so check the linked records.";
    r.evidence.push({ label: `Council documents mentioning “${term}”`, href: `/decisions?q=${encodeURIComponent(term)}` });
    if (!r.sources.length) r.sources = await sourcesFor(scope.authorityId);
    return r;
  }

  // Fallback: unified search summary
  const r = base(q, "search", s);
  const terms = q.replace(/[?.,]/g, "").split(/\s+/).filter((w) => w.length > 3 && !/^(what|which|where|when|about|does|much|have|with|from|that|this|their|they|council|councils|spend|spent|money)$/i.test(w));
  const fterm = terms.slice(0, 3).join(" ") || q;
  const res = await unifiedSearch(fterm);
  const found = res.suppliers.length + res.transactions.count + res.contracts.length + res.decisions.length;
  r.insufficient = found === 0;
  r.answer = found === 0 ? `Hertford Money could not match “${fterm}” to any supplier, payment, contract or decision. The question may need data that is not published, or different wording.` : `“${fterm}” matches ${num(res.suppliers.length)} suppliers, ${num(res.transactions.count)} payments (${gbp(res.transactions.total)}), ${num(res.contracts.length)} contracts and ${num(res.decisions.length)} decisions.`;
  r.why = "This question did not match a built-in calculation, so the answer is a text search across the published records.";
  r.evidence = [...res.suppliers.slice(0, 5).map((x) => ({ label: x.name, href: `/suppliers/${x.supplierId}` })), { label: `All search results for “${fterm}”`, href: `/search?q=${encodeURIComponent(fterm)}` }];
  return r;
}
