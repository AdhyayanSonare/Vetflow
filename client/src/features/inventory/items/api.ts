import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

export type Item = {
  id: string;
  code: string;
  genericName: string;
  brandName: string | null;
  strength: string | null;
  unit: string;
  manufacturer: string | null;
  categoryId: string | null;
  defaultSupplierId: string | null;
  minQty: number;
  reorderQty: number;
  storageLocation: string | null;
  barcode: string | null;
  multiDose: boolean;
  doseVolumeMl: number | null;
  beyondUseDays: number | null;
  controlled: boolean;
  active: boolean;
  onHand?: number;
};

export type ItemInput = Partial<Omit<Item, "id" | "code" | "onHand">> & { genericName: string; unit: string; confirmSimilar?: boolean };

export type StockRow = {
  itemId: string; code: string; itemName: string; unit: string; batchId: string; batchNo: string; expiryDate: string; expired: boolean;
  storeId: string; storeName: string; quantity: number; unitCostPaise: number;
};

export type LedgerRow = {
  id: number; at: string; type: string; quantity: number; itemName: string; batchNo: string; fromStore: string | null; toStore: string | null;
  userName: string | null; reason: string | null; reference: string | null; override: boolean;
};

export type Category = { id: string; name: string };
export type Store = { id: string; name: string; kind: string; branchId: string | null; active: boolean };

export const itemLabel = (i: Pick<Item, "genericName" | "strength">) => `${i.genericName}${i.strength ? ` ${i.strength}` : ""}`;

export const itemKeys = {
  all: ["items"] as const,
  list: (p: object) => ["items", "list", p] as const,
  one: (id: string) => ["items", "one", id] as const,
  stock: (p: object) => ["stock", p] as const,
  ledger: (id: string) => ["ledger", id] as const,
  categories: ["categories"] as const,
  stores: ["stores"] as const,
  lowStock: ["low-stock"] as const,
};

export type ItemQuery = { q?: string; storeId?: string; limit?: number; offset?: number; includeInactive?: boolean };

export const useItems = (p: ItemQuery, enabled = true) =>
  useQuery({
    queryKey: itemKeys.list(p),
    queryFn: () => api.get<Item[]>("/api/items", { q: p.q, storeId: p.storeId, limit: p.limit ?? 100, offset: p.offset, includeInactive: p.includeInactive ? "true" : undefined }),
    enabled,
    placeholderData: prev => prev,
  });

export const useItem = (id: string) => useQuery({ queryKey: itemKeys.one(id), queryFn: () => api.get<Item>(`/api/items/${id}`) });

export const useStock = (p: { itemId?: string; storeId?: string }, enabled = true) =>
  useQuery({ queryKey: itemKeys.stock(p), queryFn: () => api.get<StockRow[]>("/api/stock", p), enabled });

export const useLedger = (itemId: string, enabled: boolean) =>
  useQuery({ queryKey: itemKeys.ledger(itemId), queryFn: () => api.get<LedgerRow[]>("/api/ledger", { itemId, limit: 50 }), enabled });

export const useCategories = () => useQuery({ queryKey: itemKeys.categories, queryFn: () => api.get<Category[]>("/api/categories"), staleTime: 5 * 60_000 });
export const useStores = () => useQuery({ queryKey: itemKeys.stores, queryFn: () => api.get<Store[]>("/api/stores"), staleTime: 5 * 60_000 });

export type LowStockRow = { itemId: string; code: string; itemName: string; unit: string; minQty: number; onHand: number; suggestedReorder: number; supplierId: string | null };
export const useLowStock = () => useQuery({ queryKey: itemKeys.lowStock, queryFn: () => api.get<LowStockRow[]>("/api/low-stock") });

/** Stock changes touch many screens, so everything stock-related is refreshed together. */
export function useInvalidateStock() {
  const qc = useQueryClient();
  return () => {
    for (const key of ["items", "stock", "ledger", "low-stock", "dashboard", "alerts", "receipts", "orders", "transfers", "counts", "vials", "prescriptions", "dispenses"]) void qc.invalidateQueries({ queryKey: [key] });
  };
}

export function useCreateItem() {
  const invalidate = useInvalidateStock();
  return useMutation({ mutationFn: (body: ItemInput) => api.post<Item>("/api/items", body), onSuccess: invalidate });
}

export function useUpdateItem(id: string) {
  const invalidate = useInvalidateStock();
  return useMutation({ mutationFn: (body: Partial<ItemInput>) => api.patch<Item>(`/api/items/${id}`, body), onSuccess: invalidate });
}
