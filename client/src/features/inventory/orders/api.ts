import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useInvalidateStock } from "../items/api";

export type OrderRow = { id: string; number: string; status: "draft" | "sent" | "partially_received" | "received" | "cancelled"; supplierName: string; storeName: string; expectedDate: string | null; lineCount: number; valuePaise: number; createdAt: string };
export type OrderLine = { id: string; itemId: string; code: string; itemName: string; unit: string; orderedQty: number; receivedQty: number; outstandingQty: number; unitCostPaise: number };
export type Order = Omit<OrderRow, "lineCount" | "valuePaise"> & { supplierId: string; storeId: string; notes: string | null; lines: OrderLine[] };
export type OrderInput = { supplierId: string; storeId: string; expectedDate?: string; notes?: string; lines: Array<{ itemId: string; quantity: number; unitCostPaise: number }> };
export type ReceiveInput = { invoiceNo?: string; lines: Array<{ poLineId: string; quantity: number; batchNo: string; expiryDate: string; unitCostPaise?: number }> };

export const orderKeys = { all: ["orders"] as const, list: (s?: string) => ["orders", "list", s ?? "all"] as const, one: (id: string) => ["orders", "one", id] as const };
export const useOrders = (status?: string) => useQuery({ queryKey: orderKeys.list(status), queryFn: () => api.get<OrderRow[]>("/api/purchase-orders", { status }) });
export const useOrder = (id: string) => useQuery({ queryKey: orderKeys.one(id), queryFn: () => api.get<Order>(`/api/purchase-orders/${id}`), enabled: !!id });

const useRefresh = () => { const qc = useQueryClient(); return () => { void qc.invalidateQueries({ queryKey: orderKeys.all }); void qc.invalidateQueries({ queryKey: ["receipts"] }); }; };

export function useCreateOrder() { const r = useRefresh(); return useMutation({ mutationFn: (b: OrderInput) => api.post<Order>("/api/purchase-orders", b), onSuccess: r }); }
export function useOrderAction(action: "send" | "cancel") {
  const r = useRefresh();
  return useMutation({ mutationFn: (id: string) => api.post<Order>(`/api/purchase-orders/${id}/${action}`), onSuccess: r });
}
export function useReceiveOrder(id: string) {
  const r = useRefresh();
  return useMutation({ mutationFn: (b: ReceiveInput) => api.post<{ receiptId: string; order: Order }>(`/api/purchase-orders/${id}/receive`, b), onSuccess: r });
}
export function useOrdersFromLowStock() {
  const invalidate = useInvalidateStock();
  const r = useRefresh();
  return useMutation({
    mutationFn: (b: { storeId: string; itemIds?: string[] }) => api.post<{ created: string[]; skipped: Array<{ itemId: string; name: string; reason: string }> }>("/api/purchase-orders/from-low-stock", b),
    onSuccess: () => { r(); invalidate(); },
  });
}
