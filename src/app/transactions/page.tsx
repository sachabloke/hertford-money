import Link from "next/link";
import { listAuthorities, listFinancialYears, searchTransactions } from "@/lib/queries";
import { Pagination, Stat, Money, Kind, Caveat, qs } from "@/components/ui";
import { dateStr, gbp, num, truncate } from "@/lib/format";

export const metadata = { title: "Transactions" };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const f = { q: sp.q, authorityId: sp.authority, supplierId: sp.supplier, category: sp.category, department: sp.department, financialYear: sp.fy, from: sp.from, to: sp.to, min: sp.min ? Number(sp.min) : undefined, max: sp.max ? Number(sp.max) : undefined, sort: (sp.sort === "amount" ? "amount" : "date") as "amount" | "date", dir: (sp.dir === "asc" ? "asc" : "desc") as "asc" | "desc", page: sp.page ? Number(sp.page) : 1 };
  const [res, authorities, years] = await Promise.all([searchTransactions(f), listAuthorities(), listFinancialYears()]);
  const href = (p: number) => `/transactions${qs({ ...sp, page: p })}`;
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
      <form className="card mt-3 grid grid-cols-2 gap-2 p-3 md:grid-cols-4">
        <input className="input col-span-2" name="q" defaultValue={sp.q ?? ""} placeholder="Supplier, description, category, reference…" aria-label="Search text" />
        <select name="authority" className="input" defaultValue={sp.authority ?? ""}><option value="">All authorities</option>{authorities.map((a) => <option key={a.id} value={a.id}>{a.shortName}</option>)}</select>
        <select name="fy" className="input" defaultValue={sp.fy ?? ""}><option value="">All years</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <input className="input" type="date" name="from" defaultValue={sp.from ?? ""} aria-label="From date" />
        <input className="input" type="date" name="to" defaultValue={sp.to ?? ""} aria-label="To date" />
        <input className="input" type="number" name="min" defaultValue={sp.min ?? ""} placeholder="Min £" aria-label="Minimum amount" />
        <input className="input" type="number" name="max" defaultValue={sp.max ?? ""} placeholder="Max £" aria-label="Maximum amount" />
        {sp.category && <input type="hidden" name="category" value={sp.category} />}
        {sp.department && <input type="hidden" name="department" value={sp.department} />}
        {sp.supplier && <input type="hidden" name="supplier" value={sp.supplier} />}
        <select name="sort" className="input" defaultValue={sp.sort ?? "date"}><option value="date">Newest first</option><option value="amount">Largest first</option></select>
        <button className="btn btn-primary" type="submit">Filter</button>
        {(sp.category || sp.department || sp.supplier) && <div className="col-span-2 text-xs muted">Filtered to {sp.category && <>category “{sp.category}” </>}{sp.department && <>department “{sp.department}” </>}{sp.supplier && <>one supplier </>}· <Link href="/transactions">clear</Link></div>}
      </form>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Stat label="Matching payments" value={num(res.count)} />
        <Stat label="Total of matches" value={<Money value={res.total} compact />} sub={<Kind kind="calc" />} />
      </div>
      <div className="card mt-3 scroll-x">
        <table className="tbl">
          <thead><tr><th>Date</th><th>Supplier</th><th className="hidden md:table-cell">Category / description</th><th className="hidden md:table-cell">Authority</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {res.rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center muted">No published payments match.</td></tr>}
            {res.rows.map((t) => (
              <tr key={t.id}>
                <td className="whitespace-nowrap"><Link href={`/transactions/${t.id}`}>{dateStr(t.date)}</Link></td>
                <td>{t.supplier ? <Link href={`/suppliers/${t.supplier.id}`}>{t.supplierRaw}</Link> : t.supplierRaw}<div className="text-xs faint md:hidden">{truncate(t.category ?? t.description, 40)} · {t.authority.shortName}</div></td>
                <td className="hidden md:table-cell"><div>{t.category}</div><div className="text-xs faint">{truncate(t.description ?? t.department ?? t.serviceArea, 70)}</div></td>
                <td className="hidden md:table-cell">{t.authority.shortName}</td>
                <td className="r num">{gbp(t.amount, { decimals: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={res.page} pageSize={res.pageSize} count={res.count} makeHref={href} />
      <Caveat>Each row is one line in a council&apos;s published payments file. Click a date to see the original file, row number and retrieval record.</Caveat>
    </div>
  );
}
