import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

export type PrescriptionLine = {
  id: string;
  itemId: string | null;
  drugText: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
  quantity: number | null;
  unmatched: boolean;
  dispensed: number;
};

export type Prescription = {
  id: string;
  consultationId: string;
  animalId: string;
  animalName: string;
  animalCode: string;
  species: string;
  breed: string | null;
  weightKg: number | null;
  allergies: string | null;
  ownerName: string;
  ownerPhone: string | null;
  status: "draft" | "approved" | "cancelled";
  source: "manual" | "voice";
  approvedAt: string | null;
  approvedByName: string | null;
  createdAt: string;
  vetName: string;
  diagnosis: string | null;
  treatmentPlan: string | null;
  followUpNote: string | null;
  clinicName: string;
  lines: PrescriptionLine[];
};

export type PrescriptionRow = {
  id: string;
  animalName: string;
  species: string;
  ownerName: string;
  vetName: string;
  status: Prescription["status"];
  source: string;
  createdAt: string;
  approvedAt: string | null;
  lineCount: number;
  openLines: number;
};

/** What the browser sends for one line. Matches the server's prescription line body. */
export type LineInput = {
  itemId?: string | null;
  drugText: string;
  dose?: string | null;
  route?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
  quantity?: number | null;
};

export const rxKeys = {
  all: ["prescriptions"] as const,
  list: (status?: string) => ["prescriptions", "list", status ?? "all"] as const,
  one: (id: string) => ["prescriptions", "one", id] as const,
};

export const usePrescriptions = (status?: string) =>
  useQuery({ queryKey: rxKeys.list(status), queryFn: () => api.get<PrescriptionRow[]>("/api/prescriptions", { status }) });

export const usePrescription = (id: string | undefined) =>
  useQuery({ queryKey: rxKeys.one(id ?? ""), queryFn: () => api.get<Prescription>(`/api/prescriptions/${id}`), enabled: !!id, refetchOnMount: "always" });

export function useSavePrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id?: string; consultationId: string; source: "manual" | "voice"; lines: LineInput[] }) =>
      v.id ? api.put<Prescription>(`/api/prescriptions/${v.id}/lines`, { lines: v.lines })
           : api.post<Prescription>("/api/prescriptions", { consultationId: v.consultationId, source: v.source, lines: v.lines }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: rxKeys.all }); void qc.invalidateQueries({ queryKey: ["consultation"] }); },
  });
}

export function useApprovePrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Prescription>(`/api/prescriptions/${id}/approve`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: rxKeys.all }); void qc.invalidateQueries({ queryKey: ["consultation"] }); void qc.invalidateQueries({ queryKey: ["dashboard"] }); },
  });
}

export function useCancelPrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; reason: string }) => api.post<Prescription>(`/api/prescriptions/${v.id}/cancel`, { reason: v.reason }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: rxKeys.all }); },
  });
}
