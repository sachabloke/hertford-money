import Link from "next/link";
import { notFound } from "next/navigation";
import { getFlag } from "@/lib/queries";
import { Kind, Section, qs } from "@/components/ui";
import { METHODOLOGY } from "../../../../pipeline/core/flags";
import { gbp } from "@/lib/format";

export default async function FlagPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await getFlag(id);
  if (!f) notFound();
  const ev = (f.evidence ?? {}) as Record<string, unknown>;
  const byYear = ev.byYear as Record<string, number> | undefined;
  return (
    <div>
      <div className="text-xs"><Link href="/investigate">Investigate</Link> › flag</div>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{f.title}</h1>
      <p className="muted text-sm">{f.authority.name}{f.periodLabel ? ` · ${f.periodLabel}` : ""} · <Kind kind="flag" /> · severity: {f.severity}</p>
      {byYear && <Section title="Numbers"><div className="card"><table className="tbl"><thead><tr><th>Financial year</th><th className="r">Payments</th></tr></thead><tbody>{Object.entries(byYear).map(([y, v]) => <tr key={y}><td>{y}</td><td className="r num">{gbp(v)}</td></tr>)}</tbody></table></div></Section>}
      <Section title="Reason flagged"><div className="card p-4 text-sm">{f.reason}</div></Section>
      <Section title="Rule"><div className="card p-4 text-sm"><div className="font-semibold">{f.rule.replace(/_/g, " ")}</div><p className="mt-1 muted">{METHODOLOGY[f.rule as keyof typeof METHODOLOGY]}</p><details className="mt-2"><summary className="cursor-pointer muted">All numbers used</summary><pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(ev, null, 2)}</pre></details></div></Section>
      <Section title="Look further">
        <div className="flex flex-wrap gap-2">
          {f.supplierId && <Link className="btn" href={`/transactions${qs({ supplier: f.supplierId, authority: f.authorityId })}`}>Transactions</Link>}
          {f.supplierId && <Link className="btn" href={`/contracts${qs({ q: f.supplier?.displayName })}`}>Contracts</Link>}
          {f.supplierId && <Link className="btn" href={`/suppliers/${f.supplierId}`}>Supplier page</Link>}
          {typeof ev.category === "string" && <Link className="btn" href={`/transactions${qs({ category: ev.category, authority: f.authorityId })}`}>Transactions in this category</Link>}
          {Array.isArray(ev.transactionIds) && (ev.transactionIds as string[]).slice(0, 5).map((t, i) => <Link key={t} className="btn" href={`/transactions/${t}`}>Row {i + 1}</Link>)}
          <Link className="btn" href={`/decisions${qs({ q: f.supplier?.displayName ?? (ev.category as string | undefined) })}`}>Council documents</Link>
          <Link className="btn" href="/sources#anomalies">Methodology</Link>
        </div>
      </Section>
      <p className="mt-6 text-xs faint">This flag does not prove wrongdoing. The council may have published an explanation in its committee papers; if so, Hertford Money shows it as the council&apos;s explanation.</p>
    </div>
  );
}
