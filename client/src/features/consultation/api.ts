import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DraftLine } from "@shared/extraction";
import { api } from "@/api/client";
import type { ConsultationSummary } from "@/features/patients/api";

export type Consultation = ConsultationSummary & {
  transcripts: Array<{ id: string; language: string; provider: string; text: string; createdAt: string }>;
  prescriptions: Array<{ id: string; status: "draft" | "approved"; source: string }>;
};

export type NotesPatch = Partial<{
  complaint: string; durationText: string; examination: string; diagnosis: string; treatmentPlan: string; followUpNote: string;
  temperatureF: number; source: "manual" | "voice";
}>;

export const consultationKeys = {
  all: ["consultation"] as const,
  one: (id: string) => ["consultation", id] as const,
  list: (status?: string) => ["consultation", "list", status ?? "all"] as const,
};

export const useConsultation = (id: string) =>
  useQuery({ queryKey: consultationKeys.one(id), queryFn: () => api.get<Consultation>(`/api/consultations/${id}`), staleTime: 0, refetchOnMount: "always" });

export const useConsultations = (status?: string) =>
  useQuery({ queryKey: consultationKeys.list(status), queryFn: () => api.get<ConsultationSummary[]>("/api/consultations", { status }) });

export function useCreateConsultation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (animalId: string) => api.post<Consultation>("/api/consultations", { animalId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: consultationKeys.all }); void qc.invalidateQueries({ queryKey: ["patients"] }); },
  });
}

export const saveNotes = (id: string, patch: NotesPatch) => api.patch<Consultation>(`/api/consultations/${id}`, patch);
export const saveTranscript = (id: string, body: { language: string; provider: string; text: string }) => api.post<{ id: string }>(`/api/consultations/${id}/transcripts`, body);
export const completeConsultation = (id: string) => api.post<Consultation>(`/api/consultations/${id}/complete`);
/** Drafts prescription lines from typed or pasted text with rules and catalogue matching (no language model). */
export const structureText = (text: string) => api.post<{ lines: DraftLine[]; ignoredText: string }>("/api/voice/structure", { text });
