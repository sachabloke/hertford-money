import Link from "next/link";
import { listAuthorities, listContracts } from "@/lib/queries";
import { Pagination, Caveat, Kind, Empty, qs } from "@/components/ui";
import { dateStr, gbp, num, truncate } from "@/lib/format";

export const metadata = { title: "Contracts" };

export default async function ContractsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = sp.page ? Number(sp.page) : 1;
  const [res, authorities] = await Promise.all([listContracts({ authorityId: sp.authority, q: sp.q, year: sp.year ? Number(sp.year) : undefined, sort: sp.sort === "date" ? "date" : "value", page }), listAuthorities()]);
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Contracts</h1>
      <p className="muted text-sm">From the councils&apos; published contract registers. <Kind kind="fact" /></p>
      <form className="card mt-3 grid grid-cols-2 gap-2 p-3 md:grid-cols-5">
        <input className="input col-span-2" name="q" defaultValue={sp.q ?? ""} placeholder="Title, supplier, reference" aria-label="Search contracts" />
        <select name="authority" className="input" defaultValue={sp.authority ?? ""}><option value="">All authorities</option>{authorities.map((a) => <option key={a.id} value={a.id}>{a.shortName}</option>)}</select>
        <input className="input" name="year" type="number" placeholder="Year started/awarded" defaultValue={sp.year ?? ""} aria-label="Year" />
        <select name="sort" className="input" defaultValue={sp.sort ?? "value"}><option value="value">Largest value</option><option value="date">Most recent</option></select>
        <button className="btn btn-primary col-span-2 md:col-span-5" type="submit">Apply</button>
      </form>
      {res.count === 0 ? <div className="mt-3"><Empty title="No contracts match">{!sp.q && !sp.authority && !sp.year ? "No contract register has been imported yet. Run the pipeline with --kind contracts." : "Try a broader search."}</Empty></div> : (
        <div className="card mt-3 scroll-x"><table className="tbl"><thead><tr><th>Contract</th><th>Supplier</th><th className="hidden md:table-cell">Authority</th><th className="r">Value</th><th className="hidden md:table-cell">Start – end</th></tr></thead><tbody>
          {res.rows.map((c) => <tr key={c.id}><td><Link href={`/contracts/${c.id}`}>{truncate(c.title, 90)}</Link><div className="text-xs faint md:hidden">{c.authority.shortName} · {dateStr(c.startDate)}</div></td><td>{c.supplier ? <Link href={`/suppliers/${c.supplier.id}`}>{c.supplierRaw}</Link> : c.supplierRaw}</td><td className="hidden md:table-cell">{c.authority.shortName}</td><td className="r num">{gbp(c.value)}</td><td className="hidden whitespace-nowrap text-xs md:table-cell">{dateStr(c.startDate)} – {dateStr(c.endDate)}</td></tr>)}
        </tbody></table></div>)}
      <Pagination page={res.page} pageSize={res.pageSize} count={res.count} makeHref={(p) => `/contracts${qs({ ...sp, page: p })}`} />
      <Caveat>Registers usually cover contracts above £5,000. The “value” is whatever the register states (total or annual) and is shown with its basis on each contract page. {num(res.count)} contracts match.</Caveat>
    </div>
  );
}
