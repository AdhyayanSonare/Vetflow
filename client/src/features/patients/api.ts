import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

export type Animal = {
  id: string;
  code: string;
  name: string;
  species: string;
  breed: string | null;
  sex: string | null;
  dob: string | null;
  weightKg: number | null;
  colour: string | null;
  microchip: string | null;
  allergies: string | null;
  conditions: string | null;
  active: boolean;
  branchId: string | null;
  ownerId: string;
  ownerName: string;
  ownerPhone: string | null;
  ownerEmail: string | null;
  ownerAddress: string | null;
  lastConsultation?: string | null;
};

export type ConsultationSummary = {
  id: string;
  animalId: string;
  animalName: string;
  vetId: string;
  vetName: string;
  status: "draft" | "completed";
  complaint: string | null;
  history: string | null;
  durationText: string | null;
  followUpNote: string | null;
  source: "manual" | "voice";
  temperatureF: number | null;
  examination: string | null;
  diagnosis: string | null;
  treatmentPlan: string | null;
  followUpDate: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type AnimalProfile = Animal & {
  consultations: ConsultationSummary[];
  prescriptions: Array<{ id: string; status: string; source: string; createdAt: string; approvedAt: string | null }>;
};

export type Owner = { id: string; name: string; phone: string | null; email: string | null; animalCount: number };

export type NewAnimal = {
  name: string;
  species: string;
  breed?: string;
  sex?: string;
  dob?: string;
  weightKg?: number;
  colour?: string;
  microchip?: string;
  allergies?: string;
  conditions?: string;
  ownerId?: string;
  owner?: { name: string; phone?: string; email?: string; address?: string };
};

export const SPECIES = ["Dog", "Cat", "Cow", "Buffalo", "Goat", "Horse", "Other"] as const;

export const patientKeys = {
  all: ["patients"] as const,
  list: (q: string) => ["patients", "list", q] as const,
  one: (id: string) => ["patients", "one", id] as const,
  owners: (q: string) => ["owners", q] as const,
};

export const usePatients = (q: string) =>
  useQuery({ queryKey: patientKeys.list(q), queryFn: () => api.get<Animal[]>("/api/animals", { q }), placeholderData: prev => prev });

export const usePatient = (id: string) =>
  useQuery({ queryKey: patientKeys.one(id), queryFn: () => api.get<AnimalProfile>(`/api/animals/${id}`) });

export const useOwners = (q: string, enabled = true) =>
  useQuery({ queryKey: patientKeys.owners(q), queryFn: () => api.get<Owner[]>("/api/owners", { q }), enabled });

export function useRegisterPatient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewAnimal) => api.post<Animal>("/api/animals", body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: patientKeys.all }); void qc.invalidateQueries({ queryKey: ["owners"] }); },
  });
}

export function useUpdatePatient(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<NewAnimal>) => api.patch<Animal>(`/api/animals/${id}`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: patientKeys.all }); },
  });
}
