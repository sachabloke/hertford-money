"use client";
import { useState } from "react";

export function AiExplain({ question }: { question: string }) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "off" | "error"; text?: string }>({ status: "idle" });
  async function run() {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) });
      const j = await res.json();
      if (j.disabled) setState({ status: "off" }); else if (j.error) setState({ status: "error", text: j.error }); else setState({ status: "done", text: j.text });
    } catch (e) { setState({ status: "error", text: (e as Error).message }); }
  }
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#9d4ec4" }}>AI explanation (optional)</div>
        {state.status === "idle" && <button className="btn" onClick={run}>Explain in plain English</button>}
      </div>
      {state.status === "loading" && <p className="mt-2 text-sm muted">Writing…</p>}
      {state.status === "off" && <p className="mt-2 text-sm muted">AI explanations are switched off on this server (no API key configured). The numbers above are complete without it.</p>}
      {state.status === "error" && <p className="mt-2 text-sm" style={{ color: "var(--serious)" }}>Could not get an explanation: {state.text}</p>}
      {state.status === "done" && <><p className="mt-2 whitespace-pre-line text-sm">{state.text}</p><p className="mt-2 text-xs faint">Written by an AI model from the numbers and records above only. It cannot add facts; if it seems to, trust the records.</p></>}
    </div>
  );
}
