import Link from "next/link";
import { notFound } from "next/navigation";
import { getTransaction } from "@/lib/queries";
import { Evidence, Kind, Section, Money } from "@/components/ui";
import { dateStr } from "@/lib/format";

export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTransaction(id);
  if (!t || t.dataset.isFixture) notFound();
  const extra = (t.extra ?? {}) as Record<string, string>;
  const fields: Array<[string, React.ReactNode]> = [
    ["Authority", <Link key="a" href={`/money?authority=${t.authorityId}`}>{t.authority.name}</Link>],
    ["Payment date", dateStr(t.date)],
    ["Financial year", t.financialYear],
    ["Supplier (as published)", t.supplierRaw],
    ["Supplier (matched)", t.supplier ? <Link key="s" href={`/suppliers/${t.supplier.id}`}>{t.supplier.displayName}</Link> : "—"],
    ["Amount", <Money key="m" value={t.amount} decimals />],
    ["Net of VAT?", t.amountIsNet === null ? "not stated by the council" : t.amountIsNet ? "yes (as published)" : "no (gross)"],
    ["Department", t.department ?? "—"], ["Service area", t.serviceArea ?? "—"], ["Category", t.category ?? "—"], ["Description", t.description ?? "—"], ["Reference", t.reference ?? "—"],
  ];
  return (
    <div>
      <div className="text-xs"><Link href="/transactions">Transactions</Link> › payment</div>
      <h1 className="mt-1 text-2xl font-bold tracking-tight"><Money value={t.amount} decimals /> to {t.supplierRaw}</h1>
      <p className="muted">{t.authority.name} · {dateStr(t.date)}</p>
      <Section title="Published record"><div className="card p-4"><div className="mb-2"><Kind kind="fact" /></div><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">{fields.map(([k, v]) => <div key={k} className="contents"><dt className="muted">{k}</dt><dd>{v}</dd></div>)}{Object.entries(extra).map(([k, v]) => <div key={k} className="contents"><dt className="muted">{k}</dt><dd>{v}</dd></div>)}</dl></div></Section>
      <Section title="Evidence"><Evidence sourceUrl={t.dataset.sourceUrl} pageUrl={t.dataset.sourcePageUrl} datasetTitle={t.dataset.title} retrievedAt={t.dataset.retrievedAt} publishedAt={t.dataset.publishedAt} rowNumber={t.rowNumber} archiveSha={t.dataset.sha256} /></Section>
      {t.supplier && t.supplier.aliases.length > 1 && <Section title="Supplier name matching"><div className="card p-4 text-sm"><div className="mb-1"><Kind kind="calc" /></div>This payment is grouped with {t.supplier.aliases.length} spellings of the same name: {t.supplier.aliases.map((a) => a.rawName).join(" · ")}. Matching only merges trivial differences (case, punctuation, “Ltd” vs “Limited”). See <Link href="/sources#suppliers">methodology</Link>.</div></Section>}
    </div>
  );
}
