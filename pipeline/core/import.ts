/**
 * Import stage: archived file → validated rows → database, with an ImportRun audit trail and
 * a post-import verification that the database total equals the validated file total.
 * Rerunnable: the same file (same sha256) is skipped; a changed file at the same URL replaces
 * the previous version's rows.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { Adapter, DiscoveredFile, NormalisedContract, NormalisedTransaction } from "./types";
import type { Archived } from "./fetch";
import { validateTransactions, rowHash, type ValidationReport } from "./validate";
import { financialYear, round2 } from "./parse";
import { normaliseSupplierName, chooseDisplayName, isNonSupplierPayee } from "./supplier";
import { createHash } from "node:crypto";

export async function ensureAuthority(adapter: Adapter) {
  const a = adapter.authority;
  await prisma.authority.upsert({
    where: { id: a.id },
    update: { name: a.name, shortName: a.shortName, tier: a.tier, area: a.area, website: a.website, onsCode: a.onsCode, population: a.population, populationSource: a.populationSource, notes: a.notes },
    create: { id: a.id, name: a.name, shortName: a.shortName, tier: a.tier, area: a.area, website: a.website, onsCode: a.onsCode, population: a.population, populationSource: a.populationSource, notes: a.notes },
  });
}

export interface ImportOutcome {
  status: "imported" | "skipped-unchanged" | "failed";
  datasetId?: string;
  report?: ValidationReport;
  rowsImported?: number;
  message: string;
}

export async function importTransactionsFile(adapter: Adapter, file: DiscoveredFile, archived: Archived, opts: { force?: boolean; isFixture?: boolean } = {}): Promise<ImportOutcome> {
  if (!adapter.parseTransactions) throw new Error(`${adapter.id} has no transactions parser`);
  await ensureAuthority(adapter);
  const authorityId = adapter.authority.id;

  const existing = await prisma.sourceDataset.findFirst({ where: { authorityId, sourceUrl: file.url } });
  if (existing && existing.sha256 === archived.sha256 && !opts.force) {
    const n = await prisma.transaction.count({ where: { datasetId: existing.id } });
    if (n > 0) {
      await refreshDatasetMeta(existing.id, file);
      await log({ datasetId: existing.id, adapter: adapter.id, stage: "import", status: "skipped", message: `Unchanged (sha256 ${archived.sha256.slice(0, 12)}); ${n} rows already imported` });
      return { status: "skipped-unchanged", datasetId: existing.id, message: `unchanged, ${n} rows already in database` };
    }
  }

  const run = await prisma.importRun.create({ data: { adapter: adapter.id, stage: "import", status: "running", message: `${file.title} ← ${file.url}` } });
  try {
    const parsed = await adapter.parseTransactions(archived.buffer, file);
    const report = validateTransactions(parsed, {
      periodStart: file.periodStart ? new Date(file.periodStart) : undefined,
      periodEnd: file.periodEnd ? new Date(file.periodEnd) : undefined,
    });

    const datasetId = await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.transaction.deleteMany({ where: { datasetId: existing.id } });
        await tx.sourceDataset.delete({ where: { id: existing.id } });
      }
      const ds = await tx.sourceDataset.create({
        data: {
          authorityId, adapter: adapter.id, kind: "transactions", title: file.title, sourceUrl: file.url, sourcePageUrl: file.pageUrl,
          licence: file.licence, publishedAt: file.publishedAt ? new Date(file.publishedAt) : null,
          periodStart: file.periodStart ? new Date(file.periodStart) : null, periodEnd: file.periodEnd ? new Date(file.periodEnd) : null,
          retrievedAt: archived.retrievedAt, archivePath: archived.archivePath, sha256: archived.sha256, bytes: archived.bytes, format: file.format,
          isFixture: opts.isFixture ?? false,
        },
      });
      const supplierIds = await resolveSuppliers(tx, parsed.rows.map((r) => r.supplierRaw));
      const data: Prisma.TransactionCreateManyInput[] = parsed.rows.map((r) => ({
        authorityId, datasetId: ds.id, rowNumber: r.rowNumber, date: r.date, financialYear: financialYear(r.date),
        supplierRaw: r.supplierRaw, supplierId: supplierIds.get(r.supplierRaw) ?? null, amount: new Prisma.Decimal(r.amount.toFixed(2)),
        amountIsNet: r.amountIsNet ?? null, department: r.department, serviceArea: r.serviceArea, category: r.category,
        description: r.description, reference: r.reference, extra: r.extra ? (r.extra as Prisma.InputJsonValue) : undefined, rowHash: rowHash(r),
      }));
      for (let i = 0; i < data.length; i += 2000) await tx.transaction.createMany({ data: data.slice(i, i + 2000), skipDuplicates: true });
      return ds.id;
    }, { timeout: 120_000 });

    // Verify: database total must equal the validated file total.
    const agg = await prisma.transaction.aggregate({ where: { datasetId }, _sum: { amount: true }, _count: true });
    const dbTotal = round2(Number(agg._sum.amount ?? 0));
    const ok = Math.abs(dbTotal - report.totalAmount) < 0.005 && agg._count === report.rowsParsed;
    await log({ datasetId, adapter: adapter.id, stage: "verify", status: ok ? "success" : "failed", rowsRead: report.rowsParsed, rowsImported: agg._count, totalAmount: dbTotal,
      message: ok ? `Database total £${dbTotal.toLocaleString("en-GB")} matches file total` : `MISMATCH: db £${dbTotal} / ${agg._count} rows vs file £${report.totalAmount} / ${report.rowsParsed} rows` });
    if (!ok) throw new Error(`Verification failed for ${file.title}: database total ${dbTotal} (${agg._count} rows) != file total ${report.totalAmount} (${report.rowsParsed} rows). Possible duplicate rows collapsed by rowHash.`);

    await prisma.importRun.update({ where: { id: run.id }, data: { datasetId, status: "success", finishedAt: new Date(), rowsRead: report.rowsParsed + report.rowsRejected, rowsImported: agg._count, rowsRejected: report.rowsRejected, totalAmount: dbTotal, checks: report as unknown as Prisma.InputJsonValue } });
    return { status: "imported", datasetId, report, rowsImported: agg._count, message: `${agg._count} rows, £${dbTotal.toLocaleString("en-GB")}` };
  } catch (e) {
    const err = e as Error;
    await prisma.importRun.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), error: `${err.name}: ${err.message}`.slice(0, 4000) } });
    return { status: "failed", message: err.message };
  }
}

export async function importContractsFile(adapter: Adapter, file: DiscoveredFile, archived: Archived, opts: { force?: boolean; isFixture?: boolean } = {}): Promise<ImportOutcome> {
  if (!adapter.parseContracts) throw new Error(`${adapter.id} has no contracts parser`);
  await ensureAuthority(adapter);
  const authorityId = adapter.authority.id;
  const existing = await prisma.sourceDataset.findFirst({ where: { authorityId, sourceUrl: file.url } });
  if (existing && existing.sha256 === archived.sha256 && !opts.force) {
    const n = await prisma.contract.count({ where: { datasetId: existing.id } });
    if (n > 0) { await refreshDatasetMeta(existing.id, file); return { status: "skipped-unchanged", datasetId: existing.id, message: `unchanged, ${n} contracts already in database` }; }
  }
  const run = await prisma.importRun.create({ data: { adapter: adapter.id, stage: "import", status: "running", message: `${file.title} ← ${file.url}` } });
  try {
    const parsed = await adapter.parseContracts(archived.buffer, file);
    if (parsed.rows.length === 0) throw new Error("No contract rows parsed");
    const rejectRate = parsed.rejected.length / (parsed.rows.length + parsed.rejected.length);
    if (rejectRate > 0.05) throw new Error(`${parsed.rejected.length} contract rows rejected (${(rejectRate * 100).toFixed(1)}%)`);
    const datasetId = await prisma.$transaction(async (tx) => {
      if (existing) { await tx.contract.deleteMany({ where: { datasetId: existing.id } }); await tx.sourceDataset.delete({ where: { id: existing.id } }); }
      const ds = await tx.sourceDataset.create({ data: {
        authorityId, adapter: adapter.id, kind: "contracts", title: file.title, sourceUrl: file.url, sourcePageUrl: file.pageUrl, licence: file.licence,
        publishedAt: file.publishedAt ? new Date(file.publishedAt) : null, periodStart: file.periodStart ? new Date(file.periodStart) : null, periodEnd: file.periodEnd ? new Date(file.periodEnd) : null,
        retrievedAt: archived.retrievedAt, archivePath: archived.archivePath, sha256: archived.sha256, bytes: archived.bytes, format: file.format, isFixture: opts.isFixture ?? false } });
      const supplierIds = await resolveSuppliers(tx, parsed.rows.map((r) => r.supplierRaw));
      const data: Prisma.ContractCreateManyInput[] = parsed.rows.map((c) => ({
        authorityId, datasetId: ds.id, rowNumber: c.rowNumber, reference: c.reference, title: c.title, description: c.description, supplierRaw: c.supplierRaw,
        supplierId: supplierIds.get(c.supplierRaw) ?? null, value: c.value != null ? new Prisma.Decimal(c.value.toFixed(2)) : null, valueBasis: c.valueBasis,
        awardDate: c.awardDate, startDate: c.startDate, endDate: c.endDate, reviewDate: c.reviewDate, department: c.department, category: c.category,
        procurementRoute: c.procurementRoute, sourceRecordUrl: c.sourceRecordUrl, extra: c.extra ? (c.extra as Prisma.InputJsonValue) : undefined, rowHash: contractHash(c),
      }));
      for (let i = 0; i < data.length; i += 1000) await tx.contract.createMany({ data: data.slice(i, i + 1000), skipDuplicates: true });
      return ds.id;
    }, { timeout: 120_000 });
    const n = await prisma.contract.count({ where: { datasetId } });
    await prisma.importRun.update({ where: { id: run.id }, data: { datasetId, status: "success", finishedAt: new Date(), rowsRead: parsed.rows.length + parsed.rejected.length, rowsImported: n, rowsRejected: parsed.rejected.length, checks: { headers: parsed.headers, headerMap: parsed.headerMap, rejectedSample: parsed.rejected.slice(0, 20) } as unknown as Prisma.InputJsonValue } });
    return { status: "imported", datasetId, rowsImported: n, message: `${n} contracts` };
  } catch (e) {
    const err = e as Error;
    await prisma.importRun.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), error: `${err.name}: ${err.message}`.slice(0, 4000) } });
    return { status: "failed", message: err.message };
  }
}

/** Metadata (title, period, licence, page) can be corrected by a later discovery without re-importing rows. */
async function refreshDatasetMeta(id: string, file: DiscoveredFile) {
  await prisma.sourceDataset.update({ where: { id }, data: { title: file.title, sourcePageUrl: file.pageUrl, licence: file.licence, periodStart: file.periodStart ? new Date(file.periodStart) : null, periodEnd: file.periodEnd ? new Date(file.periodEnd) : null } });
}

function contractHash(c: NormalisedContract): string {
  return createHash("sha256").update([c.reference ?? "", c.title, c.supplierRaw, c.value ?? "", c.startDate?.toISOString() ?? "", c.endDate?.toISOString() ?? ""].join("|").toLowerCase()).digest("hex");
}

type Tx = Prisma.TransactionClient;

/** Map each raw supplier name to a Supplier id, creating suppliers/aliases as needed. Conservative: exact key match only. */
export async function resolveSuppliers(tx: Tx, rawNames: string[]): Promise<Map<string, string>> {
  const counts = new Map<string, number>();
  for (const n of rawNames) counts.set(n, (counts.get(n) ?? 0) + 1);
  const result = new Map<string, string>();
  const byKey = new Map<string, Map<string, number>>();
  for (const [raw, n] of counts) {
    if (raw === "REDACTED (as published)" || isNonSupplierPayee(raw)) continue; // never a supplier: kept on the row only
    const key = normaliseSupplierName(raw);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, new Map());
    byKey.get(key)!.set(raw, n);
  }
  const keys = [...byKey.keys()];
  const existing = await tx.supplier.findMany({ where: { normalisedKey: { in: keys } }, select: { id: true, normalisedKey: true } });
  const idByKey = new Map(existing.map((s) => [s.normalisedKey, s.id]));
  const missing = keys.filter((k) => !idByKey.has(k));
  if (missing.length) {
    await tx.supplier.createMany({ data: missing.map((k) => ({ normalisedKey: k, displayName: chooseDisplayName(byKey.get(k)!) })), skipDuplicates: true });
    const created = await tx.supplier.findMany({ where: { normalisedKey: { in: missing } }, select: { id: true, normalisedKey: true } });
    for (const s of created) idByKey.set(s.normalisedKey, s.id);
  }
  for (const [key, raws] of byKey) {
    const id = idByKey.get(key)!;
    for (const [raw, n] of raws) {
      result.set(raw, id);
      await tx.supplierAlias.upsert({
        where: { rawName: raw },
        update: { occurrences: { increment: n } },
        create: { supplierId: id, rawName: raw, confidence: normaliseSupplierName(raw) === raw.toLowerCase().trim() ? "exact" : "normalised", occurrences: n },
      });
    }
  }
  return result;
}

export async function log(data: { datasetId?: string; adapter: string; stage: string; status: string; message?: string; error?: string; rowsRead?: number; rowsImported?: number; rowsRejected?: number; totalAmount?: number; checks?: unknown }) {
  return prisma.importRun.create({ data: { ...data, finishedAt: new Date(), totalAmount: data.totalAmount != null ? new Prisma.Decimal(data.totalAmount.toFixed(2)) : undefined, checks: data.checks as Prisma.InputJsonValue | undefined } });
}

export { type NormalisedTransaction };
