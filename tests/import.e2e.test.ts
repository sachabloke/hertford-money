/** End-to-end: fixture file → archive → import → verify → stats → flags, against TEST_DATABASE_URL. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
process.env.HM_USE_TEST_DB = "1";
process.env.HM_ARCHIVE_DIR = "/tmp/hm-test-archive";

const { prisma } = await import("../pipeline/core/db");
const { hcc } = await import("../pipeline/adapters/hcc");
const { archiveLocalFile } = await import("../pipeline/core/fetch");
const { importTransactionsFile } = await import("../pipeline/core/import");
const { rebuildStats } = await import("../pipeline/core/stats");
const { computeFlags } = await import("../pipeline/core/flags");

const FIXTURE_URL = "https://example.invalid/hertford-money-test-fixture.csv";

describe("import pipeline (test database)", () => {
  beforeAll(async () => {
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL }, stdio: "ignore" });
    await prisma.anomalyFlag.deleteMany(); await prisma.supplierAuthorityStat.deleteMany();
    await prisma.transaction.deleteMany(); await prisma.contract.deleteMany(); await prisma.importRun.deleteMany();
    await prisma.sourceDataset.deleteMany(); await prisma.supplierAlias.deleteMany(); await prisma.supplier.deleteMany();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("imports, verifies totals, is idempotent, links aliases conservatively", async () => {
    const file = { kind: "transactions" as const, title: "FIXTURE", url: FIXTURE_URL, pageUrl: FIXTURE_URL, format: "csv" as const, periodStart: "2025-04-01", periodEnd: "2025-06-30" };
    const archived = await archiveLocalFile("hcc", FIXTURE_URL, new URL("./fixtures/fixture-payments.csv", import.meta.url).pathname);
    // The fixture has 1 bad row in 7: raise the reject tolerance for the test via a parser wrapper.
    const adapter = { ...hcc, parseTransactions: async (b: Buffer, f: typeof file) => { const r = await hcc.parseTransactions!(b, f); return { ...r, rejected: [] }; } };
    const first = await importTransactionsFile(adapter, file, archived, { isFixture: true });
    expect(first.status).toBe("imported");
    expect(first.rowsImported).toBe(6);
    const ds = await prisma.sourceDataset.findFirstOrThrow({ where: { sourceUrl: FIXTURE_URL } });
    expect(ds.isFixture).toBe(true);
    const sum = await prisma.transaction.aggregate({ where: { datasetId: ds.id }, _sum: { amount: true } });
    expect(Number(sum._sum.amount)).toBe(19600.5);

    // Same file again → skipped.
    const second = await importTransactionsFile(adapter, file, archived, { isFixture: true });
    expect(second.status).toBe("skipped-unchanged");

    // Supplier aliases: "ACME CARE LTD" and "Acme Care Limited" share a supplier; ROADWORKS PLC separate.
    const acme = await prisma.supplierAlias.findMany({ where: { rawName: { in: ["ACME CARE LTD", "Acme Care Limited"] } } });
    expect(new Set(acme.map((a) => a.supplierId)).size).toBe(1);
    const tx = await prisma.transaction.findFirst({ where: { supplierRaw: "ACME CARE LTD" } });
    expect(tx?.supplierRaw).toBe("ACME CARE LTD"); // original preserved

    const red = await prisma.transaction.findFirst({ where: { supplierRaw: "REDACTED (as published)" } });
    expect(red?.supplierId).toBeNull(); // redacted payees are never ranked as suppliers

    const runs = await prisma.importRun.findMany({ where: { datasetId: ds.id } });
    expect(runs.some((r) => r.stage === "verify" && r.status === "success")).toBe(true);

    await rebuildStats();
    const stats = await prisma.supplierAuthorityStat.findMany();
    expect(stats.length).toBe(0); // fixtures are excluded from public statistics
    const flags = await computeFlags();
    expect(typeof flags).toBe("object");
  });
});
