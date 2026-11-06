import type { ReactNode } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** The headline of the row on phones, where each row becomes a card. One column should set this. */
  primary?: boolean;
  /** Do not show on phones. */
  hideOnPhone?: boolean;
  align?: "left" | "right";
  className?: string;
};

type Props<T> = {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Makes the whole row a link. */
  href?: (row: T) => string;
  onRowClick?: (row: T) => void;
  caption?: string;
  className?: string;
};

/**
 * A table from 768 px up, and a list of cards below that, so nothing scrolls sideways on a phone.
 * Columns are declared once and used for both.
 */
export function DataTable<T>({ rows, columns, rowKey, href, onRowClick, caption, className }: Props<T>) {
  const primary = columns.find(c => c.primary) ?? columns[0];
  const rest = columns.filter(c => c !== primary && !c.hideOnPhone);
  const interactive = !!href || !!onRowClick;

  return (
    <div className={className}>
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
        <table className="w-full border-collapse text-[15px]">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-border bg-tint/60 text-left text-sm text-muted-foreground">
              {columns.map(c => <th key={c.key} scope="col" className={cn("px-4 py-3 font-medium", c.align === "right" && "text-right", c.className)}>{c.header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const id = rowKey(row);
              const link = href?.(row);
              return (
                <tr
                  key={id}
                  className={cn("border-b border-border last:border-0", interactive && "cursor-pointer hover:bg-tint/50")}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={onRowClick ? e => { if (e.key === "Enter") onRowClick(row); } : undefined}
                >
                  {columns.map((c, i) => (
                    <td key={c.key} className={cn("px-4 py-3 align-middle", c.align === "right" && "text-right", c.className)}>
                      {link && i === 0 ? <Link href={link} className="block font-medium text-foreground hover:underline">{c.cell(row)}</Link> : c.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden" aria-label={caption}>
        {rows.map(row => {
          const id = rowKey(row);
          const link = href?.(row);
          const body = (
            <>
              <div className="font-medium">{primary.cell(row)}</div>
              {rest.length > 0 && (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  {rest.map(c => (
                    <div key={c.key} className="contents">
                      <dt className="text-muted-foreground">{c.header}</dt>
                      <dd className="min-w-0 text-right break-words">{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          );
          const cls = "block rounded-xl border border-border bg-card p-3.5 text-left w-full";
          return (
            <li key={id}>
              {link ? <Link href={link} className={cls}>{body}</Link>
                : onRowClick ? <button type="button" className={cls} onClick={() => onRowClick(row)}>{body}</button>
                : <div className={cls}>{body}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
