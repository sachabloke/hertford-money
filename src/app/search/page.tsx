import Link from "next/link";
import { unifiedSearch } from "@/lib/queries";
import { Section, Kind, Caveat, qs } from "@/components/ui";
import { SearchBox } from "@/components/search-box";
import { dateStr, gbp, num, truncate } from "@/lib/format";

export const metadata = { title: "Search" };

const QUESTION = /\?$|^(who|what|why|how|where|when|which)\b/i;

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { q = "" } = await searchParams;
  const term = q.trim();
  const r = term ? await unifiedSearch(term) : null;
  const looksLikeQuestion = QUESTION.test(term);
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Search</h1>
      <div className="mt-3"><SearchBox initial={term} placeholder="Supplier, category, description, contract, document…" /></div>
      {term && <p className="mt-2 text-sm muted">{looksLikeQuestion ? <>That looks like a question. <Link href={`/ask?q=${encodeURIComponent(term)}`}>Ask Hertford Money →</Link></> : <>Or <Link href={`/ask?q=${encodeURIComponent(term)}`}>ask a question about “{term}”</Link>.</>}</p>}
      {r && (
        <>
          {r.suppliers.length > 0 && <Section title="Suppliers"><div className="card"><table className="tbl"><tbody>{r.suppliers.map((s) => <tr key={s.supplierId}><td><Link href={`/suppliers/${s.supplierId}`}>{s.name}</Link></td><td className="r num">{gbp(s.total)}</td></tr>)}</tbody></table></div></Section>}
          {r.categories.length > 0 && <Section title="Categories"><div className="card"><table className="tbl"><tbody>{r.categories.map((c) => <tr key={c.name ?? ""}><td><Link href={`/transactions${qs({ category: c.name })}`}>{c.name}</Link> <span className="faint text-xs">{num(c.count)} payments</span></td><td className="r num">{gbp(c.total)}</td></tr>)}</tbody></table></div></Section>}
          <Section title={`Transactions (${num(r.transactions.count)} matching, ${gbp(r.transactions.total, { compact: true })})`} right={<Link href={`/transactions?q=${encodeURIComponent(term)}`} className="text-sm">All matches →</Link>}>
            <div className="card scroll-x"><table className="tbl"><tbody>{r.transactions.rows.map((t) => <tr key={t.id}><td className="whitespace-nowrap"><Link href={`/transactions/${t.id}`}>{dateStr(t.date)}</Link></td><td>{t.supplierRaw}<div className="text-xs faint">{truncate(t.description ?? t.category, 60)} · {t.authority.shortName}</div></td><td className="r num">{gbp(t.amount)}</td></tr>)}{r.transactions.rows.length === 0 && <tr><td className="p-4 muted">No payments match.</td></tr>}</tbody></table></div>
          </Section>
          {r.contracts.length > 0 && <Section title="Contracts"><div className="card"><table className="tbl"><tbody>{r.contracts.map((c) => <tr key={c.id}><td><Link href={`/contracts/${c.id}`}>{truncate(c.title, 80)}</Link><div className="text-xs faint">{c.supplierRaw} · {c.authority.shortName}</div></td><td className="r num">{gbp(c.value)}</td></tr>)}</tbody></table></div></Section>}
          {r.decisions.length > 0 && <Section title="Decisions"><div className="card"><table className="tbl"><tbody>{r.decisions.map((d) => <tr key={d.id}><td><Link href={`/decisions/${d.id}`}>{d.title}</Link><div className="text-xs faint">{d.authority.shortName} · {dateStr(d.decisionDate)}</div></td></tr>)}</tbody></table></div></Section>}
          {r.documents.length > 0 && <Section title="Council documents"><div className="card"><table className="tbl"><tbody>{r.documents.map((d) => <tr key={d.id}><td><a href={d.sourceUrl} target="_blank" rel="noopener noreferrer">{d.title}</a><div className="text-xs faint">{d.authority.shortName} · {d.kind} · {dateStr(d.meetingDate ?? d.publishedAt)}</div></td></tr>)}</tbody></table></div></Section>}
          <Caveat><Kind kind="fact" /> Results are matched on the councils&apos; own text. Spelling differs between files; try a shorter word.</Caveat>
        </>
      )}
    </div>
  );
}
