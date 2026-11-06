import { useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import { api, withQuery } from "@/api/client";
import { DataTable, type Column } from "@/components/common/DataTable";
import { EmptyState, QueryBoundary } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { dateIST, money, qty } from "@/lib/format";

export type ReportColumn = { key: string; label: string; type?: "money" | "qty" | "text" | "date" };
export type Report = { title: string; columns: ReportColumn[]; rows: Array<Record<string, unknown>> };
export type ReportFilters = { from?: string; to?: string; asOf?: string; storeId?: string; days?: number };

const MAX_ROWS = 500;

export const useReport = (name: string, filters: ReportFilters) =>
  useQuery({ queryKey: ["report", name, filters], queryFn: () => api.get<Report>(`/api/reports/${name}`, filters), placeholderData: prev => prev });

const cell = (c: ReportColumn, v: unknown) => {
  if (v === null || v === undefined || v === "") return <span className="text-muted-foreground">—</span>;
  if (c.type === "money" && typeof v === "number") return <span className="num">{money(v)}</span>;
  if (c.type === "qty" && typeof v === "number") return <span className="num">{qty(v)}</span>;
  if (c.type === "date" && typeof v === "string") return dateIST(v);
  return <span className={typeof v === "number" ? "num" : undefined}>{String(v)}</span>;
};

/** One report as a table, with export links. Exports use the same filters, so what is on screen is what is downloaded. */
export function ReportView({ name, filters, showExports = true }: { name: string; filters: ReportFilters; showExports?: boolean }) {
  const q = useReport(name, filters);
  const link = (format: "csv" | "xlsx") => withQuery(`/api/reports/${name}`, { ...filters, format });
  return (
    <QueryBoundary query={q} empty={{ when: r => r.rows.length === 0, element: <EmptyState title="No rows for these filters" description="Try a wider date range or remove a filter." /> }}>
      {r => {
        const rows = r.rows.slice(0, MAX_ROWS);
        const columns: Column<Record<string, unknown>>[] = r.columns.map((c, i) => ({
          key: c.key, header: c.label, primary: i === 0, align: c.type === "money" || c.type === "qty" ? "right" : "left", cell: row => cell(c, row[c.key]),
          hideOnPhone: i > 3,
        }));
        return (
          <div>
            <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{r.rows.length.toLocaleString("en-IN")} {r.rows.length === 1 ? "row" : "rows"}{r.rows.length > MAX_ROWS ? `. Showing the first ${MAX_ROWS}. Export to see all of them.` : ""}</p>
              {showExports && (
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="secondary" size="sm"><a href={link("csv")} download><Download /> CSV</a></Button>
                  <Button asChild variant="secondary" size="sm"><a href={link("xlsx")} download><Download /> Excel</a></Button>
                  <Button variant="secondary" size="sm" onClick={() => window.print()}><Printer /> Print</Button>
                </div>
              )}
            </div>
            <h2 className="print-only mb-2">{r.title}</h2>
            <DataTable rows={rows} columns={columns} rowKey={(row) => String(rows.indexOf(row))} caption={r.title} />
          </div>
        );
      }}
    </QueryBoundary>
  );
}
