import type { ReactNode } from "react";
import { Link } from "wouter";
import type { Tone } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", danger: "text-danger", neutral: "text-foreground" };

/** One headline number with a label. Becomes a link when it has somewhere to go. */
export function Stat({ label, value, note, tone = "neutral", href, icon }: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone; href?: string; icon?: ReactNode }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground"><span>{label}</span>{icon}</div>
      <div className={cn("num mt-1 text-2xl font-medium leading-tight md:text-[1.75rem]", TONE_TEXT[tone])}>{value}</div>
      {note && <div className="mt-0.5 text-sm text-muted-foreground">{note}</div>}
    </>
  );
  const cls = "block rounded-xl border border-border bg-card p-4";
  return href ? <Link href={href} className={cn(cls, "transition-colors hover:bg-tint/50")}>{body}</Link> : <div className={cls}>{body}</div>;
}
