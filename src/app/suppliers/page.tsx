import Link from "next/link";
import { listAuthorities, listFinancialYears, topSuppliers } from "@/lib/queries";
import { Pagination, Caveat, Kind, NoDataYet, qs } from "@/components/ui";
import { gbp, num } from "@/lib/format";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = sp.page ? Number(sp.page) : 1;
  const [res, authorities, years] = await Promise.all([topSuppliers({ authorityId: sp.authority, financialYear: sp.fy, q: sp.q, limit: 50, offset: (page - 1) * 50 }), listAuthorities(), listFinancialYears()]);
  if (res.totalCount === 0 && !sp.q && !sp.authority && !sp.fy) return <div><h1 className="text-2xl font-bold">Suppliers</h1><div className="mt-4"><NoDataYet /></div></div>;
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Suppliers</h1>
      <p className="muted">Ranked by total payments in the indexed data{sp.fy ? ` for ${sp.fy}` : ""}. <Kind kind="calc" /></p>
      <form className="card mt-3 grid grid-cols-2 gap-2 p-3 md:grid-cols-4">
        <input className="input col-span-2" name="q" defaultValue={sp.q ?? ""} placeholder="Supplier name" aria-label="Supplier name" />
        <select name="authority" className="input" defaultValue={sp.authority ?? ""}><option value="">All authorities</option>{authorities.map((a) => <option key={a.id} value={a.id}>{a.shortName}</option>)}</select>
        <select name="fy" className="input" defaultValue={sp.fy ?? ""}><option value="">All years</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <button className="btn btn-primary col-span-2 md:col-span-4" type="submit">Apply</button>
      </form>
      <div className="card mt-3 scroll-x"><table className="tbl"><thead><tr><th>#</th><th>Supplier</th><th className="hidden md:table-cell">Paid by</th><th className="r">Total</th><th className="r hidden md:table-cell">Payments</th></tr></thead><tbody>
        {res.rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center muted">No suppliers match.</td></tr>}
        {res.rows.map((s, i) => <tr key={s.supplierId}><td className="faint num">{(page - 1) * 50 + i + 1}</td><td><Link href={`/suppliers/${s.supplierId}`}>{s.name}</Link></td><td className="hidden md:table-cell">{s.authorities.map((a) => <span key={a} className="pill mr-1">{authorities.find((x) => x.id === a)?.shortName ?? a}</span>)}</td><td className="r num">{gbp(s.total)}</td><td className="r num hidden md:table-cell">{num(s.count)}</td></tr>)}
      </tbody></table></div>
      <Pagination page={page} pageSize={50} count={res.totalCount} makeHref={(p) => `/suppliers${qs({ ...sp, page: p })}`} />
      <Caveat>Names are grouped only when spellings differ trivially (case, punctuation, “Ltd”/“Limited”). Companies with similar names that could be different organisations are kept separate. Individuals are shown as the council redacted them.</Caveat>
    </div>
  );
}
