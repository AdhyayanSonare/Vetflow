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
