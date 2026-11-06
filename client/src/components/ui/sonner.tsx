import { Toaster as Sonner, type ToasterProps } from "sonner";

// The app is light-only for now, so the toaster doesn't follow the OS theme.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--ink)",
          "--normal-border": "var(--line)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
