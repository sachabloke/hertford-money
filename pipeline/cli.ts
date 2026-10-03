#!/usr/bin/env tsx
/**
 * Hertford Money data pipeline.
 *
 *   npm run pipeline -- authorities
 *   npm run pipeline -- discover hcc
 *   npm run pipeline -- import hcc [--kind transactions|contracts] [--limit 3] [--force]
 *   npm run pipeline -- import-file hcc --file data/raw/x.csv --url <original url> --title "…" [--period-start 2026-07-01 --period-end 2026-07-31]
 *   npm run pipeline -- stats
 *   npm run pipeline -- flags
 *   npm run pipeline -- status
 *   npm run pipeline -- all
 */
import { Command } from "commander";
import { ADAPTERS, getAdapter } from "./adapters";
import { prisma } from "./core/db";
import { downloadAndArchive, archiveLocalFile, DownloadError } from "./core/fetch";
import { ensureAuthority, importContractsFile, importTransactionsFile, log } from "./core/import";
import { rebuildStats } from "./core/stats";
import { computeFlags } from "./core/flags";
import type { DiscoveredFile } from "./core/types";
import { importDecisions } from "./core/decisions";

const program = new Command().name("pipeline").description("Hertford Money data pipeline");

program.command("authorities").description("List authority adapters").action(async () => {
  for (const a of Object.values(ADAPTERS)) { await ensureAuthority(a); console.log(`${a.id.padEnd(6)} ${a.authority.name} (${a.authority.tier})`); }
  await prisma.$disconnect();
});

program.command("discover <adapter>").option("--json").description("List files currently published by the council").action(async (id: string, o: { json?: boolean }) => {
  const adapter = getAdapter(id);
  try {
    const files = await adapter.discover();
    if (o.json) console.log(JSON.stringify(files, null, 2));
    else for (const f of files) console.log(`${f.kind.padEnd(12)} ${f.format.padEnd(4)} ${(f.periodStart ?? "").padEnd(10)} ${f.title}\n             ${f.url}`);
    console.log(`\n${files.length} files`);
  } catch (e) { explainNetwork(e as Error); process.exitCode = 1; }
  await prisma.$disconnect();
});

program.command("import <adapter>").description("Discover, download, archive, validate and import").option("--kind <kind>", "transactions|contracts").option("--limit <n>", "only the N most recent files").option("--force", "re-import even if unchanged").option("--since <yyyy-mm>", "only files whose period starts on/after this month").action(async (id: string, o: { kind?: string; limit?: string; force?: boolean; since?: string }) => {
  const adapter = getAdapter(id);
  let files: DiscoveredFile[];
  try { files = await adapter.discover(); } catch (e) { explainNetwork(e as Error); await log({ adapter: id, stage: "download", status: "failed", error: (e as Error).message }); process.exitCode = 1; await prisma.$disconnect(); return; }
  if (o.kind) files = files.filter((f) => f.kind === o.kind);
  if (o.since) files = files.filter((f) => !f.periodStart || f.periodStart.slice(0, 7) >= o.since!);
  files.sort((a, b) => (b.periodStart ?? "").localeCompare(a.periodStart ?? ""));
  if (o.limit) files = files.slice(0, parseInt(o.limit, 10));
  console.log(`${files.length} files to process for ${adapter.authority.name}`);
  let ok = 0, failed = 0;
  for (const f of files) {
    process.stdout.write(`• ${f.title} … `);
    try {
      const archived = await downloadAndArchive(adapter.id, f.url);
      const outcome = f.kind === "contracts" ? await importContractsFile(adapter, f, archived, { force: o.force }) : await importTransactionsFile(adapter, f, archived, { force: o.force });
      console.log(`${outcome.status}: ${outcome.message}`);
      if (outcome.status === "failed") failed++; else ok++;
    } catch (e) {
      failed++;
      console.log(`FAILED: ${(e as Error).message}`);
      await log({ adapter: id, stage: "download", status: "failed", message: f.url, error: (e as Error).message });
      if (e instanceof DownloadError) explainNetwork(e);
    }
  }
  console.log(`\n${ok} succeeded/unchanged, ${failed} failed. Run "stats" then "flags" to refresh derived data.`);
  if (failed) process.exitCode = 1;
  await prisma.$disconnect();
});

program.command("import-file <adapter>").description("Import a file obtained outside the pipeline (e.g. downloaded by hand). The original URL is still required for evidence links.")
  .requiredOption("--file <path>").requiredOption("--url <url>", "the council's original URL for this file").option("--title <title>").option("--kind <kind>", "transactions|contracts", "transactions")
  .option("--page-url <url>").option("--published <yyyy-mm-dd>").option("--period-start <yyyy-mm-dd>").option("--period-end <yyyy-mm-dd>").option("--format <fmt>", "csv|xlsx|xls|pdf").option("--force").option("--fixture", "mark as a TEST FIXTURE (never shown publicly)")
  .action(async (id: string, o: Record<string, string | boolean | undefined>) => {
    const adapter = getAdapter(id);
    const url = String(o.url);
    const format = (o.format as DiscoveredFile["format"]) ?? (String(o.file).toLowerCase().endsWith(".pdf") ? "pdf" : String(o.file).toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv");
    const f: DiscoveredFile = { kind: (o.kind as DiscoveredFile["kind"]) ?? "transactions", title: (o.title as string) ?? url.split("/").pop() ?? url, url, pageUrl: (o.pageUrl as string) ?? url, format, publishedAt: o.published as string | undefined, periodStart: o.periodStart as string | undefined, periodEnd: o.periodEnd as string | undefined };
    const archived = await archiveLocalFile(adapter.id, url, String(o.file));
    const outcome = f.kind === "contracts" ? await importContractsFile(adapter, f, archived, { force: !!o.force, isFixture: !!o.fixture }) : await importTransactionsFile(adapter, f, archived, { force: !!o.force, isFixture: !!o.fixture });
    console.log(`${outcome.status}: ${outcome.message}`);
    if (outcome.report) console.log(JSON.stringify({ headers: outcome.report.headerMap, total: outcome.report.totalAmount, rows: outcome.report.rowsParsed, rejected: outcome.report.rowsRejected, warnings: outcome.report.warnings }, null, 2));
    if (outcome.status === "failed") process.exitCode = 1;
    await prisma.$disconnect();
  });

program.command("decisions <adapter>").description("Import council decisions and their report documents from the council's ModernGov site").option("--url <listing>", "decisions listing page (defaults per council)").option("--limit <n>", "max decisions", "50").action(async (id: string, o: { url?: string; limit?: string }) => {
  const adapter = getAdapter(id); await ensureAuthority(adapter);
  try { const r = await importDecisions(id, { listingUrl: o.url, limit: parseInt(o.limit ?? "50", 10) }); console.log(r); if (!r.imported) process.exitCode = 1; }
  catch (e) { explainNetwork(e as Error); await log({ adapter: id, stage: "download", status: "failed", error: (e as Error).message }); process.exitCode = 1; }
  await prisma.$disconnect();
});

program.command("stats").description("Rebuild supplier statistics").action(async () => {
  const r = await rebuildStats();
  await log({ adapter: "all", stage: "publish", status: "success", message: `stats rebuilt: ${r.rows} supplier-year rows, ${r.suppliers} suppliers` });
  console.log(r); await prisma.$disconnect();
});

program.command("flags").description("Recompute anomaly flags").action(async () => {
  const counts = await computeFlags();
  await log({ adapter: "all", stage: "flags", status: "success", message: JSON.stringify(counts) });
  console.log(counts); await prisma.$disconnect();
});

program.command("status").description("Show what is in the database").action(async () => {
  for (const a of await prisma.authority.findMany()) {
    const t = await prisma.transaction.aggregate({ where: { authorityId: a.id }, _count: true, _sum: { amount: true }, _min: { date: true }, _max: { date: true } });
    const c = await prisma.contract.count({ where: { authorityId: a.id } });
    const d = await prisma.sourceDataset.count({ where: { authorityId: a.id } });
    console.log(`${a.name}: ${d} datasets, ${t._count} transactions £${Number(t._sum.amount ?? 0).toLocaleString("en-GB")} (${t._min.date?.toISOString().slice(0, 10) ?? "-"} → ${t._max.date?.toISOString().slice(0, 10) ?? "-"}), ${c} contracts`);
  }
  const runs = await prisma.importRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 });
  console.log("\nRecent runs:");
  for (const r of runs) console.log(`  ${r.startedAt.toISOString()} ${r.adapter.padEnd(5)} ${r.stage.padEnd(8)} ${r.status.padEnd(8)} ${r.message ?? r.error ?? ""}`);
  await prisma.$disconnect();
});

program.command("all").description("Import everything for every authority, then stats and flags").option("--limit <n>").action(async (o: { limit?: string }) => {
  for (const id of Object.keys(ADAPTERS)) {
    const args = ["import", id, ...(o.limit ? ["--limit", o.limit] : [])];
    await program.parseAsync(args, { from: "user" });
  }
  await program.parseAsync(["stats"], { from: "user" });
  await program.parseAsync(["flags"], { from: "user" });
});

function explainNetwork(e: Error) {
  console.error(`\n${e.name}: ${e.message}`);
  if (/CONNECT|403|ECONNREFUSED|ENOTFOUND|fetch failed|Network error/i.test(e.message)) {
    console.error("This looks like a network restriction. The council's website must be reachable from this machine. " +
      "Alternatively download the file in a browser and run:  pipeline import-file <adapter> --file <path> --url <original url>");
  }
}

program.parseAsync(process.argv);
