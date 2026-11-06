import type { ReactNode } from "react";
import { BottomTabs } from "./BottomTabs";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

/** The frame around every signed-in page. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground no-print">Skip to content</a>
      <Sidebar />
      <div className="md:pl-[72px] lg:pl-64">
        <TopBar />
        <main id="main" tabIndex={-1} className="outline-none">{children}</main>
      </div>
      <BottomTabs />
    </div>
  );
}
