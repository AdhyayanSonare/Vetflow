import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Datum = { name: string; value: number };

/** A horizontal bar chart of the most used items. Colours come from the theme variables, so it follows light and dark. */
export function ConsumptionChart({ data }: { data: Datum[] }) {
  const rows = data.slice(0, 6).map(d => ({ ...d, name: d.name.length > 22 ? `${d.name.slice(0, 21)}…` : d.name }));
  return (
    <div className="rounded-xl border border-border bg-card p-3" role="img" aria-label={`Bar chart of the most used items: ${rows.map(r => `${r.name} ${r.value}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 44)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid horizontal={false} stroke="var(--hairline)" />
          <XAxis type="number" tick={{ fill: "var(--muted-ink)", fontSize: 12 }} stroke="var(--hairline)" allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={118} tick={{ fill: "var(--ink)", fontSize: 12 }} stroke="var(--hairline)" />
          <Tooltip cursor={{ fill: "var(--tint)" }} contentStyle={{ background: "var(--raised)", border: "1px solid var(--hairline)", borderRadius: 8, color: "var(--ink)" }} />
          <Bar dataKey="value" fill="var(--brand)" radius={[0, 4, 4, 0]} barSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
