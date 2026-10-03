/**
 * Quantitative anomaly detection. Every rule is deterministic, states its thresholds, and stores
 * the exact numbers used. A flag means "statistically unusual relative to this rule" and nothing
 * more; the UI repeats that caveat. Rules are re-run from scratch each time (`pipeline flags`).
 */
import { prisma } from "./db";
import { Prisma } from "@prisma/client";
import { financialYear, fyEnd, round2 } from "./parse";

type FlagInput = Prisma.AnomalyFlagCreateManyInput;

/** Thresholds scale with the size of the authority: a £50k jump matters for a town council, not a county. */
const TIER_THRESHOLDS: Record<string, { bigSupplier: number; bigChange: number; bigCategory: number; dupMin: number }> = {
  county:   { bigSupplier: 250_000, bigChange: 100_000, bigCategory: 1_000_000, dupMin: 1_000 },
  unitary:  { bigSupplier: 250_000, bigChange: 100_000, bigCategory: 1_000_000, dupMin: 1_000 },
  district: { bigSupplier: 50_000,  bigChange: 25_000,  bigCategory: 250_000,   dupMin: 500 },
  parish:   { bigSupplier: 5_000,   bigChange: 2_500,   bigCategory: 10_000,    dupMin: 100 },
  other:    { bigSupplier: 50_000,  bigChange: 25_000,  bigCategory: 250_000,   dupMin: 500 },
};

export const METHODOLOGY = {
  supplier_rapid_increase: "A supplier's total in the latest financial year is at least double the average of its previous financial years (minimum two prior years, prior average above the authority's 'big change' threshold). For an incomplete current year, only the same months of the previous year are compared.",
  new_large_supplier: "A supplier first appears in the latest financial year and already exceeds the authority's 'big supplier' threshold.",
  supplier_concentration: "A single supplier received more than 15% of everything the authority paid in a financial year (with at least 50 suppliers paid that year).",
  duplicate_looking_payments: "Two or more rows share the same date, supplier, amount and reference, each above the authority's duplicate threshold. Repeated identical payments are often legitimate (e.g. instalments).",
  category_yoy_change: "A spending category's total changed by more than 50% between two consecutive complete financial years and the change exceeds the authority's 'big category' threshold.",
  budget_vs_actual: "Where both a budget and an actual figure are published for the same service and year, the actual differs from budget by more than 10% and more than the 'big category' threshold.",
  contract_vs_payments: "Payments to a contract's supplier during the contract period exceed 150% of the published contract value by more than the 'big change' threshold. Suppliers often hold several contracts, so this is only a prompt to look.",
};

export async function computeFlags(): Promise<Record<string, number>> {
  const authorities = await prisma.authority.findMany();
  const flags: FlagInput[] = [];
  for (const a of authorities) {
    const th = TIER_THRESHOLDS[a.tier] ?? TIER_THRESHOLDS.other;
    flags.push(...(await supplierTrends(a.id, th)));
    flags.push(...(await concentration(a.id)));
    flags.push(...(await duplicates(a.id, th)));
    flags.push(...(await categoryYoy(a.id, th)));
    flags.push(...(await budgetVsActual(a.id, th)));
    flags.push(...(await contractVsPayments(a.id, th)));
  }
  await prisma.$transaction([prisma.anomalyFlag.deleteMany(), prisma.anomalyFlag.createMany({ data: flags })]);
  const counts: Record<string, number> = {};
  for (const f of flags) counts[f.rule] = (counts[f.rule] ?? 0) + 1;
  return counts;
}

async function dataRange(authorityId: string) {
  const r = await prisma.transaction.aggregate({ where: { authorityId, dataset: { isFixture: false } }, _min: { date: true }, _max: { date: true } });
  return { min: r._min.date, max: r._max.date };
}

function isCompleteFy(fy: string, maxDate: Date): boolean {
  return maxDate.getTime() >= fyEnd(fy).getTime() - 7 * 86400_000;
}

async function supplierTrends(authorityId: string, th: { bigSupplier: number; bigChange: number }): Promise<FlagInput[]> {
  const { max } = await dataRange(authorityId);
  if (!max) return [];
  const latestFy = financialYear(max);
  const complete = isCompleteFy(latestFy, max);
  const stats = await prisma.supplierAuthorityStat.findMany({ where: { authorityId }, include: { supplier: { select: { displayName: true } } } });
  const bySupplier = new Map<string, { name: string; years: Map<string, number> }>();
  for (const s of stats) {
    const e = bySupplier.get(s.supplierId) ?? { name: s.supplier.displayName, years: new Map() };
    e.years.set(s.financialYear, Number(s.total));
    bySupplier.set(s.supplierId, e);
  }
  // For an incomplete year, compare like-for-like months of the previous year.
  let priorSamePeriod = new Map<string, number>();
  if (!complete) {
    const prevFy = `${parseInt(latestFy.slice(0, 4)) - 1}/${latestFy.slice(0, 4).slice(2)}`;
    const prevStart = new Date(Date.UTC(parseInt(prevFy.slice(0, 4)), 3, 1));
    const prevEnd = new Date(Date.UTC(max.getUTCFullYear() - 1, max.getUTCMonth(), max.getUTCDate()));
    const rows = await prisma.$queryRaw<Array<{ supplierId: string; total: Prisma.Decimal }>>`
      SELECT t."supplierId", SUM(t.amount) AS total FROM "Transaction" t JOIN "SourceDataset" d ON d.id = t."datasetId"
      WHERE t."authorityId" = ${authorityId} AND d."isFixture" = false AND t."supplierId" IS NOT NULL AND t.date >= ${prevStart} AND t.date <= ${prevEnd} GROUP BY t."supplierId"`;
    priorSamePeriod = new Map(rows.map((r) => [r.supplierId, Number(r.total)]));
  }
  const out: FlagInput[] = [];
  for (const [supplierId, e] of bySupplier) {
    const years = [...e.years.keys()].sort();
    const latest = e.years.get(latestFy);
    if (latest === undefined) continue;
    const prior = years.filter((y) => y < latestFy);
    if (prior.length === 0) {
      if (latest >= th.bigSupplier) {
        out.push({ authorityId, supplierId, rule: "new_large_supplier", severity: latest >= th.bigSupplier * 4 ? "high" : "notable", periodLabel: latestFy,
          title: `${e.name}: new supplier paid £${fmt(latest)} in ${latestFy}`,
          reason: `No payments to this supplier appear in earlier years of the indexed data, and payments in ${latestFy} total £${fmt(latest)} (threshold £${fmt(th.bigSupplier)}). It may simply be a supplier that was renamed, newly contracted, or previously below the £500 reporting threshold.`,
          evidence: { latestFy, latestTotal: round2(latest), threshold: th.bigSupplier, firstSeenYear: latestFy, indexedYears: years } });
      }
      continue;
    }
    if (complete) {
      if (prior.length < 2) continue;
      const priorVals = prior.map((y) => e.years.get(y)!);
      const avg = priorVals.reduce((a, b) => a + b, 0) / priorVals.length;
      if (avg < th.bigChange) continue;
      const pct = (latest - avg) / avg;
      if (pct >= 1 && latest - avg >= th.bigChange) {
        out.push({ authorityId, supplierId, rule: "supplier_rapid_increase", severity: pct >= 3 ? "high" : "notable", periodLabel: latestFy,
          title: `${e.name}: +${Math.round(pct * 100)}% in ${latestFy} vs previous average`,
          reason: `Payments in ${latestFy} were £${fmt(latest)}, compared with an average of £${fmt(avg)} over ${prior.join(", ")}. Rule: increase of at least 100% and at least £${fmt(th.bigChange)}.`,
          evidence: { byYear: Object.fromEntries(years.map((y) => [y, round2(e.years.get(y)!)])), priorAverage: round2(avg), latest: round2(latest), increasePct: round2(pct * 100), threshold: { minPct: 100, minAbs: th.bigChange } } });
      }
    } else {
      const prev = priorSamePeriod.get(supplierId);
      if (prev === undefined || prev < th.bigChange) continue;
      const pct = (latest - prev) / prev;
      if (pct >= 1 && latest - prev >= th.bigChange) {
        out.push({ authorityId, supplierId, rule: "supplier_rapid_increase", severity: pct >= 3 ? "high" : "notable", periodLabel: `${latestFy} (to ${max.toISOString().slice(0, 10)})`,
          title: `${e.name}: +${Math.round(pct * 100)}% so far in ${latestFy} vs same period last year`,
          reason: `Payments from 1 April to ${max.toISOString().slice(0, 10)} total £${fmt(latest)}, compared with £${fmt(prev)} over the same dates a year earlier. ${latestFy} is not yet complete. Rule: increase of at least 100% and at least £${fmt(th.bigChange)}.`,
          evidence: { byYear: Object.fromEntries(years.map((y) => [y, round2(e.years.get(y)!)])), samePeriodPrior: round2(prev), latestToDate: round2(latest), increasePct: round2(pct * 100), periodEnd: max.toISOString().slice(0, 10), threshold: { minPct: 100, minAbs: th.bigChange } } });
      }
    }
  }
  return out;
}

async function concentration(authorityId: string): Promise<FlagInput[]> {
  const rows = await prisma.$queryRaw<Array<{ financialYear: string; supplierId: string; name: string; total: Prisma.Decimal; yearTotal: Prisma.Decimal; suppliers: bigint }>>`
    WITH y AS (SELECT "financialYear", SUM(total) AS "yearTotal", COUNT(*) AS suppliers FROM "SupplierAuthorityStat" WHERE "authorityId" = ${authorityId} GROUP BY "financialYear")
    SELECT s."financialYear", s."supplierId", sp."displayName" AS name, s.total, y."yearTotal", y.suppliers
    FROM "SupplierAuthorityStat" s JOIN y ON y."financialYear" = s."financialYear" JOIN "Supplier" sp ON sp.id = s."supplierId"
    WHERE s."authorityId" = ${authorityId} AND y.suppliers >= 50 AND s.total > 0.15 * y."yearTotal"`;
  return rows.map((r) => {
    const share = Number(r.total) / Number(r.yearTotal);
    return { authorityId, supplierId: r.supplierId, rule: "supplier_concentration", severity: share > 0.3 ? "high" : "notable", periodLabel: r.financialYear,
      title: `${r.name} received ${Math.round(share * 100)}% of all indexed payments in ${r.financialYear}`,
      reason: `£${fmt(Number(r.total))} of £${fmt(Number(r.yearTotal))} paid to ${Number(r.suppliers)} suppliers went to this one supplier. Large outsourced services (waste, highways, care) normally look like this; it shows dependence, not wrongdoing.`,
      evidence: { financialYear: r.financialYear, supplierTotal: round2(Number(r.total)), authorityTotal: round2(Number(r.yearTotal)), sharePct: round2(share * 100), suppliersPaid: Number(r.suppliers), threshold: 15 } };
  });
}

async function duplicates(authorityId: string, th: { dupMin: number }): Promise<FlagInput[]> {
  const rows = await prisma.$queryRaw<Array<{ supplierId: string | null; supplierRaw: string; date: Date; amount: Prisma.Decimal; reference: string | null; n: bigint; ids: string[] }>>`
    SELECT t."supplierId", t."supplierRaw", t.date, t.amount, t.reference, COUNT(*) AS n, array_agg(t.id) AS ids
    FROM "Transaction" t JOIN "SourceDataset" d ON d.id = t."datasetId"
    WHERE t."authorityId" = ${authorityId} AND d."isFixture" = false AND t.amount >= ${th.dupMin}
    GROUP BY t."supplierId", t."supplierRaw", t.date, t.amount, t.reference HAVING COUNT(*) > 1 ORDER BY t.amount DESC LIMIT 200`;
  return rows.map((r) => ({ authorityId, supplierId: r.supplierId, rule: "duplicate_looking_payments", severity: "info", periodLabel: r.date.toISOString().slice(0, 10),
    title: `${r.supplierRaw}: ${Number(r.n)} identical rows of £${fmt(Number(r.amount))} on ${r.date.toISOString().slice(0, 10)}`,
    reason: `${Number(r.n)} published rows share the same date, supplier, amount${r.reference ? ` and reference "${r.reference}"` : ""}. This can be a genuine repeated payment (several invoices, instalments, split cost centres) or a duplicate in the published data.`,
    evidence: { transactionIds: r.ids, count: Number(r.n), amount: round2(Number(r.amount)), date: r.date.toISOString().slice(0, 10), reference: r.reference, threshold: th.dupMin } }));
}

async function categoryYoy(authorityId: string, th: { bigCategory: number }): Promise<FlagInput[]> {
  const { max } = await dataRange(authorityId);
  if (!max) return [];
  const rows = await prisma.$queryRaw<Array<{ category: string; financialYear: string; total: Prisma.Decimal }>>`
    SELECT t.category, t."financialYear", SUM(t.amount) AS total FROM "Transaction" t JOIN "SourceDataset" d ON d.id = t."datasetId"
    WHERE t."authorityId" = ${authorityId} AND d."isFixture" = false AND t.category IS NOT NULL GROUP BY t.category, t."financialYear"`;
  const byCat = new Map<string, Map<string, number>>();
  for (const r of rows) { if (!byCat.has(r.category)) byCat.set(r.category, new Map()); byCat.get(r.category)!.set(r.financialYear, Number(r.total)); }
  const out: FlagInput[] = [];
  for (const [cat, years] of byCat) {
    const ys = [...years.keys()].sort().filter((y) => isCompleteFy(y, max));
    for (let i = 1; i < ys.length; i++) {
      const a = years.get(ys[i - 1])!, b = years.get(ys[i])!;
      if (Math.max(Math.abs(a), Math.abs(b)) < th.bigCategory || a <= 0) continue;
      const pct = (b - a) / a;
      if (Math.abs(pct) >= 0.5 && Math.abs(b - a) >= th.bigCategory) {
        out.push({ authorityId, rule: "category_yoy_change", severity: Math.abs(pct) >= 1 ? "notable" : "info", periodLabel: ys[i],
          title: `${cat}: ${pct > 0 ? "+" : ""}${Math.round(pct * 100)}% from ${ys[i - 1]} to ${ys[i]}`,
          reason: `Payments categorised "${cat}" were £${fmt(a)} in ${ys[i - 1]} and £${fmt(b)} in ${ys[i]}. Category labels are the council's own and can be re-coded between years.`,
          evidence: { category: cat, from: { year: ys[i - 1], total: round2(a) }, to: { year: ys[i], total: round2(b) }, changePct: round2(pct * 100), threshold: { minPct: 50, minAbs: th.bigCategory } } });
      }
    }
  }
  return out;
}

async function budgetVsActual(authorityId: string, th: { bigCategory: number }): Promise<FlagInput[]> {
  const lines = await prisma.budgetLine.findMany({ where: { authorityId, dataset: { isFixture: false }, budget: { not: null }, actual: { not: null } }, include: { dataset: { select: { sourceUrl: true, title: true } } } });
  const out: FlagInput[] = [];
  for (const l of lines) {
    const b = Number(l.budget), a = Number(l.actual);
    if (b === 0) continue;
    const pct = (a - b) / Math.abs(b);
    if (Math.abs(pct) >= 0.1 && Math.abs(a - b) >= th.bigCategory) {
      out.push({ authorityId, rule: "budget_vs_actual", severity: Math.abs(pct) >= 0.25 ? "notable" : "info", periodLabel: l.financialYear,
        title: `${l.service} (${l.measure}): actual ${pct > 0 ? "over" : "under"} budget by ${Math.round(Math.abs(pct) * 100)}% in ${l.financialYear}`,
        reason: `Published budget £${fmt(b)}, published actual £${fmt(a)} (${l.dataset.title}). Councils report reasons for variances in outturn reports; see the source document.`,
        evidence: { budgetLineId: l.id, budget: round2(b), actual: round2(a), variance: round2(a - b), variancePct: round2(pct * 100), sourceUrl: l.dataset.sourceUrl, pageRef: l.pageRef, threshold: { minPct: 10, minAbs: th.bigCategory } } });
    }
  }
  return out;
}

async function contractVsPayments(authorityId: string, th: { bigChange: number }): Promise<FlagInput[]> {
  const contracts = await prisma.contract.findMany({ where: { authorityId, dataset: { isFixture: false }, supplierId: { not: null }, value: { not: null }, startDate: { not: null } } });
  const out: FlagInput[] = [];
  for (const c of contracts) {
    const value = Number(c.value);
    if (value <= 0) continue;
    const end = c.endDate ?? new Date();
    const agg = await prisma.transaction.aggregate({ where: { authorityId, supplierId: c.supplierId!, dataset: { isFixture: false }, date: { gte: c.startDate!, lte: end } }, _sum: { amount: true }, _count: true });
    const paid = Number(agg._sum.amount ?? 0);
    if (paid > 1.5 * value && paid - value >= th.bigChange) {
      out.push({ authorityId, supplierId: c.supplierId, rule: "contract_vs_payments", severity: paid > 3 * value ? "notable" : "info", periodLabel: `${c.startDate!.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`,
        title: `${c.supplierRaw}: payments of £${fmt(paid)} vs contract value £${fmt(value)} ("${c.title}")`,
        reason: `${agg._count} payments to this supplier between the contract start and end dates total £${fmt(paid)}, which is ${round2(paid / value)}× the published contract value. The supplier may hold other contracts or the value may be annual rather than total; the register's own value basis is "${c.valueBasis ?? "not stated"}".`,
        evidence: { contractId: c.id, contractValue: round2(value), valueBasis: c.valueBasis, paymentsInPeriod: round2(paid), paymentCount: agg._count, ratio: round2(paid / value), threshold: { minRatio: 1.5, minAbs: th.bigChange } } });
    }
  }
  return out;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}
