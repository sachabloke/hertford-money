# Hertford Money

**See where public money goes.** An independent, politically neutral transparency application that takes hard-to-use council data and makes it searchable for residents of Hertford, England.

First authorities: **Hertfordshire County Council** (county), **East Herts District Council** (district), **Hertford Town Council** (town/parish). The architecture is authority-adapter based so further UK councils can be added without redesign (Hertford Money → Hertfordshire Money → Council Money UK).

> **Core principle: never invent government data.** Every number is either a published fact (linked to the council's original file, row and retrieval record) or a calculation from published facts whose method is written down. If data is unavailable the app says so. Statistical flags are never described as waste, fraud or wrongdoing.

---

## Current state (read this first)

* The application, database schema, data pipeline, three authority adapters, anomaly rules, search, supplier pages, contract and decision pages, and the "Ask" engine are built and tested.
* **The real council files have not yet been downloaded** in the environment where this was built: its outbound network only allows GitHub, npm and PyPI, and every request to `hertfordshire.gov.uk`, `eastherts.gov.uk`, `hertford.gov.uk` and `data.gov.uk` was refused by the proxy (HTTP 403 at the CONNECT step). The pipeline records that failure in its import log rather than fabricating anything. The public database is therefore empty and every page shows an honest "no data imported yet" state.
* Running `npm run pipeline -- all` on a machine that can reach the council websites performs the real import. See **Importing real data** below, including what to do if a council's column names differ from the ones the adapters expect (the import fails visibly and tells you the headers it found).

---

## Architecture

```
Council website / data.gov.uk
        │  (download, archive original + sha256 + retrieval time)
        ▼
Source adapter  (pipeline/adapters/{hcc,ehdc,htc}.ts)  — discover files, parse rows
        ▼
Normalised rows (pipeline/core/types.ts) → validate (row counts, totals, bad dates/amounts, duplicates, schema)
        ▼
PostgreSQL via Prisma (prisma/schema.prisma) — Authority, SourceDataset, ImportRun, Transaction, Supplier,
   SupplierAlias, SupplierAuthorityStat, Contract, BudgetLine, Decision, Document, PerformanceMeasure, AnomalyFlag
        ▼
Verify (database total == file total) → stats (materialised supplier-year totals) → flags (anomaly rules)
        ▼
Next.js 16 app (src/app) — Money, Transactions, Suppliers, Contracts, Decisions, Investigate, Ask, Search, Sources
        ▼
Optional AI explanation (src/app/api/ask/route.ts) — rephrases code-computed results only
```

**Code calculates, AI explains.** No LLM ever computes a total. `src/lib/queries.ts` and `src/lib/ask.ts` are deterministic SQL/TypeScript. The AI route receives the computed numbers and is instructed to restate them; its output is labelled "AI explanation" and the records are one click away.

### Stack
Next.js 16 (App Router, server components) · TypeScript · PostgreSQL 16 · Prisma 6 · Tailwind 4 · Recharts · Vitest · `csv-parse`, `xlsx`, `pdf-parse` for council files · `@anthropic-ai/sdk` (optional).

Cheap to run: one small Postgres and one Node process. Nothing is pre-rendered from the database at build time.

### Labels used everywhere in the UI
* **Published fact** – taken verbatim from a council file or page.
* **Calculated** – deterministic arithmetic on published facts (totals, shares, year-on-year).
* **Statistical flag** – a fixed rule fired; shows the exact numbers and thresholds.
* **AI summary / AI explanation** – model-written prose, grounded in the above, clearly marked.
* The council's stated reasons for a decision are always labelled "stated by the council".

---

## Setup

```bash
cd hertford-money
npm install                                   # also runs `prisma generate`
cp .env.example .env                          # set DATABASE_URL (and TEST_DATABASE_URL for tests)
npx prisma migrate deploy                     # create tables
npm run dev                                   # http://localhost:3000
```

Postgres locally, if you need one:

```bash
sudo -u postgres psql -c "CREATE USER hertford WITH PASSWORD 'hertford' CREATEDB;" \
  -c "CREATE DATABASE hertford_money OWNER hertford;" -c "CREATE DATABASE hertford_money_test OWNER hertford;"
```

Optional: set `ANTHROPIC_API_KEY` in `.env` to enable the "Explain in plain English" button on Ask. Without it the button reports that AI explanations are off; nothing else changes. `HM_AI_MODEL` overrides the model id.

---

## Data sources

| Authority | What | Where | Format | Licence (as stated by the council) |
|---|---|---|---|---|
| Hertfordshire County Council | Supplier payments over £500, monthly | [What we spend and how we spend it](https://www.hertfordshire.gov.uk/about-the-council/freedom-of-information-and-council-data/open-data-statistics-about-hertfordshire/what-we-spend-and-how-we-spend-it/what-we-spend-and-how-we-spend-it.aspx) | CSV | Open Government Licence v3.0 |
| Hertfordshire County Council | Contracts over £5,000, quarterly | same page; also the [Contract Register](https://www.hertfordshire.gov.uk/ContractRegister/) | CSV | OGL v3.0 |
| Hertfordshire County Council | Integrated Plan (budget/MTFS), decisions, committee papers | [Integrated Plan](https://www.hertfordshire.gov.uk/about-the-council/freedom-of-information-and-council-data/open-data-statistics-about-hertfordshire/what-we-spend-and-how-we-spend-it/integrated-plan/integrated-plan.aspx), [democracy.hertfordshire.gov.uk](https://democracy.hertfordshire.gov.uk/) | PDF / HTML | as stated |
| East Herts District Council | Council spending reports, weekly | [Council Spending Reports 2025](https://www.eastherts.gov.uk/council-spending-reports-2025) (and earlier years) | CSV/XLSX/PDF (per file) | Local Government Transparency Code 2015 |
| East Herts District Council | Contract register | [Contract Register](https://www.eastherts.gov.uk/about-east-herts-0/contract-register) | as published | as stated |
| East Herts District Council | Accounts, budgets, decisions | [Statement of accounts](https://www.eastherts.gov.uk/about-east-herts-0/statement-accounts-budgets-and-annual-audit), [democracy.eastherts.gov.uk](https://democracy.eastherts.gov.uk/) | PDF / HTML | as stated |
| Hertford Town Council | Payments over £100/£500, monthly | [hertford.gov.uk](https://www.hertford.gov.uk/) (PDFs under `/uploads/cms/pagedocument/…`) | PDF (Sage-style list: Date, N/C, Ref, Details, Net) | Transparency Code for Smaller Authorities |
| (historic) | HCC payments 2010–2016 | [data.gov.uk](https://www.data.gov.uk/dataset/897093bd-355b-4977-9092-f27810baa5a7/payments-to-suppliers-with-a-value-over-500-from-hertfordshire-county-council) | XLS | OGL |

Every imported file is stored untouched in `data/archive/<adapter>/` with a `.meta.json` (URL, retrieval time, SHA-256) and recorded as a `SourceDataset` row. The Sources page in the app lists every file with its retrieval date and the verified total.

---

## Import commands

```bash
npm run pipeline -- authorities                 # registers the three councils
npm run pipeline -- discover hcc                # lists the files currently on the council page (no download)
npm run pipeline -- import hcc                  # download → archive → validate → import → verify, every file
npm run pipeline -- import hcc --kind contracts # just the contract-register CSVs
npm run pipeline -- import ehdc --limit 12      # the 12 most recent weekly reports
npm run pipeline -- import htc
npm run pipeline -- decisions ehdc --limit 30   # decisions + report PDFs from the ModernGov site
npm run pipeline -- stats                       # rebuild supplier-year totals (run after any import)
npm run pipeline -- flags                       # recompute anomaly flags
npm run pipeline -- status                      # what is in the database + recent runs
npm run pipeline -- all                         # everything above for every authority
```

Re-running is safe: a file whose SHA-256 is unchanged is skipped; a changed file at the same URL replaces its previous rows; every run is logged (`ImportRun`) and shown on the Sources page.

### Importing real data when this machine cannot reach the councils
If the websites are blocked, download the file in a browser and import it by hand. **The original URL is still required** so that evidence links point at the council:

```bash
npm run pipeline -- import-file hcc \
  --file ~/Downloads/supplier-payments-july-2026.csv \
  --url "https://www.hertfordshire.gov.uk/media-library/.../supplier-payments-july-2026.csv" \
  --title "Supplier payments over £500 — July 2026" --period-start 2026-07-01 --period-end 2026-07-31
npm run pipeline -- stats && npm run pipeline -- flags
```

### If a council changes its column names
The import fails and prints the headers it found, e.g. `Required columns not found: amount. Headers in file: [...]`. Add the new spelling to `TRANSACTION_HEADER_CANDIDATES` in `pipeline/core/parse.ts` (shared) or to the adapter's `headerOverrides`, re-run. Nothing is imported until the mapping is explicit.

---

## Methodology (summary; the full text is on the app's Sources page)

* **Validation per file:** row count, total amount, malformed dates, malformed amounts, duplicate-looking rows, missing supplier/date/amount, dates outside the stated period, unexpected columns. More than 2% unreadable rows → the file is rejected. After import the database total for the file must equal the file total or the run is marked failed.
* **Supplier normalisation (conservative):** case, punctuation, whitespace, accents, `Ltd`/`Limited`, `PLC`, `LLP`, `CIC`, `&`/`and`, leading/trailing `The`. Nothing else. `ACME PLC`, `ACME HOLDINGS LTD` and plain `ACME` stay separate from `ACME LTD`. Original spellings are kept and shown with a confidence (`exact`/`normalised`; `manual` reserved for human-confirmed merges). Redacted names are shown as published.
* **Financial year:** 1 April – 31 March.
* **Anomaly rules** (`pipeline/core/flags.ts`, thresholds scale by council tier): rapid supplier increase (≥100% vs previous average, like-for-like months for an incomplete year), new large supplier, supplier concentration (>15% of a year), duplicate-looking payments, category year-on-year change (≥50%), budget vs actual (≥10%), contract value vs payments (>150%). Each flag stores the numbers used and its reason text.
* **Ask:** a fixed set of intents (largest suppliers, where money goes, spend on X, fastest increases, contracts awarded, unusual spending, decisions this month, what X is paid for, why spending on X changed) mapped to database queries; unmatched questions fall back to text search. Answers are structured as Answer / Numbers / Why / Evidence / Sources and say when evidence is insufficient.
* **Comparability:** category labels are each council's own; councils have different responsibilities and populations; payment files are not accounts. The app states these limits rather than ranking councils.

---

## Tests

```bash
npm test          # unit tests (parsing, normalisation, validation, link/period extraction, decision sections)
                  # + end-to-end import against TEST_DATABASE_URL using a labelled synthetic fixture
npm run typecheck
npm run lint
npm run build
```

The synthetic fixture (`tests/fixtures/`) is never imported into the public database; the e2e test marks it `isFixture = true`, and all public queries exclude fixtures.

---

## Project layout

```
hertford-money/
  prisma/schema.prisma        data model + migrations
  pipeline/cli.ts             command-line pipeline
  pipeline/core/              fetch/archive, table+PDF readers, parsing, validation, import, stats, flags, decisions
  pipeline/adapters/          hcc.ts, ehdc.ts, htc.ts (+ index.ts registry)  ← add a council here
  src/app/                    pages (money, transactions, suppliers, contracts, decisions, investigate, ask, search, sources)
  src/lib/queries.ts          every number the UI shows
  src/lib/ask.ts              question → deterministic query
  src/components/             nav, charts (Recharts), UI primitives, AI-explain button
  data/archive/               untouched originals (git-ignored)
  tests/                      vitest
```

### Adding another council
1. Create `pipeline/adapters/<id>.ts` implementing `Adapter` (`discover()`, `parseTransactions()`, optionally `parseContracts()`), reusing `readTable`/`tableToTransactions` or `parsePaymentListPdf`.
2. Register it in `pipeline/adapters/index.ts`. Add its colour to `AUTHORITY_COLOUR` in `src/lib/format.ts` if you want a fixed chart colour.
3. `npm run pipeline -- import <id>`. No UI change is needed.

---

## Current limitations

* No real data has been imported yet in the build environment (network policy); see **Current state**.
* Column names in the councils' current files could not be inspected from the build environment. The adapters use a broad, documented list of candidate header names and fail visibly if none match.
* East Herts weekly reports and Hertford Town Council lists may be PDF; the PDF parser handles text-layer "date … amount" lists and refuses scanned PDFs.
* Hertford Town Council has no ModernGov system; its minutes/agendas are PDFs on its website and are not yet imported as decisions.
* Budget and performance tables (`BudgetLine`, `PerformanceMeasure`) have schema, flag rules and UI hooks but no importer yet: council budget books are PDFs with varying tables and need a per-document extractor.
* Payments cannot be reconciled to specific contracts from published data; the contract page shows payments to the supplier in the contract period with that caveat.
* Supplier matching is deliberately conservative, so one organisation may appear under more than one name.

## Next development priorities

1. Run the real imports (all three councils, all available months/years) on a machine with web access; inspect validation reports; adjust header mappings if any file is refused.
2. Compare each financial year's total with the councils' published outturn/accounts figures and record the comparison on the Sources page.
3. Budget importer for the HCC Integrated Plan and EHDC budget/outturn reports (budget vs actual flags are already wired).
4. Decisions: run the ModernGov importer for HCC and EHDC; add a PDF-minutes importer for Hertford Town Council.
5. Performance measures (e.g. adult social care volumes from published performance reports) to enable cost-per-case views with inflation adjustment (ONS CPI) and explicit comparability notes.
6. Manual supplier-merge tool (writes `SupplierAlias.confidence = "manual"` with a reason), plus Companies House number lookup where councils publish it.
7. Deployment: a small VPS or managed Postgres + Node host; nightly `pipeline all` on a schedule; caching of heavy aggregates.
