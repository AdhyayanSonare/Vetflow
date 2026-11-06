import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useInvalidateStock } from "../items/api";

export type TransferRow = { id: string; status: "draft" | "dispatched" | "received" | "cancelled"; fromStore: string; toStore: string; createdAt: string; hasDiscrepancy: boolean };
export type TransferLine = { id: string; itemId: string; itemName: string; batchId: string; batchNo: string; sentQty: number; receivedQty: number | null; discrepancyReason: string | null };
export type Transfer = { id: string; status: TransferRow["status"]; fromStoreId: string; fromStore: string; toStoreId: string; toStore: string; createdAt: string; dispatchedAt: string | null; receivedAt: string | null; lines: TransferLine[] };

export const transferKeys = { list: (s?: string) => ["transfers", "list", s ?? "all"] as const, one: (id: string) => ["transfers", "one", id] as const };
export const useTransfers = (status?: string) => useQuery({ queryKey: transferKeys.list(status), queryFn: () => api.get<TransferRow[]>("/api/transfers", { status }) });
export const useTransfer = (id: string) => useQuery({ queryKey: transferKeys.one(id), queryFn: () => api.get<Transfer>(`/api/transfers/${id}`), enabled: !!id });

export function useCreateTransfer() {
  const invalidate = useInvalidateStock();
  return useMutation({ mutationFn: (b: { fromStoreId: string; toStoreId: string; lines: Array<{ itemId: string; quantity: number }> }) => api.post<Transfer>("/api/transfers", b), onSuccess: invalidate });
}
export function useDispatchTransfer() {
  const invalidate = useInvalidateStock();
  return useMutation({ mutationFn: (id: string) => api.post<Transfer>(`/api/transfers/${id}/dispatch`), onSuccess: invalidate });
}
export function useReceiveTransfer(id: string) {
  const invalidate = useInvalidateStock();
  return useMutation({ mutationFn: (lines: Array<{ lineId: string; receivedQty: number; reason?: string }>) => api.post<Transfer>(`/api/transfers/${id}/receive`, { lines }), onSuccess: invalidate });
}
