/**
 * Optional AI explanation of a deterministic Ask result. The model receives ONLY the computed
 * result (numbers, tables, evidence labels) and is instructed to restate it; it is never asked to
 * calculate, estimate or retrieve anything. Disabled unless ANTHROPIC_API_KEY is set.
 */
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { ask } from "@/lib/ask";

const SYSTEM = `You explain council spending figures for Hertford Money, an independent, politically neutral transparency site.
You will receive a JSON object computed by code from councils' published records. Write a short plain-English explanation (under 150 words) for a resident.
Rules:
- Use ONLY numbers and facts present in the JSON. Never introduce other figures, dates, names or causes.
- If the JSON says evidence is insufficient, say so plainly.
- Do not speculate about motives, waste, fraud or politics. Do not say a council did well or badly.
- Where the JSON notes a limitation (e.g. payment files are not budgets), repeat it briefly.
- Refer to evidence by the labels given, e.g. "see the supplier page for X".
- No headings, no bullet points, no markdown.`;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ disabled: true });
  let question: string;
  try { ({ question } = await req.json()); } catch { return NextResponse.json({ error: "bad request" }, { status: 400 }); }
  if (!question || typeof question !== "string" || question.length > 300) return NextResponse.json({ error: "bad question" }, { status: 400 });
  const result = await ask(question);
  const payload = { question: result.question, answer: result.answer, numbers: result.numbers, tables: result.tables.map((t) => ({ ...t, rows: t.rows.slice(0, 12) })), why: result.why, insufficient: result.insufficient, evidenceLabels: result.evidence.map((e) => e.label), scope: result.scope };
  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: process.env.HM_AI_MODEL ?? "claude-opus-5-5",
      max_tokens: 1024,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });
    if (response.stop_reason === "refusal") return NextResponse.json({ error: "The model declined to answer." });
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    return NextResponse.json({ text, model: response.model });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "Rate limited, try again shortly." }, { status: 429 });
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: `API error ${e.status}` }, { status: 502 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
