import { Search, X } from "lucide-react";
import { forwardRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentProps<"input">, "onChange" | "value" | "type"> & {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  wrapperClassName?: string;
};

/** A search box with a leading icon and a clear button. Works with keyboard-wedge barcode scanners: they just type. */
export const SearchInput = forwardRef<HTMLInputElement, Props>(function SearchInput({ value, onChange, onClear, wrapperClassName, className, placeholder = "Search", ...rest }, ref) {
  return (
    <div className={cn("relative", wrapperClassName)}>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        aria-label={rest["aria-label"] ?? placeholder}
        onChange={e => onChange(e.target.value)}
        className={cn("min-h-11 w-full rounded-md border border-input bg-card pl-10 pr-10 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden", className)}
        {...rest}
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => { onChange(""); onClear?.(); }} className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
          <X className="size-[18px]" />
        </button>
      )}
    </div>
  );
});
