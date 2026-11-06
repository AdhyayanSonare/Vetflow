import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { Page, PageHeader } from "@/components/common/Page";
import { INVENTORY_TABS } from "@/app/nav";
import { useAuth } from "@/features/auth/AuthProvider";
import { cn } from "@/lib/utils";

/** The frame for every inventory page: title, actions, and a scrollable tab strip between the sections. */
export function InventoryShell({ title, description, actions, children, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; back?: ReactNode }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [path] = useLocation();
  const tabs = INVENTORY_TABS.filter(x => !x.permission || can(x.permission));
  // The most specific tab wins: /inventory/receipts/new belongs to Receipts, /inventory/items/x to Items.
  const active = [...tabs].sort((a, b) => b.to.length - a.to.length).find(x => (x.to === "/inventory" ? path === "/inventory" || path.startsWith("/inventory/items") : path === x.to || path.startsWith(`${x.to}/`)));

  return (
    <Page wide>
      <nav aria-label="Inventory sections" className="no-print -mx-4 mb-5 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="flex min-w-max gap-2">
          {tabs.map(tab => (
            <li key={tab.to}>
              <Link href={tab.to} aria-current={active?.to === tab.to ? "page" : undefined}
                className={cn("inline-flex min-h-11 items-center rounded-full border px-4 text-[15px]", active?.to === tab.to ? "border-primary bg-tint font-medium text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
                {t(tab.label)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <PageHeader title={title} description={description} actions={actions} back={back} />
      {children}
    </Page>
  );
}
