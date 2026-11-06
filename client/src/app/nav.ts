import {
  BarChart3, Boxes, FileText, LayoutDashboard, PawPrint, Pill, Settings, type LucideIcon,
} from "lucide-react";
import type { Permission, Role } from "@shared/permissions";

export type NavItem = {
  key: string;
  /** i18n key for the label */
  label: string;
  to: string;
  icon: LucideIcon;
  permission?: Permission;
  /** Is this item active for the given path? */
  match: (path: string) => boolean;
};

const starts = (prefix: string) => (p: string) => p === prefix || p.startsWith(`${prefix}/`);

/** Every top-level destination. What a user sees is this list filtered by their role. */
export const NAV: NavItem[] = [
  { key: "today", label: "nav.today", to: "/", icon: LayoutDashboard, match: p => p === "/" },
  { key: "patients", label: "nav.patients", to: "/patients", icon: PawPrint, permission: "clinical.read", match: p => starts("/patients")(p) || starts("/consult")(p) },
  { key: "prescriptions", label: "nav.prescriptions", to: "/prescriptions", icon: FileText, permission: "clinical.read", match: starts("/prescriptions") },
  { key: "dispensing", label: "nav.dispensing", to: "/dispensing", icon: Pill, permission: "dispense.write", match: starts("/dispensing") },
  { key: "inventory", label: "nav.inventory", to: "/inventory", icon: Boxes, permission: "catalogue.read", match: starts("/inventory") },
  { key: "reports", label: "nav.reports", to: "/reports", icon: BarChart3, permission: "reports.read", match: starts("/reports") },
  { key: "settings", label: "nav.settings", to: "/settings", icon: Settings, permission: "settings.manage", match: starts("/settings") },
];

/** Which destinations get a slot on the phone tab bar for each role. The rest go under More. */
const TAB_PRIORITY: Record<Role, string[]> = {
  admin: ["today", "patients", "inventory", "reports"],
  vet: ["today", "patients", "prescriptions", "reports"],
  pharmacist: ["today", "dispensing", "inventory", "prescriptions"],
  inventory_manager: ["today", "inventory", "dispensing", "reports"],
  viewer: ["today", "patients", "inventory", "reports"],
};

export function tabsFor(role: Role, allowed: NavItem[]): { tabs: NavItem[]; more: NavItem[] } {
  const wanted = TAB_PRIORITY[role];
  const tabs = wanted.map(k => allowed.find(n => n.key === k)).filter((n): n is NavItem => !!n).slice(0, 4);
  return { tabs, more: allowed.filter(n => !tabs.includes(n)) };
}

/** Pages that live under Inventory, shown as a tab strip. */
export const INVENTORY_TABS: Array<{ to: string; label: string; permission?: Permission }> = [
  { to: "/inventory", label: "inventory.items" },
  { to: "/inventory/receipts", label: "inventory.receipts", permission: "purchase.write" },
  { to: "/inventory/orders", label: "inventory.orders", permission: "purchase.write" },
  { to: "/inventory/suppliers", label: "inventory.suppliers" },
  { to: "/inventory/transfers", label: "inventory.transfers", permission: "transfer.write" },
  { to: "/inventory/counts", label: "inventory.counts", permission: "stock.count" },
  { to: "/inventory/vials", label: "inventory.vials" },
  { to: "/inventory/alerts", label: "inventory.alerts" },
  { to: "/inventory/import", label: "inventory.import", permission: "import.run" },
];
