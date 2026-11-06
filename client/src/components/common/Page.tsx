import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The standard page container: width, padding, and room for the phone tab bar. */
export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-4 pt-4 md:px-8 md:pt-8 page-pad-bottom", wide ? "max-w-[1400px]" : "max-w-6xl", className)}>{children}</div>;
}

/** Title, optional description, and actions. Actions wrap under the title on narrow screens. */
export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-col gap-3 md:mb-7 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="break-words">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
    </header>
  );
}

/** A titled block on a page. */
export function Section({ title, description, actions, children, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mb-7", className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title && <h2>{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2 no-print">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-border bg-card", className)}>{children}</div>;
}
