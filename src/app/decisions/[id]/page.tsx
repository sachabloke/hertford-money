import Link from "next/link";
import { notFound } from "next/navigation";
import { getDecision } from "@/lib/queries";
import { Kind, Section } from "@/components/ui";
import { dateStr } from "@/lib/format";

export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getDecision(id);
  if (!d) notFound();
  const block = (title: string, text: string | null, council = false) => (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide muted">{title}{council && " (stated by the council)"}</div>
      <div className="mt-1 whitespace-pre-line text-sm">{text ?? <span className="faint">Not stated in the published papers.</span>}</div>
    </div>
  );
  return (
    <div>
      <div className="text-xs"><Link href="/decisions">Decisions</Link> › decision</div>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{d.title}</h1>
      <p className="muted text-sm">{d.authority.name} · {d.body ?? ""} · {dateStr(d.decisionDate)} · {d.summaryKind === "ai-summary" ? <Kind kind="ai" /> : <Kind kind="fact" />}</p>
      <div className="mt-4 grid gap-3">
        {block("Proposal", d.proposal)}
        {block("Reason", d.councilReason, true)}
        {block("Alternatives considered", d.alternatives, true)}
        {block("Financial implications", d.financialImplications, true)}
        {block("Decision", d.outcome)}
      </div>
      <Section title="Sources">
        <div className="card p-4 text-sm"><div className="mb-1"><Kind kind="fact" /></div>
          <ul className="space-y-1"><li><a href={d.sourceUrl} target="_blank" rel="noopener noreferrer">{d.sourceUrl}</a></li>{d.documents.map((doc) => <li key={doc.id}>{doc.title} — <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer">original</a></li>)}</ul>
        </div>
      </Section>
    </div>
  );
}
