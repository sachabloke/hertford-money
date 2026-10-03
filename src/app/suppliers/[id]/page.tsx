import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupplier, searchTransactions } from "@/lib/queries";
import { Section, Stat, Money, Kind, Caveat, Pagination, qs } from "@/components/ui";
import { TimeSeries } from "@/components/charts";
import { authorityColour, dateStr, gbp, num, truncate } from "@/lib/format";

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await getSupplier(id);
  if (!s) notFound();
  const page = sp.page ? Number(sp.page) : 1;
  const tx = await searchTransactions({ supplierId: id, page, pageSize: 50, sort: "date" });
  const authorities = [...new Map(s.supplier.stats.map((x) => [x.authorityId, x.authority])).values()];
  const years = [...new Set(s.supplier.stats.map((x) => x.financialYear))].sort();
  const chart = years.map((fy) => ({ fy, ...Object.fromEntries(s.supplier.stats.filter((x) => x.financialYear === fy).map((x) => [x.authorityId, Number(x.total)])) }));
  return (
    <div>
      <div className="text-xs"><Link href="/suppliers">Suppliers</Link> › supplier</div>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{s.supplier.displayName}</h1>
      <p className="muted text-sm">Paid by {authorities.map((a) => a.shortName).join(", ") || "—"}{s.supplier.companyNumber ? ` · company no. ${s.supplier.companyNumber}` : ""}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total received" value={<Money value={s.total} compact />} sub={<Kind kind="calc" />} />
        <Stat label="Payments" value={num(s.count)} />
        <Stat label="First payment" value={<span className="text-lg">{dateStr(s.minDate)}</span>} />
        <Stat label="Latest payment" value={<span className="text-lg">{dateStr(s.maxDate)}</span>} />
      </div>

      <Section title="By financial year">
        <div className="card p-3">
          <TimeSeries data={chart} xKey="fy" series={authorities.map((a) => ({ key: a.id, name: a.shortName, colour: authorityColour(a.id) }))} />
          <div className="scroll-x mt-2"><table className="tbl"><thead><tr><th>Year</th>{authorities.map((a) => <th key={a.id} className="r">{a.shortName}</th>)}<th className="r">Payments</th></tr></thead><tbody>
            {years.map((fy) => <tr key={fy}><td><Link href={`/transactions${qs({ supplier: id, fy })}`}>{fy}</Link></td>{authorities.map((a) => <td key={a.id} className="r num">{gbp(Number(s.supplier.stats.find((x) => x.financialYear === fy && x.authorityId === a.id)?.total ?? NaN))}</td>)}<td className="r num">{num(s.supplier.stats.filter((x) => x.financialYear === fy).reduce((n, x) => n + x.count, 0))}</td></tr>)}
          </tbody></table></div>
        </div>
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="What the payments were for">
          <div className="card"><table className="tbl"><thead><tr><th>Category (as published)</th><th className="r">Total</th></tr></thead><tbody>
            {s.categories.length === 0 && <tr><td colSpan={2} className="p-4 muted">The published files do not state a category.</td></tr>}
            {s.categories.map((c, i) => <tr key={i}><td>{c.category ?? <span className="faint">(not stated)</span>}<div className="text-xs faint">{authorities.find((a) => a.id === c.authorityId)?.shortName}</div></td><td className="r num">{gbp(c.total)}</td></tr>)}
          </tbody></table></div>
        </Section>
        <Section title="Name spellings grouped">
          <div className="card p-4 text-sm"><div className="mb-1"><Kind kind="calc" /></div>
            <ul>{s.supplier.aliases.map((a) => <li key={a.id}>{a.rawName} <span className="faint">({num(a.occurrences)} rows, {a.confidence})</span></li>)}</ul>
            <Caveat>Only trivially different spellings are grouped. If you believe two entries are the same organisation, see the corrections process on the Sources page.</Caveat>
          </div>
        </Section>
      </div>

      <Section title="Contracts naming this supplier">
        <div className="card scroll-x">
          {s.supplier.contracts.length === 0 ? <div className="p-4 text-sm muted">No contract in the imported registers names this supplier. Contract registers usually list only contracts above £5,000 and may use a different spelling.</div> : (
            <table className="tbl"><thead><tr><th>Contract</th><th>Authority</th><th className="r">Value</th><th>Dates</th></tr></thead><tbody>
              {s.supplier.contracts.map((c) => <tr key={c.id}><td><Link href={`/contracts/${c.id}`}>{c.title}</Link></td><td>{c.authority.shortName}</td><td className="r num">{gbp(c.value)}</td><td className="whitespace-nowrap text-xs">{dateStr(c.startDate)} – {dateStr(c.endDate)}</td></tr>)}
            </tbody></table>)}
        </div>
      </Section>

      {s.supplier.flags.length > 0 && <Section title="Statistical flags">
        <div className="card"><table className="tbl"><tbody>{s.supplier.flags.map((f) => <tr key={f.id}><td><Link href={`/investigate/${f.id}`}>{f.title}</Link><div className="text-xs faint"><Kind kind="flag" /> · {f.rule.replace(/_/g, " ")}</div></td></tr>)}</tbody></table></div>
        <Caveat>A flag means a pattern is unusual under a stated rule. It is not evidence of wrongdoing.</Caveat>
      </Section>}

      <Section title="Transaction history">
        <div className="card scroll-x"><table className="tbl"><thead><tr><th>Date</th><th>Authority</th><th className="hidden md:table-cell">Category / description</th><th className="r">Amount</th></tr></thead><tbody>
          {tx.rows.map((t) => <tr key={t.id}><td className="whitespace-nowrap"><Link href={`/transactions/${t.id}`}>{dateStr(t.date)}</Link></td><td>{t.authority.shortName}</td><td className="hidden md:table-cell">{t.category}<div className="text-xs faint">{truncate(t.description ?? t.department, 70)}</div></td><td className="r num">{gbp(t.amount, { decimals: true })}</td></tr>)}
        </tbody></table></div>
        <Pagination page={tx.page} pageSize={tx.pageSize} count={tx.count} makeHref={(p) => `/suppliers/${id}?page=${p}`} />
      </Section>

      <Section title="Source evidence">
        <div className="card p-4 text-sm"><div className="mb-1"><Kind kind="fact" /></div>
          <ul className="space-y-1">{s.datasets.map((d) => <li key={d.id}>{d.title} — <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer">original file</a> <span className="faint">(retrieved {dateStr(d.retrievedAt)})</span></li>)}</ul>
        </div>
      </Section>
    </div>
  );
}
