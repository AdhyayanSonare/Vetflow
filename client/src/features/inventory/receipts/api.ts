import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useInvalidateStock } from "../items/api";

export type ReceiptRow = { id: string; supplierName: string; invoiceNo: string | null; status: "draft" | "confirmed" | "cancelled"; createdAt: string; lineCount: number };
export type ReceiptLine = { id: string; itemId: string; itemName: string; batchNo: string; expiryDate: string; mfgDate: string | null; quantity: number; unitCostPaise: number };
export type Receipt = {
  id: string; supplierId: string; supplierName: string; storeId: string; invoiceNo: string | null; invoiceDate: string | null; status: ReceiptRow["status"];
  taxPaise: number; discountPaise: number; createdAt: string; confirmedAt: string | null; attachmentId: string | null; poId: string | null; lines: ReceiptLine[];
};
export type ReceiptInput = {
  supplierId: string; storeId: string; invoiceNo?: string; invoiceDate?: string; attachmentId?: string;
  lines: Array<{ itemId: string; batchNo: string; expiryDate: string; mfgDate?: string; quantity: number; unitCostPaise: number }>;
};

export const receiptKeys = { all: ["receipts"] as const, list: (s?: string) => ["receipts", "list", s ?? "all"] as const, one: (id: string) => ["receipts", "one", id] as const };

export const useReceipts = (status?: string) => useQuery({ queryKey: receiptKeys.list(status), queryFn: () => api.get<ReceiptRow[]>("/api/receipts", { status }) });
export const useReceipt = (id: string) => useQuery({ queryKey: receiptKeys.one(id), queryFn: () => api.get<Receipt>(`/api/receipts/${id}`), enabled: !!id });

export function useSaveReceipt() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: ReceiptInput) => api.post<Receipt>("/api/receipts", b), onSuccess: () => { void qc.invalidateQueries({ queryKey: receiptKeys.all }); } });
}
export function useConfirmReceipt() {
  const invalidate = useInvalidateStock();
  return useMutation({ mutationFn: (id: string) => api.post<Receipt>(`/api/receipts/${id}/confirm`), onSuccess: invalidate });
}
export function useCancelReceipt() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.delete(`/api/receipts/${id}`), onSuccess: () => { void qc.invalidateQueries({ queryKey: receiptKeys.all }); } });
}

/** Upload an invoice scan. The server checks the real file type, not the name. */
export const uploadAttachment = (file: File) =>
  api.post<{ id: string; filename: string }>("/api/attachments", undefined, { raw: file, contentType: file.type || "application/octet-stream", headers: { "X-Filename": encodeURIComponent(file.name) } });
