import { Bell, Search, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAlerts } from "@/features/dashboard/api";
import { useAuth } from "@/features/auth/AuthProvider";
import { useOnline } from "@/hooks/useMedia";
import { dateIST } from "@/lib/format";
import { GlobalSearch } from "./GlobalSearch";
import { Wordmark } from "./Wordmark";

/** Search, alerts and connection status. On phones it also carries the wordmark, since there is no sidebar. */
export function TopBar() {
  const { can } = useAuth();
  const online = useOnline();
  const [searchOpen, setSearchOpen] = useState(false);
  const alerts = useAlerts({ enabled: can("catalogue.read") });
  const openAlerts = alerts.data?.length ?? 0;

  // "/" opens search from anywhere, unless the user is typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && !el.isContentEditable) { e.preventDefault(); setSearchOpen(true); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur md:h-16 md:px-8">
        <Link href="/" className="flex min-h-11 items-center md:hidden" aria-label="Vetflow home"><Wordmark /></Link>
        <p className="hidden text-sm text-muted-foreground md:block">{dateIST(new Date())}</p>
        <div className="flex-1" />
        {!online && <StatusBadge tone="warn" className="gap-1"><WifiOff className="size-3.5" /> Offline</StatusBadge>}
        <Button variant="ghost" size="icon" aria-label="Search" onClick={() => setSearchOpen(true)}><Search /></Button>
        {can("catalogue.read") && (
          <Button asChild variant="ghost" size="icon" aria-label={openAlerts ? `${openAlerts} open alerts` : "Alerts"} className="relative">
            <Link href="/inventory/alerts">
              <Bell />
              {openAlerts > 0 && <span className="num absolute right-1 top-1 flex min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[11px] font-medium leading-[18px] text-white dark:text-[#0b1421]">{openAlerts > 99 ? "99+" : openAlerts}</span>}
            </Link>
          </Button>
        )}
      </header>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
