import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useInvalidateStock } from "@/features/inventory/items/api";

export type DispenseRow = {
  id: string; status: "draft" | "confirmed" | "cancelled"; createdAt: string; counterReason: string | null; animalName: string | null; prescriptionId: string | null;
};

export type Allocation = { batchId: string; batchNo: string; expiryDate: string; available: string; take: string };
export type Witness = { id: string; name: string; role: string };

export type DispenseInput = {
  storeId: string;
  prescriptionId?: string;
  counterReason?: string;
  lines: Array<{ itemId: string; quantity: number }>;
  witness?: { witnessUserId: string; witnessPassword: string };
};

export const dispenseKeys = { list: (status?: string) => ["dispenses", status ?? "all"] as const, suggest: (p: object) => ["suggest", p] as const, witnesses: ["witnesses"] as const };

export const useDispenses = (status?: string) =>
  useQuery({ queryKey: dispenseKeys.list(status), queryFn: () => api.get<DispenseRow[]>("/api/dispenses", { status }) });

/** Which batches would supply this quantity, earliest expiry first. Throws a readable error when stock is short or expired. */
export const useSuggest = (p: { itemId: string; storeId: string; quantity: number }, enabled: boolean) =>
  useQuery({
    queryKey: dispenseKeys.suggest(p),
    queryFn: () => api.get<Allocation[]>("/api/stock/suggest", p),
    enabled: enabled && !!p.itemId && !!p.storeId && p.quantity > 0,
    retry: false,
    staleTime: 10_000,
  });

export const useWitnesses = (enabled: boolean) =>
  useQuery({ queryKey: dispenseKeys.witnesses, queryFn: () => api.get<Witness[]>("/api/users/witnesses"), enabled, staleTime: 5 * 60_000 });

/**
 * Creates the dispense and confirms it. Confirming is the only step that takes stock out. If confirming
 * fails (not enough stock, a wrong witness password), the draft is cancelled so nothing is left half done.
 */
export function useDispense() {
  const invalidate = useInvalidateStock();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: DispenseInput) => {
      const draft = await api.post<{ id: string }>("/api/dispenses", { storeId: v.storeId, prescriptionId: v.prescriptionId, counterReason: v.counterReason, lines: v.lines });
      try {
        return await api.post<{ id: string }>(`/api/dispenses/${draft.id}/confirm`, v.witness ?? {});
      } catch (e) {
        await api.post(`/api/dispenses/${draft.id}/cancel`).catch(() => {});
        throw e;
      }
    },
    onSuccess: () => { invalidate(); void qc.invalidateQueries({ queryKey: ["dispenses"] }); },
  });
}
