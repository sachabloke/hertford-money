import Link from "next/link";
import { listAuthorities, listDecisions } from "@/lib/queries";
import { Caveat, Empty, Kind, Pagination, qs } from "@/components/ui";
import { dateStr, truncate } from "@/lib/format";

export const metadata = { title: "Decisions" };

export default async function DecisionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = sp.page ? Number(sp.page) : 1;
  const [res, authorities] = await Promise.all([listDecisions({ authorityId: sp.authority, q: sp.q, month: sp.month, page }), listAuthorities()]);
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Decisions</h1>
      <p className="muted text-sm">Council decisions in plain English, with the council&apos;s own stated reasons and the original papers.</p>
      <form className="card mt-3 grid grid-cols-2 gap-2 p-3 md:grid-cols-4">
        <input className="input col-span-2" name="q" defaultValue={sp.q ?? ""} placeholder="Search decisions" aria-label="Search decisions" />
        <select name="authority" className="input" defaultValue={sp.authority ?? ""}><option value="">All authorities</option>{authorities.map((a) => <option key={a.id} value={a.id}>{a.shortName}</option>)}</select>
        <input className="input" type="month" name="month" defaultValue={sp.month ?? ""} aria-label="Month" />
        <button className="btn btn-primary col-span-2 md:col-span-4" type="submit">Apply</button>
      </form>
      {res.count === 0 ? <div className="mt-3"><Empty title="No decisions match">{!sp.q && !sp.authority && !sp.month ? <>No decisions have been imported yet. The decisions importer reads the councils&apos; committee systems (ModernGov) and extracts each report&apos;s recommendation, stated reasons, alternatives and financial implications. Run <code>npm run pipeline -- decisions &lt;adapter&gt;</code>.</> : "Try a broader search."}</Empty></div> : (
        <div className="card mt-3"><table className="tbl"><tbody>
          {res.rows.map((d) => <tr key={d.id}><td><Link href={`/decisions/${d.id}`}>{d.title}</Link><div className="text-xs faint">{d.authority.shortName} · {d.body ?? ""} · {dateStr(d.decisionDate)} · {d.summaryKind === "ai-summary" ? <Kind kind="ai" /> : <Kind kind="fact" />}</div>{d.proposal && <div className="mt-1 text-sm muted">{truncate(d.proposal, 160)}</div>}</td></tr>)}
        </tbody></table></div>)}
      <Pagination page={res.page} pageSize={50} count={res.count} makeHref={(p) => `/decisions${qs({ ...sp, page: p })}`} />
      <Caveat>Summaries never add commentary. Where text is extracted from the council&apos;s report it is labelled a published fact; where an AI model condensed it, it is labelled an AI summary and the original is one click away.</Caveat>
    </div>
  );
}
