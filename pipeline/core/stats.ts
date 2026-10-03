/** Rebuild materialised supplier statistics and display names. Deterministic SQL; no AI. */
import { prisma } from "./db";
import { Prisma } from "@prisma/client";

export async function rebuildStats(): Promise<{ suppliers: number; rows: number }> {
  const rows = await prisma.$queryRaw<Array<{ supplierId: string; authorityId: string; financialYear: string; total: Prisma.Decimal; count: bigint }>>`
    SELECT t."supplierId", t."authorityId", t."financialYear", SUM(t.amount) AS total, COUNT(*) AS count
    FROM "Transaction" t JOIN "SourceDataset" d ON d.id = t."datasetId"
    WHERE t."supplierId" IS NOT NULL AND d."isFixture" = false
    GROUP BY t."supplierId", t."authorityId", t."financialYear"`;
  await prisma.$transaction(async (tx) => {
    await tx.supplierAuthorityStat.deleteMany();
    for (let i = 0; i < rows.length; i += 2000) {
      await tx.supplierAuthorityStat.createMany({ data: rows.slice(i, i + 2000).map((r) => ({ supplierId: r.supplierId, authorityId: r.authorityId, financialYear: r.financialYear, total: r.total, count: Number(r.count) })) });
    }
  }, { timeout: 120_000 });
  // Display name = most frequent raw spelling.
  const aliases = await prisma.supplierAlias.findMany({ orderBy: [{ supplierId: "asc" }, { occurrences: "desc" }, { rawName: "asc" }], select: { supplierId: true, rawName: true } });
  const seen = new Set<string>();
  let suppliers = 0;
  for (const a of aliases) {
    if (seen.has(a.supplierId)) continue;
    seen.add(a.supplierId);
    await prisma.supplier.update({ where: { id: a.supplierId }, data: { displayName: a.rawName } });
    suppliers++;
  }
  return { suppliers, rows: rows.length };
}
