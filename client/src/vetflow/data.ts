export type ViewKey = "dashboard" | "patients" | "consultations" | "prescriptions" | "appointments" | "inventory" | "reports" | "settings";

export type Patient = {
  id: string;
  name: string;
  species: string;
  breed: string;
  age: string;
  gender: string;
  weight: string;
  owner: string;
  phone: string;
  lastVisit: string;
  status: "Active" | "Inactive";
  initials: string;
  tone: string;
  allergies: string;
  conditions: string;
  medications: string;
  followUp: string;
  colour?: string;
  microchip?: string;
  email?: string;
  address?: string;
};

export type Medicine = {
  id: string;
  name: string;
  strength: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  instructions: string;
};

export type Consultation = {
  id: string;
  patientId: string;
  date: string;
  time: string;
  reason: string;
  status: "Completed" | "In progress" | "Draft";
  doctor: string;
  complaint: string;
  transcription: string;
  notes: {
    complaint: string;
    duration: string;
    examination: string;
    diagnosis: string;
    treatment: string;
    followUp: string;
  };
  medicines: Medicine[];
  approved: boolean;
};

export type Appointment = { id: string; time: string; pet: string; owner: string; reason: string; doctor: string; status: string };

export type DemoState = { patients: Patient[]; consultations: Consultation[]; appointments: Appointment[] };

export const speciesOptions = ["Dog", "Cat", "Cow", "Buffalo", "Goat", "Horse", "Other"];

export const demoTranscription =
  "Bruno, a three-year-old Labrador weighing 24 kilograms, was brought to the clinic with complaints of vomiting and loss of appetite since yesterday. The owner reports that the dog has been less active than usual. On examination, the temperature was recorded as 102 degrees Fahrenheit. Mild dehydration was observed. The doctor recommends further evaluation and prescribes the medications documented below. The patient should return for a follow-up after five days.";

export const seedPatients: Patient[] = [
  { id: "VET-2026-00124", name: "Bruno", species: "Dog", breed: "Labrador", age: "3 years", gender: "Male", weight: "24 kg", owner: "Rahul Sharma", phone: "9876543210", lastVisit: "15 Oct 2026", status: "Active", initials: "B", tone: "amber", allergies: "None known", conditions: "Sensitive stomach", medications: "None", followUp: "20 Oct 2026" },
  { id: "VET-2026-00125", name: "Bella", species: "Cat", breed: "Persian", age: "2 years", gender: "Female", weight: "4.2 kg", owner: "Priya Patel", phone: "9876543211", lastVisit: "10 Oct 2026", status: "Active", initials: "B", tone: "lilac", allergies: "None known", conditions: "None recorded", medications: "Feline multivitamin", followUp: "—" },
  { id: "VET-2026-00126", name: "Max", species: "Dog", breed: "German Shepherd", age: "5 years", gender: "Male", weight: "31 kg", owner: "Amit Verma", phone: "9876543212", lastVisit: "28 Sep 2026", status: "Active", initials: "M", tone: "blue", allergies: "Penicillin", conditions: "Hip dysplasia", medications: "Joint supplement", followUp: "—" },
  { id: "VET-2026-00127", name: "Coco", species: "Cow", breed: "Gir", age: "4 years", gender: "Female", weight: "320 kg", owner: "Ramesh Pawar", phone: "9876543213", lastVisit: "02 Oct 2026", status: "Active", initials: "C", tone: "sage", allergies: "None known", conditions: "None recorded", medications: "None", followUp: "—" },
  { id: "VET-2026-00128", name: "Oreo", species: "Dog", breed: "Beagle", age: "1 year", gender: "Male", weight: "12 kg", owner: "Neha Singh", phone: "9876543214", lastVisit: "01 Oct 2026", status: "Active", initials: "O", tone: "rose", allergies: "None known", conditions: "None recorded", medications: "None", followUp: "—" },
];

export const sampleMedicines: Medicine[] = [
  { id: "med-1", name: "Sample Medicine A", strength: "250 mg", dosage: "1 tablet", route: "Oral", frequency: "Twice daily", duration: "5 days", instructions: "Give after food" },
  { id: "med-2", name: "Sample Medicine B", strength: "50 mg/5 ml", dosage: "5 ml", route: "Oral", frequency: "Once daily", duration: "3 days", instructions: "Shake well before use" },
];

export const seedAppointments: Appointment[] = [
  { id: "APT-01", time: "09:30 AM", pet: "Bruno", owner: "Rahul Sharma", reason: "Follow-up", doctor: "Dr. Sharma", status: "Completed" },
  { id: "APT-02", time: "10:00 AM", pet: "Max", owner: "Priya Patel", reason: "General Checkup", doctor: "Dr. Sharma", status: "In Progress" },
  { id: "APT-03", time: "10:30 AM", pet: "Bella", owner: "Amit Verma", reason: "Vaccination", doctor: "Dr. Sharma", status: "Upcoming" },
  { id: "APT-04", time: "11:00 AM", pet: "Coco", owner: "Neha Singh", reason: "Consultation", doctor: "Dr. Sharma", status: "Upcoming" },
];

export const seedConsultations: Consultation[] = [
  { id: "CONS-2026-090", patientId: "VET-2026-00124", date: "15 Oct 2026", time: "09:30 AM", reason: "General Consultation", status: "Completed", doctor: "Dr. Sharma", complaint: "Vomiting and loss of appetite", transcription: demoTranscription, notes: { complaint: "Vomiting; loss of appetite; reduced activity", duration: "Approximately one day", examination: "Temperature: 102°F. Mild dehydration observed.", diagnosis: "Pending doctor’s confirmation", treatment: "As specified by the veterinarian", followUp: "After five days" }, medicines: sampleMedicines, approved: true },
  { id: "CONS-2026-087", patientId: "VET-2026-00125", date: "10 Oct 2026", time: "02:00 PM", reason: "Vaccination", status: "Completed", doctor: "Dr. Sharma", complaint: "Annual vaccination", transcription: "Bella was presented for her annual vaccination. Appetite and activity were normal.", notes: { complaint: "Annual vaccination", duration: "Routine visit", examination: "Bright, alert and responsive.", diagnosis: "Healthy for vaccination", treatment: "Vaccination administered", followUp: "Annual booster" }, medicines: [], approved: true },
  { id: "CONS-2026-082", patientId: "VET-2026-00126", date: "28 Sep 2026", time: "11:15 AM", reason: "Follow-up", status: "Completed", doctor: "Dr. Sharma", complaint: "Mobility review", transcription: "Max returned for a mobility review. Owner reports improved activity.", notes: { complaint: "Mobility review", duration: "Three week follow-up", examination: "Gait improved from previous visit.", diagnosis: "Hip dysplasia, stable", treatment: "Continue joint supplement", followUp: "Review in six weeks" }, medicines: [], approved: true },
];

export function initials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

