import Link from "next/link";
import { ask } from "@/lib/ask";
import { SearchBox } from "@/components/search-box";
import { Kind, Section } from "@/components/ui";
import { AiExplain } from "@/components/ai-explain";

export const metadata = { title: "Ask" };

const EXAMPLES = ["Where does my council tax go?", "Who are Hertfordshire's largest suppliers?", "How much did the council spend on consultants?", "What spending increased fastest?", "How much has adult social care spending changed?", "What large contracts were awarded this year?", "What spending looks unusual?", "What decisions are being made this month?"];

export default async function AskPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { q = "" } = await searchParams;
  const result = q.trim() ? await ask(q) : null;
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Ask Hertford Money</h1>
      <p className="muted text-sm">Plain questions, answered from the published records. Numbers are computed by code; an AI model may explain them but can never add to them.</p>
      <div className="mt-3"><SearchBox initial={q} action="/ask" placeholder="Ask a question…" /></div>
      {!result && <div className="mt-4 flex flex-wrap gap-2">{EXAMPLES.map((e) => <Link key={e} className="btn" href={`/ask?q=${encodeURIComponent(e)}`}>{e}</Link>)}</div>}
      {result && (
        <div className="mt-4 space-y-4">
          <div className="card p-4" style={result.insufficient ? { borderColor: "var(--warn)" } : {}}>
            <div className="text-xs font-semibold uppercase tracking-wide muted">Answer{result.insufficient && " · insufficient evidence"}</div>
            <p className="mt-1 text-lg">{result.answer}</p>
            {result.scope.authorityName && <div className="mt-1 text-xs faint">Scope: {result.scope.authorityName}{result.scope.financialYear ? ` · ${result.scope.financialYear}` : ""}</div>}
          </div>
          {result.numbers.length > 0 && <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{result.numbers.map((n, i) => <div key={i} className="card p-4"><div className="text-xs muted">{n.label}</div><div className="num text-2xl font-bold">{n.value}</div><Kind kind={n.kind} /></div>)}</div>}
          {result.tables.map((t, i) => <div key={i} className="card scroll-x"><div className="px-3 pt-3 text-sm font-semibold">{t.title}</div><table className="tbl"><thead><tr>{t.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{t.rows.map((row, j) => <tr key={j}>{row.map((cell, k) => <td key={k} className={k > 0 ? "num" : ""}>{cell}</td>)}</tr>)}</tbody></table></div>)}
          {result.why && <div className="card p-4"><div className="text-xs font-semibold uppercase tracking-wide muted">Why / how this was calculated</div><p className="mt-1 text-sm">{result.why}</p></div>}
          {!result.insufficient && <AiExplain question={result.question} />}
          {result.evidence.length > 0 && <Section title="Evidence"><div className="card p-4 text-sm"><ul className="space-y-1">{result.evidence.map((e, i) => <li key={i}><Link href={e.href}>{e.label}</Link></li>)}</ul></div></Section>}
          {result.sources.length > 0 && <Section title="Sources"><div className="card p-4 text-sm"><div className="mb-1"><Kind kind="fact" /></div><ul className="space-y-1">{result.sources.map((s, i) => <li key={i}><a href={s.href} target="_blank" rel="noopener noreferrer">{s.label}</a></li>)}</ul></div></Section>}
          <p className="text-xs faint">Hertford Money is politically neutral. It presents the records; it does not tell you what to conclude from them.</p>
        </div>
      )}
    </div>
  );
}
