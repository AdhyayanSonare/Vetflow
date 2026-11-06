import { LogOut, Menu, Mic, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { ROLE_LABEL } from "@shared/permissions";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { NAV, tabsFor, type NavItem } from "../nav";

/**
 * Phone navigation: four destinations for the user's role, a round Record button in the centre for
 * anyone who can write clinical notes, and a More sheet for everything else. 64 px tall, above the
 * home indicator, every target at least 44 px.
 */
export function BottomTabs() {
  const { t } = useTranslation();
  const [path] = useLocation();
  const { user, can, signOut } = useAuth();
  const { resolved, setTheme } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  if (!user) return null;

  const allowed = NAV.filter(n => !n.permission || can(n.permission));
  const { tabs, more } = tabsFor(user.role, allowed);
  const canRecord = can("clinical.write");
  const left = canRecord ? tabs.slice(0, 2) : tabs.slice(0, 2);
  const right = tabs.slice(2);

  const tab = (item: NavItem) => {
    const active = item.match(path);
    return (
      <Link
        key={item.key}
        href={item.to}
        aria-current={active ? "page" : undefined}
        className={cn("flex min-h-[var(--nav-h)] flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium", active ? "text-primary" : "text-muted-foreground")}
      >
        <item.icon className="size-[22px]" />
        <span className="max-w-full truncate">{t(item.label)}</span>
      </Link>
    );
  };

  return (
    <>
      <nav aria-label="Main" className="no-print safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card md:hidden">
        <div className="mx-auto flex h-[var(--nav-h)] max-w-xl items-stretch">
          {left.map(tab)}
          {canRecord && (
            <div className="flex flex-1 items-center justify-center">
              <Link
                href="/consult/new"
                aria-label={t("nav.record")}
                className="-mt-6 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background active:scale-95"
              >
                <Mic className="size-6" />
              </Link>
            </div>
          )}
          {right.map(tab)}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label={t("nav.more")}
            className="flex min-h-[var(--nav-h)] flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium text-muted-foreground"
          >
            <Menu className="size-[22px]" />
            <span>{t("nav.more")}</span>
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
          <SheetHeader className="px-0">
            <SheetTitle>{user.name}</SheetTitle>
            <SheetDescription>{ROLE_LABEL[user.role]}</SheetDescription>
          </SheetHeader>
          <ul className="space-y-1">
            {more.map(item => (
              <li key={item.key}>
                <Link href={item.to} onClick={() => setMoreOpen(false)} className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-base hover:bg-tint">
                  <item.icon className="size-5 text-muted-foreground" />{t(item.label)}
                </Link>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => setTheme(resolved === "dark" ? "light" : "dark")} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-base hover:bg-tint">
                {resolved === "dark" ? <Sun className="size-5 text-muted-foreground" /> : <Moon className="size-5 text-muted-foreground" />}
                {resolved === "dark" ? "Light theme" : "Dark theme"}
              </button>
            </li>
            <li>
              <button type="button" onClick={() => void signOut()} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-base hover:bg-tint">
                <LogOut className="size-5 text-muted-foreground" />{t("common.signOut")}
              </button>
            </li>
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
