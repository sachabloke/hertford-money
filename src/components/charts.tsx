"use client";
/**
 * Charts follow the dataviz method: thin marks, one axis, fixed colour per entity, hover tooltip,
 * legend for >= 2 series, and every chart sits next to a table (relief for low-contrast slots).
 */
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { gbp } from "@/lib/format";

const axis = { stroke: "var(--border)", tick: { fill: "var(--text-3)", fontSize: 11 } };
const tipStyle = { contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }, labelStyle: { color: "var(--text-2)" }, itemStyle: { color: "var(--text)" } };
const fmtY = (v: number) => gbp(v, { compact: true });

export interface Series { key: string; name: string; colour: string }

export function TimeSeries({ data, series, xKey = "month", height = 240, kind = "bar" }: { data: Array<Record<string, number | string>>; series: Series[]; xKey?: string; height?: number; kind?: "bar" | "line" }) {
  if (!data.length) return null;
  const Chart = kind === "line" ? LineChart : BarChart;
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <Chart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
          <XAxis dataKey={xKey} {...axis} tickLine={false} minTickGap={24} />
          <YAxis {...axis} tickLine={false} axisLine={false} tickFormatter={fmtY} width={56} />
          <Tooltip {...tipStyle} formatter={(v) => gbp(Number(v))} cursor={{ fill: "var(--surface-2)" }} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s) => kind === "line"
            ? <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.colour} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: s.colour }} activeDot={{ r: 5 }} connectNulls />
            : <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.colour} stackId="a" radius={[3, 3, 0, 0]} maxBarSize={28} />)}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

export function HBars({ data, colour = "#2a78d6", height }: { data: Array<{ name: string; total: number }>; colour?: string; height?: number }) {
  if (!data.length) return null;
  const h = height ?? Math.max(120, data.length * 28 + 20);
  return (
    <div style={{ width: "100%", height: h }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={150} {...axis} tickLine={false} axisLine={false} tick={{ fill: "var(--text-2)", fontSize: 11 }} tickFormatter={(v: string) => (v.length > 24 ? v.slice(0, 23) + "…" : v)} />
          <Tooltip {...tipStyle} formatter={(v) => gbp(Number(v))} cursor={{ fill: "var(--surface-2)" }} />
          <Bar dataKey="total" fill={colour} radius={[0, 3, 3, 0]} maxBarSize={18} label={{ position: "right", fill: "var(--text-2)", fontSize: 11, formatter: (v: unknown) => gbp(Number(v), { compact: true }) }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
