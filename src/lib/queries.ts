/**
 * Deterministic queries. Every number shown anywhere in the app comes from here (or from the
 * pipeline's materialised stats). Nothing here calls an AI model.
 */
import { prisma } from "./db";
import { Prisma } from "@prisma/client";

const PUBLIC = { dataset: { isFixture: false } } as const;

export interface Overview {
  total: number;
  transactions: number;
  suppliers: number;
  authorities: Array<{ id: string; name: string; shortName: string; tier: string; total: number; transactions: number; minDate: Date | null; maxDate: Date | null; datasets: number }>;
  minDate: Date | null;
  maxDate: Date | null;
  datasets: number;
  contracts: number;
  decisions: number;
  flags: number;
  lastImport: Date | null;
}

export async function getOverview(): Promise<Overview> {
  const [auths, agg, suppliers, datasets, contracts, decisions, flags, lastRun] = await Promise.all([
    prisma.authority.findMany({ orderBy: { tier: "asc" } }),
    prisma.transaction.aggregate({ where: PUBLIC, _sum: { amount: true }, _count: true, _min: { date: true }, _max: { date: true } }),
    prisma.transaction.findMany({ where: { ...PUBLIC, supplierId: { not: null } }, distinct: ["supplierId"], select: { supplierId: true } }),
    prisma.sourceDataset.count({ where: { isFixture: false } }),
    prisma.contract.count({ where: PUBLIC }),
    prisma.decision.count(),
    prisma.anomalyFlag.count(),
    prisma.importRun.findFirst({ where: { status: "success", stage: "import" }, orderBy: { startedAt: "desc" } }),
  ]);
  const perAuth = await prisma.transaction.groupBy({ by: ["authorityId"], where: PUBLIC, _sum: { amount: true }, _count: true, _min: { date: true }, _max: { date: true } });
  const dsPerAuth = await prisma.sourceDataset.groupBy({ by: ["authorityId"], where: { isFixture: false }, _count: true });
  const order = { county: 0, unitary: 0, district: 1, parish: 2, other: 3 } as Record<string, number>;
  return {
    total: Number(agg._sum.amount ?? 0), transactions: agg._count, suppliers: suppliers.length, minDate: agg._min.date, maxDate: agg._max.date,
    datasets, contracts, decisions, flags, lastImport: lastRun?.startedAt ?? null,
    authorities: auths.sort((a, b) => (order[a.tier] ?? 9) - (order[b.tier] ?? 9)).map((a) => {
      const p = perAuth.find((x) => x.authorityId === a.id);
      return { id: a.id, name: a.name, shortName: a.shortName, tier: a.tier, total: Number(p?._sum.amount ?? 0), transactions: p?._count ?? 0, minDate: p?._min.date ?? null, maxDate: p?._max.date ?? null, datasets: dsPerAuth.find((x) => x.authorityId === a.id)?._count ?? 0 };
    }),
  };
}

export async function listAuthorities() {
  return prisma.authority.findMany({ orderBy: { name: "asc" } });
}

export async function listFinancialYears(authorityId?: string): Promise<string[]> {
  const rows = await prisma.transaction.findMany({ where: { ...PUBLIC, ...(authorityId ? { authorityId } : {}) }, distinct: ["financialYear"], select: { financialYear: true }, orderBy: { financialYear: "desc" } });
  return rows.map((r) => r.financialYear);
}

export async function spendByMonth(authorityId?: string): Promise<Array<{ month: string; [k: string]: number | string }>> {
  const rows = await prisma.$queryRaw<Array<{ month: string; authorityId: string; total: Prisma.Decimal }>>`
    SELECT to_char(date, 'YYYY-MM') AS month, t."authorityId", SUM(amount) AS total
    FROM "Transaction" t JOIN "SourceDataset" d ON d.id = t."datasetId"
    WHERE d."isFixture" = false ${authorityId ? Prisma.sql`AND t."authorityId" = ${authorityId}` : Prisma.empty}
    GROUP BY 1, 2 ORDER BY 1`;
  const byMonth = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    const m = byMonth.get(r.month) ?? { month: r.month };
    m[r.authorityId] = Number(r.total);
    byMonth.set(r.month, m);
  }
  return [...byMonth.values()] as Array<{ month: string; [k: string]: number | string }>;
}

export async function spendByYearAndAuthority(): Promise<Array<{ financialYear: string; authorityId: string; total: number; count: number }>> {
  const rows = await prisma.transaction.groupBy({ by: ["financialYear", "authorityId"], where: PUBLIC, _sum: { amount: true }, _count: true, orderBy: { financialYear: "asc" } });
  return rows.map((r) => ({ financialYear: r.financialYear, authorityId: r.authorityId, total: Number(r._sum.amount ?? 0), count: r._count }));
}

export async function spendByCategory(opts: { authorityId?: string; financialYear?: string; field?: "category" | "department" | "serviceArea"; limit?: number } = {}) {
  const field = opts.field ?? "category";
  const rows = await prisma.transaction.groupBy({ by: [field], where: { ...PUBLIC, ...(opts.authorityId ? { authorityId: opts.authorityId } : {}), ...(opts.financialYear ? { financialYear: opts.financialYear } : {}) }, _sum: { amount: true }, _count: true, orderBy: { _sum: { amount: "desc" } }, take: opts.limit ?? 15 });
  return rows.map((r) => ({ name: (r as Record<string, unknown>)[field] as string | null, total: Number(r._sum.amount ?? 0), count: r._count }));
}

export async function categoryByYear(opts: { authorityId?: string; category: string }) {
  const rows = await prisma.transaction.groupBy({ by: ["financialYear"], where: { ...PUBLIC, category: opts.category, ...(opts.authorityId ? { authorityId: opts.authorityId } : {}) }, _sum: { amount: true }, _count: true, orderBy: { financialYear: "asc" } });
  return rows.map((r) => ({ financialYear: r.financialYear, total: Number(r._sum.amount ?? 0), count: r._count }));
}

export interface SupplierRankRow { supplierId: string; name: string; total: number; count: number; authorities: string[] }

export async function topSuppliers(opts: { authorityId?: string; financialYear?: string; limit?: number; offset?: number; q?: string } = {}): Promise<{ rows: SupplierRankRow[]; totalCount: number }> {
  const where: Prisma.Sql[] = [];
  if (opts.authorityId) where.push(Prisma.sql`s."authorityId" = ${opts.authorityId}`);
  if (opts.financialYear) where.push(Prisma.sql`s."financialYear" = ${opts.financialYear}`);
  if (opts.q) where.push(Prisma.sql`(sp."displayName" ILIKE ${"%" + opts.q + "%"} OR EXISTS (SELECT 1 FROM "SupplierAlias" a WHERE a."supplierId" = sp.id AND a."rawName" ILIKE ${"%" + opts.q + "%"}))`);
  const w = where.length ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ supplierId: string; name: string; total: Prisma.Decimal; count: bigint; authorities: string[] }>>`
    SELECT s."supplierId", sp."displayName" AS name, SUM(s.total) AS total, SUM(s.count) AS count, array_agg(DISTINCT s."authorityId") AS authorities
    FROM "SupplierAuthorityStat" s JOIN "Supplier" sp ON sp.id = s."supplierId" ${w}
    GROUP BY s."supplierId", sp."displayName" ORDER BY total DESC LIMIT ${opts.limit ?? 50} OFFSET ${opts.offset ?? 0}`;
  const cnt = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(DISTINCT s."supplierId") AS n FROM "SupplierAuthorityStat" s JOIN "Supplier" sp ON sp.id = s."supplierId" ${w}`;
  return { rows: rows.map((r) => ({ supplierId: r.supplierId, name: r.name, total: Number(r.total), count: Number(r.count), authorities: r.authorities })), totalCount: Number(cnt[0]?.n ?? 0) };
}

export async function getSupplier(id: string) {
  const supplier = await prisma.supplier.findUnique({ where: { id }, include: { aliases: { orderBy: { occurrences: "desc" } }, stats: { include: { authority: true }, orderBy: [{ financialYear: "asc" }] }, contracts: { include: { authority: true, dataset: true }, orderBy: { startDate: "desc" } }, flags: { orderBy: { computedAt: "desc" } } } });
  if (!supplier) return null;
  const [agg, categories, datasets] = await Promise.all([
    prisma.transaction.aggregate({ where: { ...PUBLIC, supplierId: id }, _sum: { amount: true }, _count: true, _min: { date: true }, _max: { date: true } }),
    prisma.transaction.groupBy({ by: ["authorityId", "category"], where: { ...PUBLIC, supplierId: id }, _sum: { amount: true }, _count: true, orderBy: { _sum: { amount: "desc" } }, take: 12 }),
    prisma.transaction.findMany({ where: { ...PUBLIC, supplierId: id }, distinct: ["datasetId"], select: { dataset: { select: { id: true, title: true, sourceUrl: true, sourcePageUrl: true, retrievedAt: true, publishedAt: true, authorityId: true } } } }),
  ]);
  return { supplier, total: Number(agg._sum.amount ?? 0), count: agg._count, minDate: agg._min.date, maxDate: agg._max.date, categories: categories.map((c) => ({ authorityId: c.authorityId, category: c.category, total: Number(c._sum.amount ?? 0), count: c._count })), datasets: datasets.map((d) => d.dataset) };
}

export interface TxFilter { q?: string; authorityId?: string; supplierId?: string; category?: string; department?: string; financialYear?: string; from?: string; to?: string; min?: number; max?: number; sort?: "date" | "amount"; dir?: "asc" | "desc"; page?: number; pageSize?: number }

export function txWhere(f: TxFilter): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = { ...PUBLIC };
  if (f.authorityId) where.authorityId = f.authorityId;
  if (f.supplierId) where.supplierId = f.supplierId;
  if (f.category) where.category = f.category;
  if (f.department) where.department = f.department;
  if (f.financialYear) where.financialYear = f.financialYear;
  if (f.from || f.to) where.date = { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lte: new Date(f.to) } : {}) };
  if (f.min !== undefined || f.max !== undefined) where.amount = { ...(f.min !== undefined ? { gte: f.min } : {}), ...(f.max !== undefined ? { lte: f.max } : {}) };
  if (f.q) where.OR = [{ supplierRaw: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }, { category: { contains: f.q, mode: "insensitive" } }, { department: { contains: f.q, mode: "insensitive" } }, { serviceArea: { contains: f.q, mode: "insensitive" } }, { reference: { equals: f.q } }];
  return where;
}

export async function searchTransactions(f: TxFilter) {
  const where = txWhere(f);
  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const page = Math.max(f.page ?? 1, 1);
  const [rows, count, agg] = await Promise.all([
    prisma.transaction.findMany({ where, include: { authority: { select: { shortName: true } }, supplier: { select: { id: true, displayName: true } } }, orderBy: f.sort === "amount" ? { amount: f.dir ?? "desc" } : { date: f.dir ?? "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.transaction.count({ where }),
    prisma.transaction.aggregate({ where, _sum: { amount: true } }),
  ]);
  return { rows, count, total: Number(agg._sum.amount ?? 0), page, pageSize };
}

export async function getTransaction(id: string) {
  return prisma.transaction.findUnique({ where: { id }, include: { authority: true, supplier: { include: { aliases: true } }, dataset: { include: { importRuns: { orderBy: { startedAt: "desc" } } } } } });
}

export async function listContracts(opts: { authorityId?: string; q?: string; supplierId?: string; year?: number; sort?: "value" | "date"; page?: number; pageSize?: number } = {}) {
  const where: Prisma.ContractWhereInput = { ...PUBLIC };
  if (opts.authorityId) where.authorityId = opts.authorityId;
  if (opts.supplierId) where.supplierId = opts.supplierId;
  if (opts.year) where.OR = [{ awardDate: { gte: new Date(Date.UTC(opts.year, 0, 1)), lt: new Date(Date.UTC(opts.year + 1, 0, 1)) } }, { startDate: { gte: new Date(Date.UTC(opts.year, 0, 1)), lt: new Date(Date.UTC(opts.year + 1, 0, 1)) } }];
  if (opts.q) where.AND = [{ OR: [{ title: { contains: opts.q, mode: "insensitive" } }, { description: { contains: opts.q, mode: "insensitive" } }, { supplierRaw: { contains: opts.q, mode: "insensitive" } }, { reference: { contains: opts.q, mode: "insensitive" } }] }];
  const pageSize = opts.pageSize ?? 50, page = Math.max(opts.page ?? 1, 1);
  const [rows, count] = await Promise.all([
    prisma.contract.findMany({ where, include: { authority: { select: { shortName: true } }, supplier: { select: { id: true, displayName: true } } }, orderBy: opts.sort === "date" ? [{ startDate: { sort: "desc", nulls: "last" } }] : [{ value: { sort: "desc", nulls: "last" } }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.contract.count({ where }),
  ]);
  return { rows, count, page, pageSize };
}

export async function getContract(id: string) {
  const c = await prisma.contract.findUnique({ where: { id }, include: { authority: true, supplier: true, dataset: true } });
  if (!c) return null;
  let payments: { total: number; count: number; byYear: Array<{ financialYear: string; total: number }> } | null = null;
  if (c.supplierId) {
    const where: Prisma.TransactionWhereInput = { ...PUBLIC, supplierId: c.supplierId, authorityId: c.authorityId, ...(c.startDate ? { date: { gte: c.startDate, ...(c.endDate ? { lte: c.endDate } : {}) } } : {}) };
    const [agg, byYear] = await Promise.all([prisma.transaction.aggregate({ where, _sum: { amount: true }, _count: true }), prisma.transaction.groupBy({ by: ["financialYear"], where, _sum: { amount: true }, orderBy: { financialYear: "asc" } })]);
    payments = { total: Number(agg._sum.amount ?? 0), count: agg._count, byYear: byYear.map((y) => ({ financialYear: y.financialYear, total: Number(y._sum.amount ?? 0) })) };
  }
  return { contract: c, payments };
}

export async function listFlags(opts: { authorityId?: string; rule?: string; severity?: string } = {}) {
  return prisma.anomalyFlag.findMany({ where: { ...(opts.authorityId ? { authorityId: opts.authorityId } : {}), ...(opts.rule ? { rule: opts.rule } : {}), ...(opts.severity ? { severity: opts.severity } : {}) }, include: { authority: { select: { shortName: true } }, supplier: { select: { id: true, displayName: true } } }, orderBy: [{ severity: "asc" }, { computedAt: "desc" }] });
}

export async function getFlag(id: string) {
  return prisma.anomalyFlag.findUnique({ where: { id }, include: { authority: true, supplier: true } });
}

export async function listDecisions(opts: { authorityId?: string; q?: string; month?: string; page?: number } = {}) {
  const where: Prisma.DecisionWhereInput = {};
  if (opts.authorityId) where.authorityId = opts.authorityId;
  if (opts.q) where.OR = [{ title: { contains: opts.q, mode: "insensitive" } }, { proposal: { contains: opts.q, mode: "insensitive" } }];
  if (opts.month) { const [y, m] = opts.month.split("-").map(Number); where.decisionDate = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) }; }
  const page = Math.max(opts.page ?? 1, 1);
  const [rows, count] = await Promise.all([prisma.decision.findMany({ where, include: { authority: { select: { shortName: true } } }, orderBy: [{ decisionDate: { sort: "desc", nulls: "last" } }], skip: (page - 1) * 50, take: 50 }), prisma.decision.count({ where })]);
  return { rows, count, page };
}

export async function getDecision(id: string) {
  return prisma.decision.findUnique({ where: { id }, include: { authority: true, documents: true } });
}

export async function listDatasets() {
  return prisma.sourceDataset.findMany({ where: { isFixture: false }, include: { authority: { select: { shortName: true } }, _count: { select: { transactions: true, contracts: true } }, importRuns: { orderBy: { startedAt: "desc" }, take: 3 } }, orderBy: [{ authorityId: "asc" }, { periodStart: "desc" }] });
}

export async function listImportRuns(limit = 50) {
  return prisma.importRun.findMany({ include: { dataset: { select: { title: true, authorityId: true } } }, orderBy: { startedAt: "desc" }, take: limit });
}

export async function searchDocuments(q: string, limit = 20) {
  return prisma.document.findMany({ where: { OR: [{ title: { contains: q, mode: "insensitive" } }, { textExcerpt: { contains: q, mode: "insensitive" } }] }, include: { authority: { select: { shortName: true } } }, orderBy: [{ meetingDate: { sort: "desc", nulls: "last" } }], take: limit });
}

export async function unifiedSearch(q: string) {
  const [suppliers, tx, contracts, docs, decisions, categories] = await Promise.all([
    topSuppliers({ q, limit: 10 }),
    searchTransactions({ q, pageSize: 10, sort: "amount" }),
    listContracts({ q, pageSize: 10 }),
    searchDocuments(q, 10),
    listDecisions({ q }),
    prisma.transaction.groupBy({ by: ["category"], where: { ...PUBLIC, category: { contains: q, mode: "insensitive" } }, _sum: { amount: true }, _count: true, orderBy: { _sum: { amount: "desc" } }, take: 8 }),
  ]);
  return { suppliers: suppliers.rows, transactions: tx, contracts: contracts.rows, documents: docs, decisions: decisions.rows, categories: categories.map((c) => ({ name: c.category, total: Number(c._sum.amount ?? 0), count: c._count })) };
}
