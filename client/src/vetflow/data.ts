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
  vaccinesDue?: string;
  vaccinesDone?: string;
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

// Demo data mirrors design/mockups so the app and the mockups tell one story.
const today = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date());

export const demoTranscription =
  "Bruno, four-year-old Labrador, twenty-four kilos. Owner says he has been vomiting since yesterday and is off his food. Temperature is one hundred and two Fahrenheit, mildly dehydrated, abdomen a little tender. This looks like acute gastroenteritis. We will start metronidazole two fifty, one tab twice a day for five days, ondansetron four milligrams, one tab twice a day for three days, and probiotic paste five grams once a day for a week. Bland diet, boiled rice and chicken, for three days, small frequent meals. Recheck in five days.";

export const demoNotes = {
  complaint: "Vomiting since yesterday; off food",
  duration: "About one day",
  examination: "Temperature 102°F. Mild dehydration. Mild abdominal tenderness.",
  diagnosis: "Acute gastroenteritis",
  treatment: "Bland diet, boiled rice and chicken, for 3 days. Small frequent meals.",
  followUp: "Recheck in 5 days",
};

const patient = (fields: Omit<Patient, "status" | "initials" | "tone" | "followUp" | "medications" | "conditions" | "allergies"> & Partial<Patient>): Patient => ({
  status: "Active", initials: fields.name[0], tone: "mint", allergies: "None known", conditions: "None recorded", medications: "None", followUp: "—", ...fields,
});

export const seedPatients: Patient[] = [
  patient({ id: "VET-2026-00124", name: "Bruno", species: "Dog", breed: "Labrador", age: "4 y", gender: "Male", weight: "24 kg", owner: "Rahul Sharma", phone: "+91 98200 12345", lastVisit: today, conditions: "Sensitive stomach" }),
  patient({ id: "VET-2026-00121", name: "Bella", species: "Cat", breed: "Persian", age: "3 y", gender: "Female", weight: "4.2 kg", owner: "Ananya Iyer", phone: "+91 98200 23456", lastVisit: today, conditions: "Recurrent skin rash" }),
  patient({ id: "VET-2026-00118", name: "Max", species: "Dog", breed: "German Shepherd", age: "6 y", gender: "Male", weight: "32.4 kg", owner: "Priya Nair", phone: "+91 98200 45512", lastVisit: today, allergies: "Penicillin", conditions: "Chronic otitis externa (left)", medications: "Otomax ear drops · 4 drops · BID", vaccinesDue: "Rabies due 14 Nov", vaccinesDone: "DHPPi done 2 Mar" }),
  patient({ id: "VET-2026-00117", name: "Coco", species: "Dog", breed: "Beagle", age: "2 y", gender: "Female", weight: "11 kg", owner: "Arjun Mehta", phone: "+91 98200 34567", lastVisit: "24 Oct 2026", conditions: "Ear infection (right), resolving" }),
  patient({ id: "VET-2026-00116", name: "Simba", species: "Cat", breed: "Indie", age: "5 y", gender: "Male", weight: "5.1 kg", owner: "Kavya Reddy", phone: "+91 98200 56789", lastVisit: "19 Oct 2026" }),
  patient({ id: "VET-2026-00115", name: "Rocky", species: "Dog", breed: "Pug", age: "7 y", gender: "Male", weight: "9 kg", owner: "Rahul Sharma", phone: "+91 98200 12345", lastVisit: "12 Oct 2026", conditions: "Brachycephalic airway" }),
  patient({ id: "VET-2026-00113", name: "Luna", species: "Cat", breed: "Siamese", age: "1 y", gender: "Female", weight: "3.4 kg", owner: "Sara Khan", phone: "+91 98200 67890", lastVisit: "8 Oct 2026" }),
  patient({ id: "VET-2026-00111", name: "Sheru", species: "Dog", breed: "Indie", age: "9 y", gender: "Male", weight: "22 kg", owner: "Vikram Rao", phone: "+91 98200 78901", lastVisit: "2 Oct 2026", conditions: "Early arthritis" }),
];

export const sampleMedicines: Medicine[] = [
  { id: "med-1", name: "Metronidazole", strength: "250 mg", dosage: "1 tab", route: "Oral", frequency: "BID", duration: "5 days", instructions: "Give after food" },
  { id: "med-2", name: "Ondansetron", strength: "4 mg", dosage: "1 tab", route: "Oral", frequency: "BID", duration: "3 days", instructions: "" },
  { id: "med-3", name: "Probiotic paste", strength: "", dosage: "5 g", route: "Oral", frequency: "SID", duration: "7 days", instructions: "" },
];

export const seedAppointments: Appointment[] = [
  { id: "APT-01", time: "09:40", pet: "Bella", owner: "Ananya Iyer", reason: "Skin rash", doctor: "Dr. Sharma", status: "Completed" },
  { id: "APT-02", time: "10:30", pet: "Bruno", owner: "Rahul Sharma", reason: "Vomiting since yesterday, off food", doctor: "Dr. Sharma", status: "Arrived" },
  { id: "APT-03", time: "11:15", pet: "Coco", owner: "Arjun Mehta", reason: "Follow-up, ear", doctor: "Dr. Sharma", status: "Upcoming" },
  { id: "APT-04", time: "11:45", pet: "Simba", owner: "Kavya Reddy", reason: "Dental check", doctor: "Dr. Sharma", status: "Upcoming" },
  { id: "APT-05", time: "12:30", pet: "Rocky", owner: "Rahul Sharma", reason: "Vaccination", doctor: "Dr. Sharma", status: "Upcoming" },
];

const visit = (fields: Omit<Consultation, "doctor" | "transcription" | "status"> & Partial<Consultation>): Consultation => ({ doctor: "Dr. Sharma", status: "Completed", transcription: `${fields.notes.complaint}. ${fields.notes.examination} ${fields.notes.treatment}`, ...fields });

export const seedConsultations: Consultation[] = [
  visit({ id: "CONS-2026-0142", patientId: "VET-2026-00121", date: today, time: "09:52", reason: "Skin rash", status: "Draft", complaint: "Itchy rash on flank", approved: false,
    notes: { complaint: "Itchy rash on left flank", duration: "One week", examination: "Moist erythematous patch, 3 cm.", diagnosis: "Superficial pyoderma", treatment: "Keep area dry. Cone if licking.", followUp: "Recheck in 10 days" },
    medicines: [
      { id: "med-b1", name: "Cefalexin", strength: "250 mg", dosage: "½ tab", route: "Oral", frequency: "BID", duration: "10 days", instructions: "Give with food" },
      { id: "med-b2", name: "Chlorhexidine wash", strength: "2%", dosage: "Other", route: "Topical", frequency: "SID", duration: "7 days", instructions: "Rinse after 5 minutes" },
    ] }),
  visit({ id: "CONS-2026-0141", patientId: "VET-2026-00118", date: today, time: "09:15", reason: "Ear recheck, left ear", complaint: "Ear recheck", approved: true,
    notes: { complaint: "Ear recheck, left ear", duration: "Ongoing", examination: "Discharge reduced.", diagnosis: "Chronic otitis externa (left)", treatment: "Continue drops 5 more days.", followUp: "Recheck if discharge returns" },
    medicines: [{ id: "med-m1", name: "Otomax ear drops", strength: "", dosage: "4 drops", route: "Ear", frequency: "BID", duration: "5 days", instructions: "Left ear" }] }),
  visit({ id: "CONS-2026-0128", patientId: "VET-2026-00117", date: "24 Oct 2026", time: "16:20", reason: "Ear infection, right", complaint: "Head shaking", approved: true,
    notes: { complaint: "Head shaking, scratching right ear", duration: "Three days", examination: "Right canal red, waxy discharge.", diagnosis: "Otitis externa (right)", treatment: "Clean ear daily.", followUp: "Recheck in 7 days" },
    medicines: [{ id: "med-c1", name: "Surolan ear drops", strength: "", dosage: "3 drops", route: "Ear", frequency: "BID", duration: "7 days", instructions: "Right ear" }] }),
  visit({ id: "CONS-2026-0090", patientId: "VET-2026-00124", date: "15 Oct 2026", time: "10:05", reason: "Annual check", complaint: "Routine check", approved: true,
    notes: { complaint: "Annual health check", duration: "Routine", examination: "Bright and alert. Body condition 5/9.", diagnosis: "Healthy", treatment: "Vaccines up to date.", followUp: "Annual" },
    medicines: [] }),
];

export function initials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

