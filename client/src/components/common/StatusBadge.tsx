import type { ReactNode } from "react";
import type { Tone } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONES: Record<Tone, string> = {
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
  danger: "bg-danger-tint text-danger",
  neutral: "bg-tint text-muted-foreground",
};

/** A short status. Meaning is carried by the words, and colour only reinforces it. */
export function StatusBadge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}

/** Map of server status words to a tone and a plain label. */
const STATUS: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: "warn", label: "Draft" },
  approved: { tone: "ok", label: "Approved" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  confirmed: { tone: "ok", label: "Confirmed" },
  completed: { tone: "ok", label: "Completed" },
  sent: { tone: "warn", label: "Sent" },
  partially_received: { tone: "warn", label: "Part received" },
  received: { tone: "ok", label: "Received" },
  dispatched: { tone: "warn", label: "In transit" },
  open: { tone: "warn", label: "Open" },
  posted: { tone: "ok", label: "Posted" },
  empty: { tone: "neutral", label: "Empty" },
  discarded: { tone: "neutral", label: "Discarded" },
};

export function StatusText({ status }: { status: string }) {
  const s = STATUS[status] ?? { tone: "neutral" as Tone, label: status.replace(/_/g, " ") };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}
