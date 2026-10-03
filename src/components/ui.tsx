import Link from "next/link";
import type { ReactNode } from "react";
import { gbp, num, type MoneyLike } from "@/lib/format";

export function Stat({ label, value, sub, big }: { label: string; value: ReactNode; sub?: ReactNode; big?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide muted">{label}</div>
      <div className={`num mt-1 font-bold ${big ? "hero" : "text-2xl"}`}>{value}</div>
      {sub && <div className="mt-1 text-xs faint">{sub}</div>}
    </div>
  );
}

export function Money({ value, compact = false, decimals = false }: { value: MoneyLike; compact?: boolean; decimals?: boolean }) {
  return <span className="num">{gbp(value, { compact, decimals })}</span>;
}

/** Labels that make the kind of claim explicit, everywhere. */
export function Kind({ kind }: { kind: "fact" | "calc" | "ai" | "flag" | "interpretation" }) {
  const map = { fact: ["Published fact", "kind-fact"], calc: ["Calculated", "kind-calc"], ai: ["AI summary", "kind-ai"], flag: ["Statistical flag", "kind-flag"], interpretation: ["Interpretation", "kind-ai"] } as const;
  const [t, c] = map[kind];
  return <span className={`label-kind ${c}`}>{t}</span>;
}

export function Section({ title, children, right, id }: { title: string; children: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <section id={id} className="mt-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card p-6 text-center">
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-2 text-sm muted">{children}</div>}
    </div>
  );
}

export function NoDataYet() {
  return (
    <Empty title="No council data has been imported yet">
      <p>Hertford Money never shows estimated or made-up figures. Run the data pipeline to download the councils&apos; published payment files, then this page fills with real records.</p>
      <p className="mt-2"><code className="text-xs">npm run pipeline -- all</code> &middot; see <Link href="/sources">Sources</Link> for what will be imported.</p>
    </Empty>
  );
}

export function Evidence({ sourceUrl, pageUrl, datasetTitle, retrievedAt, publishedAt, rowNumber, archiveSha }: { sourceUrl: string; pageUrl?: string | null; datasetTitle?: string; retrievedAt?: Date | null; publishedAt?: Date | null; rowNumber?: number | null; archiveSha?: string | null }) {
  return (
    <div className="card p-4 text-sm">
      <div className="mb-2 flex items-center gap-2"><Kind kind="fact" /><span className="font-semibold">Evidence / original source</span></div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {datasetTitle && <><dt className="muted">Dataset</dt><dd>{datasetTitle}</dd></>}
        <dt className="muted">Original file</dt><dd className="break-all"><a href={sourceUrl} rel="noopener noreferrer" target="_blank">{sourceUrl}</a></dd>
        {pageUrl && pageUrl !== sourceUrl && <><dt className="muted">Found on page</dt><dd className="break-all"><a href={pageUrl} rel="noopener noreferrer" target="_blank">{pageUrl}</a></dd></>}
        {rowNumber != null && <><dt className="muted">Row in file</dt><dd className="num">{rowNumber}</dd></>}
        {publishedAt && <><dt className="muted">Published</dt><dd>{publishedAt.toLocaleDateString("en-GB", { timeZone: "UTC" })}</dd></>}
        {retrievedAt && <><dt className="muted">Retrieved</dt><dd>{retrievedAt.toLocaleString("en-GB", { timeZone: "UTC" })} UTC</dd></>}
        {archiveSha && <><dt className="muted">Archived copy</dt><dd className="num break-all text-xs">sha256 {archiveSha}</dd></>}
      </dl>
    </div>
  );
}

export function Pagination({ page, pageSize, count, makeHref }: { page: number; pageSize: number; count: number; makeHref: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <span className="muted">Page {num(page)} of {num(pages)} · {num(count)} rows</span>
      <div className="flex gap-2">
        {page > 1 && <Link className="btn" href={makeHref(page - 1)}>‹ Previous</Link>}
        {page < pages && <Link className="btn" href={makeHref(page + 1)}>Next ›</Link>}
      </div>
    </div>
  );
}

export function Caveat({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-xs faint">{children}</p>;
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}
