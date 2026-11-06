import { useId, type ComponentProps, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * A labelled form field: label above, hint and error below. The control gets the id so the label
 * is announced by screen readers and tapping the label focuses it.
 */
export function Field({ label, hint, error, required, className, children }: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined }) => ReactNode;
}) {
  const id = useId();
  const note = error ?? (typeof hint === "string" ? hint : undefined);
  const noteId = note || hint ? `${id}-note` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-[15px] font-medium">
        {label}{required && <span aria-hidden="true" className="text-danger"> *</span>}
      </Label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": noteId })}
      {error ? <p id={noteId} role="alert" className="text-sm text-danger">{error}</p>
        : hint ? <p id={noteId} className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

type TextProps = Omit<ComponentProps<typeof Input>, "id"> & { label: string; hint?: ReactNode; error?: string; wrapperClassName?: string };

export function TextField({ label, hint, error, required, wrapperClassName, ...input }: TextProps) {
  return <Field label={label} hint={hint} error={error} required={required} className={wrapperClassName}>{p => <Input {...p} required={required} {...input} />}</Field>;
}

export function TextAreaField({ label, hint, error, required, wrapperClassName, ...input }: Omit<ComponentProps<typeof Textarea>, "id"> & { label: string; hint?: ReactNode; error?: string; wrapperClassName?: string }) {
  return <Field label={label} hint={hint} error={error} required={required} className={wrapperClassName}>{p => <Textarea {...p} {...input} />}</Field>;
}

/** A plain native select. Native selects give phones their own picker, which is the best control there. */
export function NativeSelect({ label, hint, error, required, wrapperClassName, children, ...select }:
  Omit<ComponentProps<"select">, "id"> & { label: string; hint?: ReactNode; error?: string; wrapperClassName?: string }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={wrapperClassName}>
      {p => (
        <select
          {...p}
          {...select}
          className={cn("min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none disabled:opacity-60", select.className)}
        >
          {children}
        </select>
      )}
    </Field>
  );
}

/** A checkbox row with a large tap area. */
export function CheckRow({ label, description, ...input }: Omit<ComponentProps<"input">, "type" | "id"> & { label: string; description?: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md py-1.5">
      <input id={id} type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--brand)]" {...input} />
      <span className="min-w-0"><span className="block text-[15px] font-medium">{label}</span>{description && <span className="block text-sm text-muted-foreground">{description}</span>}</span>
    </label>
  );
}
