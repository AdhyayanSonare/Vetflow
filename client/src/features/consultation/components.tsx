import { AlertCircle, ChevronLeft, RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { AllergyChip, patientMeta, SpeciesTile } from "@/features/patients/components";
import { usePatient } from "@/features/patients/api";
import { cn } from "@/lib/utils";

/** Who the consultation is for. Always visible, so the vet never writes on the wrong record. */
export function PatientStrip({ animalId, withOwner }: { animalId: string; withOwner?: boolean }) {
  const q = usePatient(animalId);
  const a = q.data;
  if (!a) return <div className="mb-4 h-16 animate-pulse rounded-xl bg-tint" />;
  return (
    <Link href={`/patients/${a.id}`} className="mb-4 flex min-h-16 items-center gap-3 rounded-xl border border-border bg-card p-3">
      <SpeciesTile species={a.species} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{a.name}</span>
        <span className="block truncate text-sm text-muted-foreground">{patientMeta(a, withOwner ? [a.ownerName] : [])}</span>
      </span>
      <AllergyChip animal={a} />
    </Link>
  );
}

export function StepHeader({ step, total = 3, title, onBack, closeHref = "/" }: { step: number; total?: number; title: string; onBack?: () => void; closeHref?: string }) {
  return (
    <header className="mb-4 flex items-center gap-2">
      {onBack
        ? <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}><ChevronLeft /></Button>
        : <Button asChild variant="ghost" size="icon" aria-label="Close. Your draft is saved."><Link href={closeHref}><X /></Link></Button>}
      <h1 className="flex-1 text-xl">{title}</h1>
      <span className="num text-sm text-muted-foreground">{step} of {total}</span>
    </header>
  );
}

/** The primary actions of a step. It stays above the phone tab bar so the thumb can always reach it. */
export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <>
      {/* Room for the fixed bar on phones, so the last line of content is never hidden behind it. */}
      <div aria-hidden="true" className="h-24 md:hidden" />
      <div className={cn("no-print fixed inset-x-0 bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom))] z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:sticky md:bottom-0 md:mt-6 md:border-0 md:bg-transparent md:px-0 md:backdrop-blur-none", className)}>
        <div className="mx-auto flex max-w-xl gap-2 md:max-w-none md:justify-end [&>*]:flex-1 md:[&>*]:flex-none">{children}</div>
      </div>
    </>
  );
}

export function ErrorNote({ message, action, onAction }: { message: string; action?: string; onAction?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-start gap-2 rounded-lg border border-danger/30 bg-danger-tint p-3 text-danger">
      <AlertCircle className="mt-0.5 size-5 shrink-0" /><p className="min-w-0 flex-1">{message}</p>
      {action && <Button variant="secondary" size="sm" onClick={onAction}><RotateCcw /> {action}</Button>}
    </div>
  );
}

/**
 * One soft line that drifts while recording and goes flat when paused. Transform-only, and still
 * under the reduced-motion setting.
 */
export function Wave({ live }: { live: boolean }) {
  const path = "M0 24 Q 25 4 50 24 T 100 24 T 150 24 T 200 24 T 250 24 T 300 24 T 350 24 T 400 24";
  return (
    <div className="h-12 w-full overflow-hidden" role="img" aria-label={live ? "Recording in progress" : "Recording paused"}>
      <svg viewBox="0 0 200 48" preserveAspectRatio="none" className="h-full w-[200%]">
        <path d={live ? path : "M0 24 H 400"} fill="none" stroke="var(--recording)" strokeWidth="2.5" strokeLinecap="round" className={live ? "wave-line" : undefined} />
      </svg>
    </div>
  );
}

/** A row of tap-friendly choices with an "Other" free-text escape. */
export function ChipChoice({ label, options, value, onChange, allowOther = true }: { label: string; options: string[]; value: string; onChange: (v: string) => void; allowOther?: boolean }) {
  const custom = !!value && !options.includes(value);
  return (
    <div className="space-y-2">
      <p className="text-[15px] font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map(o => (
          <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(value === o ? "" : o)}
            className={cn("min-h-11 min-w-11 rounded-md border px-3 text-[15px]", value === o ? "border-primary bg-tint font-medium text-primary" : "border-border bg-card")}>{o}</button>
        ))}
      </div>
      {allowOther && (
        <input aria-label={`${label}, other`} value={custom ? value : ""} placeholder="Other" onChange={e => onChange(e.target.value)}
          className="min-h-11 w-full rounded-md border border-input bg-card px-3 text-base placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none" />
      )}
    </div>
  );
}
