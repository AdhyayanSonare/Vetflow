import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

export type Supplier = {
  id: string; name: string; contactName: string | null; phone: string | null; email: string | null; address: string | null;
  gstin: string | null; paymentTerms: string | null; outstandingPaise: number; active: boolean;
};
export type SupplierInput = Partial<Omit<Supplier, "id" | "active" | "outstandingPaise">> & { name: string; outstandingPaise?: number };

export const supplierKeys = { all: ["suppliers"] as const };
export const useSuppliers = () => useQuery({ queryKey: supplierKeys.all, queryFn: () => api.get<Supplier[]>("/api/suppliers"), staleTime: 60_000 });

export function useSaveSupplier(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SupplierInput) => (id ? api.patch<Supplier>(`/api/suppliers/${id}`, body) : api.post<Supplier>("/api/suppliers", body)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: supplierKeys.all }); },
  });
}
