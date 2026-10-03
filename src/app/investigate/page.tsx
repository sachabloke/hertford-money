import Link from "next/link";
import { listAuthorities, listFlags } from "@/lib/queries";
import { Caveat, Empty, Kind, qs } from "@/components/ui";
import { METHODOLOGY } from "../../../pipeline/core/flags";

export const metadata = { title: "Investigate" };

const RULE_LABEL: Record<string, string> = { supplier_rapid_increase: "Rapid supplier increases", new_large_supplier: "New large suppliers", supplier_concentration: "Concentrated spending", duplicate_looking_payments: "Duplicate-looking payments", category_yoy_change: "Big year-on-year category changes", budget_vs_actual: "Budget vs actual", contract_vs_payments: "Contract value vs payments" };

export default async function InvestigatePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [flags, authorities] = await Promise.all([listFlags({ authorityId: sp.authority, rule: sp.rule }), listAuthorities()]);
  const byRule = new Map<string, typeof flags>();
  for (const f of flags) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Investigate</h1>
      <p className="muted text-sm">Patterns in the published data that are unusual under a stated, published rule. <Kind kind="flag" /></p>
      <div className="card mt-3 p-3 text-sm" style={{ borderColor: "var(--warn)" }}>A flag is a reason to look, not a conclusion. It never shows waste, fraud or wrongdoing: most unusual numbers have ordinary explanations (a new contract, a re-coded category, a one-off capital project). Every flag shows the exact numbers and rule that produced it.</div>
      <form className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
        <select name="authority" className="input" defaultValue={sp.authority ?? ""}><option value="">All authorities</option>{authorities.map((a) => <option key={a.id} value={a.id}>{a.shortName}</option>)}</select>
        <select name="rule" className="input" defaultValue={sp.rule ?? ""}><option value="">All rules</option>{Object.entries(RULE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn btn-primary" type="submit">Apply</button>
      </form>
      {flags.length === 0 && <div className="mt-3"><Empty title="No flags">Either nothing met a rule&apos;s threshold, or flags have not been computed yet (<code>npm run pipeline -- flags</code>).</Empty></div>}
      {[...byRule.entries()].map(([rule, list]) => (
        <section key={rule} className="mt-6">
          <h2 className="text-lg font-bold">{RULE_LABEL[rule] ?? rule} <span className="faint text-sm font-normal">({list.length})</span></h2>
          <p className="text-xs muted">{METHODOLOGY[rule as keyof typeof METHODOLOGY]}</p>
          <div className="card mt-2"><table className="tbl"><tbody>
            {list.slice(0, 50).map((f) => <tr key={f.id}><td><Link href={`/investigate/${f.id}`}>{f.title}</Link><div className="text-xs faint">{f.authority.shortName}{f.periodLabel ? ` · ${f.periodLabel}` : ""} · {f.severity}</div></td></tr>)}
            {list.length > 50 && <tr><td className="text-sm muted"><Link href={`/investigate${qs({ ...sp, rule })}`}>Show all {list.length} →</Link></td></tr>}
          </tbody></table></div>
        </section>
      ))}
      <Caveat>Severity (“info”, “notable”, “high”) describes how far a number is from the rule&apos;s threshold, nothing else. Full method on the <Link href="/sources#anomalies">Sources page</Link>.</Caveat>
    </div>
  );
}
