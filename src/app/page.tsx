import Link from "next/link";
import { getOverview, spendByYearAndAuthority, topSuppliers, listFlags } from "@/lib/queries";
import { Stat, Money, NoDataYet, Section, Kind, Caveat } from "@/components/ui";
import { TimeSeries } from "@/components/charts";
import { authorityColour, dateStr, num, gbp } from "@/lib/format";
import { SearchBox } from "@/components/search-box";

export default async function Home() {
  const o = await getOverview();
  const hasData = o.transactions > 0;
  const byYear = hasData ? await spendByYearAndAuthority() : [];
  const years = [...new Set(byYear.map((r) => r.financialYear))].sort();
  const chart = years.map((fy) => { const row: Record<string, number | string> = { fy }; for (const r of byYear.filter((x) => x.financialYear === fy)) row[r.authorityId] = r.total; return row; });
  const top = hasData ? (await topSuppliers({ limit: 8 })).rows : [];
  const flags = hasData ? (await listFlags()).slice(0, 5) : [];

  return (
    <div>
      <div className="py-6 text-center md:py-10">
        <h1 className="hero">See where public money goes</h1>
        <p className="mx-auto mt-3 max-w-xl muted">Payments, suppliers, contracts and decisions of the councils that serve Hertford, from the councils&apos; own published records. Every number links to its source.</p>
        <div className="mx-auto mt-6 max-w-2xl"><SearchBox placeholder="Search a supplier, category or question, e.g. “consultants” or “largest suppliers”" /></div>
      </div>

      {!hasData ? <NoDataYet /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Indexed expenditure" value={<Money value={o.total} compact />} sub={<><Kind kind="calc" /> sum of published payment rows</>} />
            <Stat label="Period covered" value={<span className="text-lg">{dateStr(o.minDate)} – {dateStr(o.maxDate)}</span>} sub="earliest to latest payment date" />
            <Stat label="Transactions" value={num(o.transactions)} sub={`${num(o.datasets)} source files`} />
            <Stat label="Suppliers" value={num(o.suppliers)} sub="after conservative name matching" />
            <Stat label="Authorities" value={o.authorities.filter((a) => a.transactions > 0).length} sub={o.authorities.filter((a) => a.transactions > 0).map((a) => a.shortName).join(" · ")} />
          </div>

          <Section title="Spending by financial year" right={<Link href="/money" className="text-sm">All money →</Link>}>
            <div className="card p-3">
              <TimeSeries data={chart} xKey="fy" series={o.authorities.filter((a) => a.transactions > 0).map((a) => ({ key: a.id, name: a.shortName, colour: authorityColour(a.id) }))} />
              <div className="scroll-x mt-2"><table className="tbl"><thead><tr><th>Year</th>{o.authorities.filter((a) => a.transactions > 0).map((a) => <th key={a.id} className="r">{a.shortName}</th>)}</tr></thead><tbody>
                {chart.map((r) => <tr key={String(r.fy)}><td>{String(r.fy)}</td>{o.authorities.filter((a) => a.transactions > 0).map((a) => <td key={a.id} className="r num">{gbp(r[a.id] as number | undefined)}</td>)}</tr>)}
              </tbody></table></div>
              <Caveat>Published payment files usually list only payments above a threshold (for example £500) and are not the councils&apos; full accounts. Partial years are shown as-is.</Caveat>
            </div>
          </Section>

          <div className="grid gap-6 md:grid-cols-2">
            <Section title="Largest suppliers" right={<Link href="/suppliers" className="text-sm">All suppliers →</Link>}>
              <div className="card"><table className="tbl"><tbody>
                {top.map((s, i) => <tr key={s.supplierId}><td className="faint num w-6">{i + 1}</td><td><Link href={`/suppliers/${s.supplierId}`}>{s.name}</Link></td><td className="r num"><Money value={s.total} compact /></td></tr>)}
              </tbody></table></div>
            </Section>
            <Section title="Worth a look" right={<Link href="/investigate" className="text-sm">Investigate →</Link>}>
              <div className="card">
                {flags.length === 0 ? <div className="p-4 text-sm muted">No statistical flags yet. Run <code>pipeline flags</code> after importing.</div> : (
                  <table className="tbl"><tbody>{flags.map((f) => <tr key={f.id}><td><Link href={`/investigate/${f.id}`}>{f.title}</Link><div className="text-xs faint">{f.authority.shortName} · <Kind kind="flag" /></div></td></tr>)}</tbody></table>
                )}
              </div>
              <Caveat>Flags mark statistically unusual patterns. They are not evidence of waste, fraud or wrongdoing.</Caveat>
            </Section>
          </div>

          <Section title="Authorities covered">
            <div className="grid gap-3 md:grid-cols-3">
              {o.authorities.map((a) => (
                <Link key={a.id} href={`/money?authority=${a.id}`} className="card block p-4 no-underline hover:no-underline" style={{ color: "var(--text)" }}>
                  <div className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full" style={{ background: authorityColour(a.id) }} /><span className="font-semibold">{a.name}</span></div>
                  <div className="num mt-2 text-2xl font-bold">{a.transactions ? gbp(a.total, { compact: true }) : "No data yet"}</div>
                  <div className="text-xs faint">{a.transactions ? `${num(a.transactions)} payments · ${dateStr(a.minDate)} – ${dateStr(a.maxDate)}` : `${a.tier} council`}</div>
                </Link>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
