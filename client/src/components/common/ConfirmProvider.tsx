import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Use "danger" for actions that cannot be undone. */
  tone?: "default" | "danger";
};

type Confirm = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Confirm | null>(null);

/**
 * Every irreversible or high-impact action asks first. Call `const confirm = useConfirm()` and
 * `if (!(await confirm({ title: "..." }))) return;` so the question is one line at the call site.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>(o => new Promise<boolean>(resolve => {
    resolver.current?.(false);
    resolver.current = resolve;
    setOpts(o);
  }), []);

  const settle = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={!!opts} onOpenChange={open => { if (!open) settle(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
            {opts?.description && <AlertDialogDescription asChild><div>{opts.description}</div></AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className={cn(buttonVariants({ variant: "secondary" }))} onClick={() => settle(false)}>{opts?.cancelLabel ?? "Cancel"}</AlertDialogCancel>
            <AlertDialogAction className={cn(buttonVariants({ variant: opts?.tone === "danger" ? "destructive" : "default" }))} onClick={() => settle(true)}>
              {opts?.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Confirm {
  const c = useContext(ConfirmContext);
  if (!c) throw new Error("useConfirm must be used inside ConfirmProvider");
  return c;
}
