import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Redirect, Route, Switch } from "wouter";
import type { Permission } from "@shared/permissions";
import { Page } from "@/components/common/Page";
import { LoadingState } from "@/components/common/States";
import { EmptyState } from "@/components/common/States";
import { useAuth } from "@/features/auth/AuthProvider";
import { AppShell } from "./layout/AppShell";

const LoginPage = lazy(() => import("@/features/auth/LoginPage"));
const ResetPage = lazy(() => import("@/features/auth/ResetPage"));
const NotFoundPage = lazy(() => import("@/features/misc/NotFoundPage"));

type Page = { path: string; load: () => Promise<{ default: ComponentType }>; permission?: Permission };

/**
 * Every signed-in page. Each is loaded on demand so the first screen stays small, and each declares
 * the permission it needs. A page a role cannot use is not linked, and opening its URL shows a notice.
 */
const PAGES: Page[] = [
  { path: "/", load: () => import("@/features/dashboard/TodayPage") },
  { path: "/patients", load: () => import("@/features/patients/PatientsPage"), permission: "clinical.read" },
  { path: "/patients/:id", load: () => import("@/features/patients/PatientProfilePage"), permission: "clinical.read" },
  { path: "/consult/new", load: () => import("@/features/consultation/NewConsultationPage"), permission: "clinical.write" },
  { path: "/consult/:id", load: () => import("@/features/consultation/ConsultationPage"), permission: "clinical.write" },
  { path: "/prescriptions", load: () => import("@/features/prescriptions/PrescriptionsPage"), permission: "clinical.read" },
  { path: "/prescriptions/:id", load: () => import("@/features/prescriptions/PrescriptionDetailPage"), permission: "clinical.read" },
  { path: "/dispensing", load: () => import("@/features/dispensing/DispensingPage"), permission: "dispense.write" },
  { path: "/inventory", load: () => import("@/features/inventory/items/ItemsPage"), permission: "catalogue.read" },
  { path: "/inventory/items/:id", load: () => import("@/features/inventory/items/ItemDetailPage"), permission: "catalogue.read" },
  { path: "/inventory/receipts", load: () => import("@/features/inventory/receipts/ReceiptsPage"), permission: "purchase.write" },
  { path: "/inventory/receipts/new", load: () => import("@/features/inventory/receipts/ReceiptEditorPage"), permission: "purchase.write" },
  { path: "/inventory/receipts/:id", load: () => import("@/features/inventory/receipts/ReceiptEditorPage"), permission: "purchase.write" },
  { path: "/inventory/orders", load: () => import("@/features/inventory/orders/OrdersPage"), permission: "purchase.write" },
  { path: "/inventory/orders/:id", load: () => import("@/features/inventory/orders/OrderDetailPage"), permission: "purchase.write" },
  { path: "/inventory/suppliers", load: () => import("@/features/inventory/suppliers/SuppliersPage"), permission: "catalogue.read" },
  { path: "/inventory/transfers", load: () => import("@/features/inventory/transfers/TransfersPage"), permission: "transfer.write" },
  { path: "/inventory/transfers/:id", load: () => import("@/features/inventory/transfers/TransferDetailPage"), permission: "transfer.write" },
  { path: "/inventory/counts", load: () => import("@/features/inventory/counts/CountsPage"), permission: "stock.count" },
  { path: "/inventory/counts/:id", load: () => import("@/features/inventory/counts/CountPage"), permission: "stock.count" },
  { path: "/inventory/vials", load: () => import("@/features/inventory/vials/VialsPage"), permission: "catalogue.read" },
  { path: "/inventory/alerts", load: () => import("@/features/inventory/alerts/AlertsPage"), permission: "catalogue.read" },
  { path: "/inventory/import", load: () => import("@/features/inventory/import/ImportPage"), permission: "import.run" },
  { path: "/reports", load: () => import("@/features/reports/ReportsPage"), permission: "reports.read" },
  { path: "/settings", load: () => import("@/features/settings/UsersPage"), permission: "users.manage" },
  { path: "/settings/branches", load: () => import("@/features/settings/BranchesRoute"), permission: "settings.manage" },
  { path: "/settings/features", load: () => import("@/features/settings/FeaturesRoute"), permission: "settings.manage" },
  { path: "/settings/subscription", load: () => import("@/features/settings/SubscriptionRoute"), permission: "settings.manage" },
  { path: "/settings/audit", load: () => import("@/features/settings/AuditRoute"), permission: "audit.read" },
  { path: "/licences", load: () => import("@/features/settings/LicencesRoute") },
];

const lazyPages = PAGES.map(p => ({ ...p, Component: lazy(p.load) }));

function Guard({ permission, children }: { permission?: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (permission && !can(permission)) {
    return <Page><EmptyState title="You don't have access to this page" description="Ask your clinic administrator if you think you should." /></Page>;
  }
  return <>{children}</>;
}

const Fallback = () => <Page><LoadingState /></Page>;

export function Router() {
  const { status } = useAuth();
  if (status === "loading") return <div className="min-h-dvh"><Fallback /></div>;

  if (status === "signedOut") {
    return (
      <Suspense fallback={<div className="min-h-dvh" />}>
        <Switch>
          <Route path="/reset" component={ResetPage} />
          <Route component={LoginPage} />
        </Switch>
      </Suspense>
    );
  }

  return (
    <AppShell>
      <Suspense fallback={<Fallback />}>
        <Switch>
          <Route path="/login"><Redirect to="/" /></Route>
          {lazyPages.map(({ path, Component, permission }) => (
            <Route key={path} path={path}><Guard permission={permission}><Component /></Guard></Route>
          ))}
          <Route component={NotFoundPage} />
        </Switch>
      </Suspense>
    </AppShell>
  );
}
