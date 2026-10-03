import Link from "next/link";
import { getOverview, listAuthorities, listFinancialYears, spendByCategory, spendByMonth, spendByYearAndAuthority } from "@/lib/queries";
import { Section, Stat, Money, NoDataYet, Caveat, Kind, qs } from "@/components/ui";
import { HBars, TimeSeries } from "@/components/charts";
import { authorityColour, gbp, monthLabel, num } from "@/lib/format";

export const metadata = { title: "Money" };

export default async function MoneyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const authorityId = sp.authority || undefined;
  const fy = sp.fy || undefined;
  const field = (sp.by === "department" || sp.by === "serviceArea" ? sp.by : "category") as "category" | "department" | "serviceArea";
  const [o, authorities, years] = await Promise.all([getOverview(), listAuthorities(), listFinancialYears(authorityId)]);
  if (o.transactions === 0) return <div><h1 className="text-2xl font-bold">Money</h1><div className="mt-4"><NoDataYet /></div></div>;
  const [months, byYear, cats] = await Promise.all([spendByMonth(authorityId), spendByYearAndAuthority(), spendByCategory({ authorityId, financialYear: fy, field, limit: 20 })]);
  const shown = authorities.filter((a) => (authorityId ? a.id === authorityId : true) && byYear.some((r) => r.authorityId === a.id));
  const sel = o.authorities.filter((a) => !authorityId || a.id === authorityId);
  const total = sel.reduce((s, a) => s + a.total, 0);
  const monthData: Array<Record<string, number | string>> = months.map((m) => ({ ...m, label: monthLabel(m.month) }));
  const yearRows = [...new Set(byYear.map((r) => r.financialYear))].sort().map((y) => ({ fy: y, ...Object.fromEntries(byYear.filter((r) => r.financialYear === y && (!authorityId || r.authorityId === authorityId)).map((r) => [r.authorityId, r.total])) }));

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Money</h1>
      <form className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <select name="authority" className="input" defaultValue={authorityId ?? ""}><option value="">All authorities</option>{authorities.map((a) => <option key={a.id} value={a.id}>{a.shortName}</option>)}</select>
        <select name="fy" className="input" defaultValue={fy ?? ""}><option value="">All years (category table)</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <select name="by" className="input" defaultValue={field}><option value="category">By category</option><option value="department">By department</option><option value="serviceArea">By service area</option></select>
        <button className="btn btn-primary" type="submit">Apply</button>
      </form>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Indexed expenditure" value={<Money value={total} compact />} sub={<Kind kind="calc" />} />
        <Stat label="Payments" value={num(sel.reduce((s, a) => s + a.transactions, 0))} />
        <Stat label="Source files" value={num(sel.reduce((s, a) => s + a.datasets, 0))} />
        <Stat label="Years" value={years.length} sub={years.length ? `${years[years.length - 1]} – ${years[0]}` : ""} />
      </div>

      <Section title="Spending by month">
        <div className="card p-3">
          <TimeSeries data={monthData} xKey="label" series={shown.map((a) => ({ key: a.id, name: a.shortName, colour: authorityColour(a.id) }))} />
          <details className="mt-2 text-sm"><summary className="cursor-pointer muted">Table</summary><div className="scroll-x"><table className="tbl"><thead><tr><th>Month</th>{shown.map((a) => <th key={a.id} className="r">{a.shortName}</th>)}</tr></thead><tbody>{monthData.map((m) => <tr key={String(m.month)}><td>{String(m.label)}</td>{shown.map((a) => <td key={a.id} className="r num">{gbp(m[a.id] as number | undefined)}</td>)}</tr>)}</tbody></table></div></details>
          <Caveat>Monthly totals follow the payment date in the published file. A month with a dip may simply be a file the council has not yet published.</Caveat>
        </div>
      </Section>

      <Section title="Spending by financial year">
        <div className="card p-3">
          <TimeSeries data={yearRows} xKey="fy" series={shown.map((a) => ({ key: a.id, name: a.shortName, colour: authorityColour(a.id) }))} />
          <div className="scroll-x mt-2"><table className="tbl"><thead><tr><th>Year</th>{shown.map((a) => <th key={a.id} className="r">{a.shortName}</th>)}<th className="r">Payments</th></tr></thead><tbody>
            {yearRows.map((r) => <tr key={r.fy}><td><Link href={`/transactions${qs({ fy: r.fy, authority: authorityId })}`}>{r.fy}</Link></td>{shown.map((a) => <td key={a.id} className="r num">{gbp((r as Record<string, number | string>)[a.id] as number | undefined)}</td>)}<td className="r num">{num(byYear.filter((x) => x.financialYear === r.fy && (!authorityId || x.authorityId === authorityId)).reduce((s, x) => s + x.count, 0))}</td></tr>)}
          </tbody></table></div>
        </div>
      </Section>

      <Section title={`Largest ${field === "category" ? "categories" : field === "department" ? "departments" : "service areas"}${fy ? ` in ${fy}` : ""}`}>
        <div className="card p-3">
          {cats.length === 0 ? <p className="text-sm muted">The published files for this selection do not include a {field} column.</p> : (
            <>
              <HBars data={cats.map((c) => ({ name: c.name ?? "(not stated)", total: c.total }))} colour={authorityId ? authorityColour(authorityId) : "#2a78d6"} />
              <div className="scroll-x mt-2"><table className="tbl"><thead><tr><th>{field}</th><th className="r">Total</th><th className="r">Payments</th></tr></thead><tbody>
                {cats.map((c) => <tr key={c.name ?? "null"}><td>{c.name ? <Link href={`/transactions${qs({ [field]: c.name, authority: authorityId, fy })}`}>{c.name}</Link> : <span className="faint">(not stated)</span>}</td><td className="r num">{gbp(c.total)}</td><td className="r num">{num(c.count)}</td></tr>)}
              </tbody></table></div>
              <Caveat>Category labels are the councils&apos; own. Different councils use different labels, so totals are not directly comparable across authorities.</Caveat>
            </>
          )}
        </div>
      </Section>
    </div>
  );
}
