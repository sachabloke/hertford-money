"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SearchBox({ placeholder, initial = "", action = "/search" }: { placeholder?: string; initial?: string; action?: string }) {
  const r = useRouter();
  const [q, setQ] = useState(initial);
  return (
    <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) r.push(`${action}?q=${encodeURIComponent(q.trim())}`); }}>
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder ?? "Search"} aria-label="Search or ask" enterKeyHint="search" />
      <button className="btn btn-primary" type="submit">Go</button>
    </form>
  );
}
