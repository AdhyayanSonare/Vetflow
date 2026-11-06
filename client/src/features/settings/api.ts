import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Role } from "@shared/permissions";
import { api } from "@/api/client";
import { authKeys } from "@/features/auth/AuthProvider";

export type StaffUser = { id: string; email: string; name: string; role: Role; active: boolean; createdAt: string; branchIds: string[] };
export type Branch = { id: string; name: string; active: boolean };
export type Settings = {
  voiceEnabled: boolean; barcodeEnabled: boolean; allowNegativeOverride: boolean; expiryAlertDays: number[];
  transcriptRetentionDays: number; asrDefaultLanguage: string;
};
export type Subscription = { plan: string; billingPeriod: "monthly" | "quarterly"; nextInvoiceDate: string | null; invoices: Array<{ id: string; number: string; periodStart: string; periodEnd: string; amountPaise: number }> };
export type Licences = { models: Array<{ name: string; by: string; licence: string; use: string; url: string }>; software: string[] };

export const useUsers = () => useQuery({ queryKey: ["users"], queryFn: () => api.get<StaffUser[]>("/api/users") });
export const useBranches = () => useQuery({ queryKey: ["branches"], queryFn: () => api.get<Branch[]>("/api/branches"), staleTime: 60_000 });
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/api/settings") });
export const useSubscription = () => useQuery({ queryKey: ["subscription"], queryFn: () => api.get<Subscription>("/api/subscription") });
export const useLicences = () => useQuery({ queryKey: ["licences"], queryFn: () => api.get<Licences>("/api/licences"), staleTime: Infinity });

export function useSaveUser(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Record<string, unknown>) => (id ? api.patch<StaffUser>(`/api/users/${id}`, b) : api.post<StaffUser>("/api/users", b)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["users"] }); },
  });
}
export function useAddBranch() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { name: string; storeName?: string }) => api.post("/api/branches", b), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["branches"] }); void qc.invalidateQueries({ queryKey: ["stores"] }); } });
}
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Partial<Settings>) => api.patch<Settings>("/api/settings", b),
    onSuccess: s => { qc.setQueryData(["settings"], s); void qc.invalidateQueries({ queryKey: authKeys.features }); },
  });
}
export function useSaveSubscription() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: { plan: string; billingPeriod: string; nextInvoiceDate?: string | null }) => api.put("/api/subscription", b), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["subscription"] }); } });
}
