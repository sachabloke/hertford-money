import Link from "next/link";
import { listDatasets, listImportRuns, listAuthorities } from "@/lib/queries";
import { Section, Kind } from "@/components/ui";
import { METHODOLOGY } from "../../../pipeline/core/flags";
import { dateStr, gbp, num } from "@/lib/format";

export const metadata = { title: "Sources & methodology" };

const SOURCE_PAGES = [
  { authority: "Hertfordshire County Council", items: [
    ["Supplier payments over £500 (monthly CSV) and contracts over £5,000 (quarterly CSV)", "https://www.hertfordshire.gov.uk/about-the-council/freedom-of-information-and-council-data/open-data-statistics-about-hertfordshire/what-we-spend-and-how-we-spend-it/what-we-spend-and-how-we-spend-it.aspx"],
    ["Contract register", "https://www.hertfordshire.gov.uk/ContractRegister/"],
    ["Integrated Plan (budget and medium-term financial strategy)", "https://www.hertfordshire.gov.uk/about-the-council/freedom-of-information-and-council-data/open-data-statistics-about-hertfordshire/what-we-spend-and-how-we-spend-it/integrated-plan/integrated-plan.aspx"],
    ["Decisions and committee papers (ModernGov)", "https://democracy.hertfordshire.gov.uk/"],
    ["data.gov.uk record", "https://www.data.gov.uk/dataset/897093bd-355b-4977-9092-f27810baa5a7/payments-to-suppliers-with-a-value-over-500-from-hertfordshire-county-council"],
  ] },
  { authority: "East Herts District Council", items: [
    ["Council spending reports (weekly, by year)", "https://www.eastherts.gov.uk/council-spending-reports-2025"],
    ["Contract register", "https://www.eastherts.gov.uk/about-east-herts-0/contract-register"],
    ["Statement of accounts, budgets and annual audit", "https://www.eastherts.gov.uk/about-east-herts-0/statement-accounts-budgets-and-annual-audit"],
    ["Local Government Transparency Code page", "https://www.eastherts.gov.uk/about-east-herts-0/information-requests/local-government-transparency-code"],
    ["Decisions and committee papers (ModernGov)", "https://democracy.eastherts.gov.uk/"],
  ] },
  { authority: "Hertford Town Council", items: [
    ["Payments lists (PDF, monthly) and precept/budget notices", "https://www.hertford.gov.uk/"],
  ] },
];

export default async function SourcesPage() {
  const [datasets, runs, authorities] = await Promise.all([listDatasets(), listImportRuns(40), listAuthorities()]);
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Sources &amp; methodology</h1>
      <p className="muted text-sm">Where every number comes from, when it was downloaded, how it was transformed, and what it cannot tell you.</p>

      <Section title="Where the data comes from" id="sources">
        {SOURCE_PAGES.map((s) => <div key={s.authority} className="card mb-3 p-4 text-sm"><div className="font-semibold">{s.authority}</div><ul className="mt-1 space-y-1">{s.items.map(([t, u]) => <li key={u}>{t}: <a href={u} target="_blank" rel="noopener noreferrer" className="break-all">{u}</a></li>)}</ul></div>)}
        <p className="text-sm muted">Hertfordshire County Council states that its open data sets are released under the <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/">Open Government Licence v3.0</a>. East Herts and Hertford Town Council publish under the Local Government Transparency Code 2015 / Transparency Code for Smaller Authorities; licence terms are those stated on their pages. Contains public sector information licensed under the Open Government Licence v3.0 where applicable.</p>
      </Section>

      <Section title="Files imported" id="datasets">
        <div className="card scroll-x"><table className="tbl"><thead><tr><th>Authority</th><th>File</th><th>Period</th><th className="r">Rows</th><th className="r">Total</th><th>Retrieved</th></tr></thead><tbody>
          {datasets.length === 0 && <tr><td colSpan={6} className="p-4 muted">Nothing imported yet. See the README for the import commands.</td></tr>}
          {datasets.map((d) => { const verify = d.importRuns.find((r) => r.stage === "verify"); return (
            <tr key={d.id}><td>{d.authority.shortName}</td><td><a href={d.sourceUrl} target="_blank" rel="noopener noreferrer">{d.title}</a><div className="text-xs faint">{d.format} · sha256 {d.sha256.slice(0, 12)}… · {d.licence ?? "licence as stated on source page"}</div></td><td className="whitespace-nowrap text-xs">{dateStr(d.periodStart)} – {dateStr(d.periodEnd)}</td><td className="r num">{num(d._count.transactions || d._count.contracts)}</td><td className="r num">{verify?.totalAmount != null ? gbp(Number(verify.totalAmount)) : "—"}</td><td className="whitespace-nowrap text-xs">{dateStr(d.retrievedAt)}</td></tr>); })}
        </tbody></table></div>
      </Section>

      <Section title="How data is transformed" id="pipeline">
        <div className="card p-4 text-sm space-y-2">
          <p><strong>Pipeline:</strong> download → archive the untouched original (with its URL, time and SHA-256 hash) → validate → normalise → import → verify that the database total equals the file total → publish. Every step is logged below. If a council changes its file layout, the import fails loudly rather than guessing.</p>
          <p><strong>Validation per file:</strong> row count, total amount, malformed dates, malformed amounts, duplicate-looking rows, missing supplier/date/amount, rows outside the file&apos;s stated period, and a check that required columns exist. Files with more than 2% unreadable rows are rejected.</p>
          <p><strong>What is not changed:</strong> supplier names, amounts, dates, categories and descriptions are stored exactly as published. Credit notes (negative amounts) are kept and included in totals, as the council published them.</p>
          <p><strong>Financial years</strong> run 1 April to 31 March, as for all English councils.</p>
        </div>
      </Section>

      <Section title="Supplier name matching" id="suppliers">
        <div className="card p-4 text-sm space-y-2">
          <p>Councils spell the same supplier many ways. Hertford Money groups spellings only when they differ trivially: letter case, punctuation, extra spaces, accents, and “Ltd” vs “Limited”, “PLC” vs “Public Limited Company”, “&amp;” vs “and”. “ACME LTD”, “Acme Limited” and “ACME LTD.” become one supplier. “ACME PLC”, “ACME HOLDINGS LTD” or plain “ACME” are kept separate because they may be different organisations. No fuzzy matching is used. Every original spelling is kept and shown on the supplier page with its confidence (“exact” or “normalised”).</p>
          <p>Names the council has redacted (for example “REDACTED” or “Name withheld”) are shown as published and never linked to a person. Payees that are not an organisation, such as numeric-only beneficiary IDs (used for individuals receiving direct payments) and payroll, PAYE or pension lines, keep their published text and count in every total, but are not ranked or flagged as suppliers.</p>
        </div>
      </Section>

      <Section title="Anomaly flags" id="anomalies">
        <div className="card p-4 text-sm space-y-2">
          <p><Kind kind="flag" /> Flags are produced by fixed rules applied to the published numbers. Thresholds scale with the size of the authority (county, district, town). A flag says a pattern is unusual under its rule, never that anything is wrong. The rules:</p>
          <ul className="list-disc space-y-1 pl-5">{Object.entries(METHODOLOGY).map(([k, v]) => <li key={k}><strong>{k.replace(/_/g, " ")}:</strong> {v}</li>)}</ul>
        </div>
      </Section>

      <Section title="Limitations" id="limitations">
        <div className="card p-4 text-sm"><ul className="list-disc space-y-1 pl-5">
          <li>Payment files list individual payments above a threshold (typically £500; £100 for the town council). They are not the full accounts and will not add up to a council&apos;s budget.</li>
          <li>Payments to a supplier cannot be tied to a specific contract from the published data.</li>
          <li>Category and department labels are the councils&apos; own and change over time; they are not comparable across councils.</li>
          <li>Whether amounts are net or gross of VAT is stated only when the council states it.</li>
          <li>Comparisons between councils must allow for population, the services each tier is responsible for, inflation and local need. Hertford Money shows the raw figures and these caveats; it does not rank councils.</li>
          <li>AI explanations, where enabled, only restate numbers computed by code and cite the records used. They can still misread; the records are one click away.</li>
        </ul></div>
      </Section>

      <Section title="Corrections" id="corrections">
        <div className="card p-4 text-sm">If a figure differs from a council&apos;s own publication, the council&apos;s publication wins. Please report it with the page link and the original file; corrections are made by re-running the import from the original file and recorded in the import log below, never by hand-editing the database.</div>
      </Section>

      <Section title="Import log" id="log">
        <div className="card scroll-x"><table className="tbl"><thead><tr><th>When (UTC)</th><th>Adapter</th><th>Stage</th><th>Status</th><th>Detail</th></tr></thead><tbody>
          {runs.length === 0 && <tr><td colSpan={5} className="p-4 muted">No runs yet.</td></tr>}
          {runs.map((r) => <tr key={r.id}><td className="whitespace-nowrap text-xs">{r.startedAt.toISOString().replace("T", " ").slice(0, 16)}</td><td>{authorities.find((a) => a.id === r.adapter)?.shortName ?? r.adapter}</td><td>{r.stage}</td><td style={{ color: r.status === "failed" ? "var(--serious)" : r.status === "success" ? "var(--good)" : undefined }}>{r.status}</td><td className="text-xs">{r.dataset?.title ? <div>{r.dataset.title}</div> : null}{r.message}{r.error && <div style={{ color: "var(--serious)" }}>{r.error}</div>}</td></tr>)}
        </tbody></table></div>
      </Section>
      <p className="mt-6 text-xs faint">Hertford Money is independent and politically neutral. It is not affiliated with any council. <Link href="/">Home</Link></p>
    </div>
  );
}
