import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { Nav } from "@/components/nav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Hertford Money", template: "%s · Hertford Money" },
  description: "See where public money goes in Hertford: payments, suppliers, contracts and decisions of Hertfordshire County Council, East Herts Council and Hertford Town Council, from the councils' own published data.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen pb-20 md:pb-0">
        <header className="sticky top-0 z-20 border-b" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="font-bold tracking-tight no-underline hover:no-underline" style={{ color: "var(--text)" }}>
              HERTFORD <span style={{ color: "var(--accent)" }}>MONEY</span>
            </Link>
            <Nav variant="top" />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 py-8 text-xs faint">
          <p>Independent and politically neutral. Every number links to the council record it came from. Contains public sector information licensed under the Open Government Licence v3.0 where stated on the <Link href="/sources">Sources</Link> page. Statistics and flags are calculations, not findings; see <Link href="/sources#methodology">Methodology</Link>.</p>
        </footer>
        <Nav variant="bottom" />
      </body>
    </html>
  );
}
