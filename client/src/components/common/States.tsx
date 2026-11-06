import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { errorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function LoadingState({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 rounded-xl border border-danger/30 bg-danger-tint p-4 text-danger", className)}>
      <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 size-5 shrink-0" /><p className="font-medium">{errorMessage(error)}</p></div>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}><RefreshCw /> Try again</Button>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center", className)}>
      <div className="text-muted-foreground">{icon ?? <Inbox className="size-8" />}</div>
      <h3>{title}</h3>
      {description && <p className="max-w-md text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * Renders a query's three states so pages do not repeat them: loading, error with retry, and the data.
 * `isEmpty` lets a page show its own empty state.
 */
export function QueryBoundary<T>({ query, children, empty, rows }: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  empty?: { when: (data: T) => boolean; element: ReactNode };
  rows?: number;
}) {
  if (query.isPending) return <LoadingState rows={rows} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (empty?.when(query.data)) return <>{empty.element}</>;
  return <>{children(query.data)}</>;
}
