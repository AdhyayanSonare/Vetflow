import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/lib/theme";

/** Toasts follow the app theme and sit above the phone tab bar. */
const Toaster = (props: ToasterProps) => {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      position="top-center"
      offset={{ top: 12 }}
      closeButton
      toastOptions={{ classNames: { toast: "!bg-card !text-foreground !border-border !shadow-lg !text-[15px]" } }}
      {...props}
    />
  );
};

export { Toaster };
