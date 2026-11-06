import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Page, PageHeader } from "@/components/common/Page";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/settings", label: "Users" },
  { to: "/settings/branches", label: "Branches" },
  { to: "/settings/features", label: "Features" },
  { to: "/settings/subscription", label: "Subscription" },
  { to: "/settings/audit", label: "Audit log" },
  { to: "/licences", label: "Licences" },
];

export function SettingsShell({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  const [path] = useLocation();
  return (
    <Page>
      <nav aria-label="Settings sections" className="no-print -mx-4 mb-5 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="flex min-w-max gap-2">{TABS.map(t => (
          <li key={t.to}><Link href={t.to} aria-current={path === t.to ? "page" : undefined} className={cn("inline-flex min-h-11 items-center rounded-full border px-4 text-[15px]", path === t.to ? "border-primary bg-tint font-medium text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground")}>{t.label}</Link></li>
        ))}</ul>
      </nav>
      <PageHeader title={title} description={description} actions={actions} />
      {children}
    </Page>
  );
}
