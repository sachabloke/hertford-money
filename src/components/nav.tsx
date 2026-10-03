"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/money", label: "Money" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/contracts", label: "Contracts" },
  { href: "/decisions", label: "Decisions" },
  { href: "/investigate", label: "Investigate" },
  { href: "/ask", label: "Ask" },
  { href: "/sources", label: "Sources" },
];

export function Nav({ variant }: { variant: "top" | "bottom" }) {
  const path = usePathname();
  const active = (h: string) => path === h || path.startsWith(h + "/");
  if (variant === "top") {
    return (
      <nav className="hidden gap-1 md:flex" aria-label="Main">
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} className="rounded-lg px-3 py-1.5 text-sm no-underline hover:no-underline" style={{ background: active(i.href) ? "var(--surface-2)" : "transparent", color: active(i.href) ? "var(--text)" : "var(--text-2)", fontWeight: active(i.href) ? 600 : 500 }}>{i.label}</Link>
        ))}
      </nav>
    );
  }
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t md:hidden" style={{ background: "var(--bg)", borderColor: "var(--border)", paddingBottom: "env(safe-area-inset-bottom)" }} aria-label="Main">
      <div className="grid grid-cols-7">
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} className="flex flex-col items-center py-2 text-[10px] no-underline hover:no-underline" style={{ color: active(i.href) ? "var(--accent-ink)" : "var(--text-2)", fontWeight: active(i.href) ? 700 : 500 }}>{i.label}</Link>
        ))}
      </div>
    </nav>
  );
}
