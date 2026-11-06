import { LogOut, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { ROLE_LABEL } from "@shared/permissions";
import { useAuth } from "@/features/auth/AuthProvider";
import { initials } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { NAV } from "../nav";
import { Wordmark } from "./Wordmark";

/**
 * Navigation for tablets and desktops. From 1024 px it is a full sidebar with labels; from 768 px
 * it narrows to an icon rail, so content keeps its width. Phones use the tab bar instead.
 */
export function Sidebar() {
  const { t } = useTranslation();
  const [path] = useLocation();
  const { user, can, signOut } = useAuth();
  const { resolved, setTheme } = useTheme();
  const items = NAV.filter(n => !n.permission || can(n.permission));

  return (
    <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-[72px] flex-col border-r border-border bg-card md:flex lg:w-64">
      <div className="flex h-16 items-center justify-center px-4 lg:justify-start">
        <Wordmark className="hidden lg:inline" />
        <Wordmark className="lg:hidden text-2xl" subtle />
      </div>

      <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {items.map(item => {
          const active = item.match(path);
          return (
            <Link
              key={item.key}
              href={item.to}
              title={t(item.label)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center justify-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors lg:justify-start",
                active ? "bg-tint text-primary" : "text-muted-foreground hover:bg-tint/60 hover:text-foreground",
              )}
            >
              <item.icon className="size-5 shrink-0" />
              <span className="hidden lg:inline">{t(item.label)}</span>
              <span className="sr-only lg:hidden">{t(item.label)}</span>
            </Link>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-border p-3">
        <button
          type="button"
          onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
          className="flex min-h-11 w-full items-center justify-center gap-3 rounded-lg px-3 text-[15px] text-muted-foreground hover:bg-tint/60 hover:text-foreground lg:justify-start"
          title={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {resolved === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
          <span className="hidden lg:inline">{resolved === "dark" ? "Light theme" : "Dark theme"}</span>
        </button>
        <Link href="/licences" className="hidden px-3 py-1 text-xs text-muted-foreground hover:text-foreground lg:block">Licences</Link>
        {user && (
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tint text-sm font-semibold text-primary">{initials(user.name)}</span>
            <div className="hidden min-w-0 flex-1 lg:block">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</p>
            </div>
            <button type="button" onClick={() => void signOut()} title={t("common.signOut")} aria-label={t("common.signOut")} className="hidden size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-tint hover:text-foreground lg:flex">
              <LogOut className="size-[18px]" />
            </button>
          </div>
        )}
        {user && (
          <button type="button" onClick={() => void signOut()} title={t("common.signOut")} aria-label={t("common.signOut")} className="flex min-h-11 w-full items-center justify-center rounded-lg text-muted-foreground hover:bg-tint hover:text-foreground lg:hidden">
            <LogOut className="size-5" />
          </button>
        )}
      </div>
    </aside>
  );
}
