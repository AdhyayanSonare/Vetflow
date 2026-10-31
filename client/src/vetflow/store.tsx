import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Appointment, Consultation, Medicine, Patient } from "./data";
import { initials, sampleMedicines, seedAppointments, seedConsultations, seedPatients } from "./data";

export type Phase = "ready" | "recording" | "paused" | "processing" | "notes" | "prescription" | "done";

// Everything an in-progress consultation needs to resume after a reload or the
// OS killing the tab: the record, where the vet was in the flow, and their edits.
export type ConsultDraft = {
  consultation: Consultation;
  phase: Phase;
  elapsed: number;
  notes: Consultation["notes"];
  medicines: Medicine[];
};

type StoreState = {
  version: 2;
  patients: Patient[];
  consultations: Consultation[];
  appointments: Appointment[];
  drafts: Record<string, ConsultDraft>;
  lastPatientId: string;
};

const STORAGE_KEY = "vetflow-demo-v2";
const LEGACY_KEY = "vetflow-demo-state";

function seedState(): StoreState {
  return { version: 2, patients: seedPatients, consultations: seedConsultations, appointments: seedAppointments, drafts: {}, lastPatientId: seedPatients[0].id };
}

function readState(): StoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoreState>;
      if (parsed.version === 2) return { ...seedState(), ...parsed } as StoreState;
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as Partial<StoreState>;
      return { ...seedState(), patients: parsed.patients ?? seedPatients, consultations: parsed.consultations ?? seedConsultations, appointments: parsed.appointments ?? seedAppointments };
    }
  } catch {
    // Fall back to the deterministic seed data when storage is unavailable or corrupt.
  }
  return seedState();
}

/** Next id after the highest numeric suffix in use, so deletions never cause collisions. */
function nextId(prefix: string, ids: string[], start: number, pad = 0) {
  const max = ids.reduce((highest, id) => {
    const value = Number(id.split("-").pop());
    return Number.isFinite(value) ? Math.max(highest, value) : highest;
  }, start);
  return `${prefix}${String(max + 1).padStart(pad, "0")}`;
}

export function todayLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function todayLong(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
}

export function timeLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function useStoreValue() {
  const [state, setState] = useState<StoreState>(readState);
  // Actions that return a new id read the latest state from here, because a
  // functional setState updater is not guaranteed to run before they return.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full or blocked (private mode); the session keeps working in memory.
    }
  }, [state]);

  const addPatient = useCallback((form: Record<string, string>) => {
    const name = form.name || "New patient";
    const patient: Patient = { id: nextId(`VET-${new Date().getFullYear()}-`, stateRef.current.patients.map((p) => p.id), 0, 5), name, species: form.species || "Dog", breed: form.breed || "—", age: form.age || "—", gender: form.gender || "—", weight: form.weight ? `${form.weight} kg` : "—", owner: form.owner || "—", phone: form.phone || "—", lastVisit: todayLabel(), status: "Active", initials: initials(name), tone: "mint", allergies: form.allergies || "None known", conditions: form.conditions || "None recorded", medications: "None", followUp: "—", colour: form.colour, microchip: form.microchip, email: form.email, address: form.address };
    stateRef.current = { ...stateRef.current, patients: [patient, ...stateRef.current.patients], lastPatientId: patient.id };
    setState(stateRef.current);
    return patient;
  }, []);

  const startConsultation = useCallback((patientId: string) => {
    const current = stateRef.current;
    const id = nextId(`CONS-${new Date().getFullYear()}-`, [...current.consultations.map((c) => c.id), ...Object.keys(current.drafts)], 100);
    const consultation: Consultation = { id, patientId, date: todayLabel(), time: timeLabel(), reason: "General Consultation", status: "In progress", doctor: "Dr. Sharma", complaint: "To be documented", transcription: "", notes: { complaint: "", duration: "", examination: "", diagnosis: "Pending doctor’s confirmation", treatment: "", followUp: "" }, medicines: [], approved: false };
    const draft: ConsultDraft = { consultation, phase: "ready", elapsed: 0, notes: consultation.notes, medicines: sampleMedicines.map((medicine) => ({ ...medicine })) };
    stateRef.current = { ...current, drafts: { ...current.drafts, [id]: draft }, lastPatientId: patientId };
    setState(stateRef.current);
    return id;
  }, []);

  const updateDraft = useCallback((id: string, patch: Partial<ConsultDraft>) => {
    setState((current) => current.drafts[id] ? { ...current, drafts: { ...current.drafts, [id]: { ...current.drafts[id], ...patch } } } : current);
  }, []);

  /** Like updateDraft, but writes to storage before returning — for `pagehide`, where React won't get to re-render. */
  const updateDraftNow = useCallback((id: string, patch: Partial<ConsultDraft>) => {
    const current = stateRef.current;
    if (!current.drafts[id]) return;
    stateRef.current = { ...current, drafts: { ...current.drafts, [id]: { ...current.drafts[id], ...patch } } };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateRef.current));
    } catch {
      // Storage unavailable; the in-memory update below still applies.
    }
    setState(stateRef.current);
  }, []);

  /** Write a consultation into the record (and, when approved, into the patient's chart). */
  const saveConsultation = useCallback((consultation: Consultation) => {
    setState((current) => ({
      ...current,
      consultations: [consultation, ...current.consultations.filter((item) => item.id !== consultation.id)],
      patients: consultation.approved ? current.patients.map((patient) => patient.id === consultation.patientId ? { ...patient, lastVisit: consultation.date, followUp: consultation.notes.followUp || "—", medications: consultation.medicines.map((medicine) => medicine.name).join(", ") || patient.medications } : patient) : current.patients,
    }));
  }, []);

  const addAppointment = useCallback((appointment: Omit<Appointment, "id">) => {
    setState((current) => ({ ...current, appointments: [...current.appointments, { ...appointment, id: nextId("APT-", current.appointments.map((a) => a.id), 0, 2) }] }));
  }, []);

  const setLastPatient = useCallback((id: string) => {
    setState((current) => current.lastPatientId === id ? current : { ...current, lastPatientId: id });
  }, []);

  const resetDemo = useCallback(() => setState(seedState()), []);

  return useMemo(() => ({ ...state, addPatient, startConsultation, updateDraft, updateDraftNow, saveConsultation, addAppointment, setLastPatient, resetDemo }), [state, addPatient, startConsultation, updateDraft, updateDraftNow, saveConsultation, addAppointment, setLastPatient, resetDemo]);
}

type Store = ReturnType<typeof useStoreValue>;
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const value = useStoreValue();
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <StoreProvider>");
  return store;
}
