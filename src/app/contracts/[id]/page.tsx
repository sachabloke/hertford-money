import Link from "next/link";
import { notFound } from "next/navigation";
import { getContract } from "@/lib/queries";
import { Evidence, Kind, Section, Stat, Money, Caveat, qs } from "@/components/ui";
import { dateStr, gbp, num } from "@/lib/format";

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await getContract(id);
  if (!r || r.contract.dataset.isFixture) notFound();
  const c = r.contract;
  const extra = (c.extra ?? {}) as Record<string, string>;
  return (
    <div>
      <div className="text-xs"><Link href="/contracts">Contracts</Link> › contract</div>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{c.title}</h1>
      <p className="muted">{c.authority.name} · {c.supplier ? <Link href={`/suppliers/${c.supplier.id}`}>{c.supplierRaw}</Link> : c.supplierRaw}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Contract value" value={<Money value={c.value} compact />} sub={<><Kind kind="fact" /> basis: {c.valueBasis ?? "as stated"}</>} />
        <Stat label="Start" value={<span className="text-lg">{dateStr(c.startDate)}</span>} />
        <Stat label="End" value={<span className="text-lg">{dateStr(c.endDate)}</span>} />
        <Stat label="Awarded" value={<span className="text-lg">{dateStr(c.awardDate)}</span>} />
      </div>
      <Section title="Published record"><div className="card p-4"><div className="mb-2"><Kind kind="fact" /></div><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {([["Reference", c.reference], ["Purpose / description", c.description], ["Department", c.department], ["Category", c.category], ["Procurement route", c.procurementRoute], ["Review / extension", c.reviewDate ? dateStr(c.reviewDate) : null]] as Array<[string, string | null | undefined]>).filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="muted">{k}</dt><dd>{v}</dd></div>)}
        {Object.entries(extra).map(([k, v]) => <div key={k} className="contents"><dt className="muted">{k}</dt><dd>{v}</dd></div>)}
      </dl>{c.sourceRecordUrl && <p className="mt-2 text-sm">Original contract record: <a href={c.sourceRecordUrl} target="_blank" rel="noopener noreferrer">{c.sourceRecordUrl}</a></p>}</div></Section>
      <Section title="Payments to this supplier during the contract">
        <div className="card p-4 text-sm"><div className="mb-1"><Kind kind="calc" /></div>
          {!r.payments ? <p className="muted">The supplier named on this contract could not be matched to the payments data.</p> : r.payments.count === 0 ? <p className="muted">No payments to this supplier from {c.authority.shortName} fall between the contract dates in the indexed data.</p> : (
            <><p><Money value={r.payments.total} /> over {num(r.payments.count)} payments{c.startDate ? ` between ${dateStr(c.startDate)} and ${c.endDate ? dateStr(c.endDate) : "today"}` : ""}. <Link href={`/transactions${qs({ supplier: c.supplierId, authority: c.authorityId, from: c.startDate?.toISOString().slice(0, 10), to: c.endDate?.toISOString().slice(0, 10) })}`}>See the payments →</Link></p>
            <table className="tbl mt-2"><thead><tr><th>Year</th><th className="r">Paid</th></tr></thead><tbody>{r.payments.byYear.map((y) => <tr key={y.financialYear}><td>{y.financialYear}</td><td className="r num">{gbp(y.total)}</td></tr>)}</tbody></table></>)}
          <Caveat>Payments are to the supplier, not to this contract: the same supplier may hold several contracts and payments files do not carry contract references. Treat the comparison as a prompt, not a reconciliation.</Caveat>
        </div>
      </Section>
      <Section title="Evidence"><Evidence sourceUrl={c.dataset.sourceUrl} pageUrl={c.dataset.sourcePageUrl} datasetTitle={c.dataset.title} retrievedAt={c.dataset.retrievedAt} publishedAt={c.dataset.publishedAt} rowNumber={c.rowNumber} archiveSha={c.dataset.sha256} /></Section>
    </div>
  );
}
