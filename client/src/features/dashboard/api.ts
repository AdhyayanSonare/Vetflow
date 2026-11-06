import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";

export type Alert = { id: string; kind: string; severity: "info" | "warning" | "critical"; message: string; createdAt: string; resolvedAt: string | null };

export type Dashboard = {
  stockValuePaise: number;
  itemsInStock: number;
  valueExpiring30Paise: number;
  expiredBatches: number;
  expiring30: number;
  expiring60: number;
  expiring90: number;
  activeItems: number;
  lowStock: number;
  pendingPurchases: number;
  openAlerts: number;
  topConsumed: Array<{ item: string; quantity: number; unit: string }>;
  consumptionByDepartment: Array<{ department: string; quantity: number }>;
  recentMovements: Array<{ id: number; at: string; type: string; quantity: number; item: string; user: string | null; reason: string | null }>;
};

export const dashboardKeys = {
  summary: ["dashboard"] as const,
  alerts: (all = false) => ["alerts", all ? "all" : "open"] as const,
};

export const useDashboard = (enabled = true) =>
  useQuery({ queryKey: dashboardKeys.summary, queryFn: () => api.get<Dashboard>("/api/dashboard"), enabled, refetchInterval: 120_000 });

export const useAlerts = (opts: { all?: boolean; enabled?: boolean } = {}) =>
  useQuery({
    queryKey: dashboardKeys.alerts(opts.all),
    queryFn: () => api.get<Alert[]>("/api/alerts", { all: opts.all ? "true" : undefined }),
    enabled: opts.enabled ?? true,
    refetchInterval: 60_000,
  });
