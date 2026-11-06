import { cn } from "@/lib/utils";

/** The product name in the serif face. A wordmark only: no logo icon. */
export function Wordmark({ className, subtle }: { className?: string; subtle?: boolean }) {
  return (
    <span className={cn("font-heading text-[1.35rem] font-semibold leading-none tracking-tight", subtle ? "text-foreground" : "text-primary", className)}>
      Vetflow
    </span>
  );
}
