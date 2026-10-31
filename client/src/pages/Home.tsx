import { useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock3,
  Download,
  FileText,
  Filter,
  FolderOpen,
  HeartPulse,
  LayoutDashboard,
  Leaf,
  Menu,
  Mic,
  MoreHorizontal,
  PawPrint,
  Phone,
  Plus,
  Printer,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type ViewKey = "dashboard" | "patients" | "consultations" | "prescriptions" | "appointments" | "inventory" | "reports" | "settings";
type Patient = {
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
type Medicine = {
  id: string;
  name: string;
  strength: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  instructions: string;
};
type Consultation = {
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
type Appointment = { id: string; time: string; pet: string; owner: string; reason: string; doctor: string; status: string };
type DemoState = { patients: Patient[]; consultations: Consultation[]; appointments: Appointment[] };

const demoTranscription =
  "Bruno, a three-year-old Labrador weighing 24 kilograms, was brought to the clinic with complaints of vomiting and loss of appetite since yesterday. The owner reports that the dog has been less active than usual. On examination, the temperature was recorded as 102 degrees Fahrenheit. Mild dehydration was observed. The doctor recommends further evaluation and prescribes the medications documented below. The patient should return for a follow-up after five days.";

const seedPatients: Patient[] = [
  { id: "VET-2026-00124", name: "Bruno", species: "Dog", breed: "Labrador", age: "3 years", gender: "Male", weight: "24 kg", owner: "Rahul Sharma", phone: "9876543210", lastVisit: "15 Oct 2026", status: "Active", initials: "B", tone: "amber", allergies: "None known", conditions: "Sensitive stomach", medications: "None", followUp: "20 Oct 2026" },
  { id: "VET-2026-00125", name: "Bella", species: "Cat", breed: "Persian", age: "2 years", gender: "Female", weight: "4.2 kg", owner: "Priya Patel", phone: "9876543211", lastVisit: "10 Oct 2026", status: "Active", initials: "B", tone: "lilac", allergies: "None known", conditions: "None recorded", medications: "Feline multivitamin", followUp: "—" },
  { id: "VET-2026-00126", name: "Max", species: "Dog", breed: "German Shepherd", age: "5 years", gender: "Male", weight: "31 kg", owner: "Amit Verma", phone: "9876543212", lastVisit: "28 Sep 2026", status: "Active", initials: "M", tone: "blue", allergies: "Penicillin", conditions: "Hip dysplasia", medications: "Joint supplement", followUp: "—" },
  { id: "VET-2026-00127", name: "Coco", species: "Cow", breed: "Gir", age: "4 years", gender: "Female", weight: "320 kg", owner: "Ramesh Pawar", phone: "9876543213", lastVisit: "02 Oct 2026", status: "Active", initials: "C", tone: "sage", allergies: "None known", conditions: "None recorded", medications: "None", followUp: "—" },
  { id: "VET-2026-00128", name: "Oreo", species: "Dog", breed: "Beagle", age: "1 year", gender: "Male", weight: "12 kg", owner: "Neha Singh", phone: "9876543214", lastVisit: "01 Oct 2026", status: "Active", initials: "O", tone: "rose", allergies: "None known", conditions: "None recorded", medications: "None", followUp: "—" },
];

const sampleMedicines: Medicine[] = [
  { id: "med-1", name: "Sample Medicine A", strength: "250 mg", dosage: "1 tablet", route: "Oral", frequency: "Twice daily", duration: "5 days", instructions: "Give after food" },
  { id: "med-2", name: "Sample Medicine B", strength: "50 mg/5 ml", dosage: "5 ml", route: "Oral", frequency: "Once daily", duration: "3 days", instructions: "Shake well before use" },
];

const seedAppointments: Appointment[] = [
  { id: "APT-01", time: "09:30 AM", pet: "Bruno", owner: "Rahul Sharma", reason: "Follow-up", doctor: "Dr. Sharma", status: "Completed" },
  { id: "APT-02", time: "10:00 AM", pet: "Max", owner: "Priya Patel", reason: "General Checkup", doctor: "Dr. Sharma", status: "In Progress" },
  { id: "APT-03", time: "10:30 AM", pet: "Bella", owner: "Amit Verma", reason: "Vaccination", doctor: "Dr. Sharma", status: "Upcoming" },
  { id: "APT-04", time: "11:00 AM", pet: "Coco", owner: "Neha Singh", reason: "Consultation", doctor: "Dr. Sharma", status: "Upcoming" },
];

const seedConsultations: Consultation[] = [
  { id: "CONS-2026-090", patientId: "VET-2026-00124", date: "15 Oct 2026", time: "09:30 AM", reason: "General Consultation", status: "Completed", doctor: "Dr. Sharma", complaint: "Vomiting and loss of appetite", transcription: demoTranscription, notes: { complaint: "Vomiting; loss of appetite; reduced activity", duration: "Approximately one day", examination: "Temperature: 102°F. Mild dehydration observed.", diagnosis: "Pending doctor’s confirmation", treatment: "As specified by the veterinarian", followUp: "After five days" }, medicines: sampleMedicines, approved: true },
  { id: "CONS-2026-087", patientId: "VET-2026-00125", date: "10 Oct 2026", time: "02:00 PM", reason: "Vaccination", status: "Completed", doctor: "Dr. Sharma", complaint: "Annual vaccination", transcription: "Bella was presented for her annual vaccination. Appetite and activity were normal.", notes: { complaint: "Annual vaccination", duration: "Routine visit", examination: "Bright, alert and responsive.", diagnosis: "Healthy for vaccination", treatment: "Vaccination administered", followUp: "Annual booster" }, medicines: [], approved: true },
  { id: "CONS-2026-082", patientId: "VET-2026-00126", date: "28 Sep 2026", time: "11:15 AM", reason: "Follow-up", status: "Completed", doctor: "Dr. Sharma", complaint: "Mobility review", transcription: "Max returned for a mobility review. Owner reports improved activity.", notes: { complaint: "Mobility review", duration: "Three week follow-up", examination: "Gait improved from previous visit.", diagnosis: "Hip dysplasia, stable", treatment: "Continue joint supplement", followUp: "Review in six weeks" }, medicines: [], approved: true },
];

const navItems: Array<{ key: ViewKey; label: string; icon: LucideIcon; badge?: string }> = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "patients", label: "Patients", icon: PawPrint },
  { key: "consultations", label: "Consultations", icon: Stethoscope },
  { key: "prescriptions", label: "Prescriptions", icon: ClipboardList },
  { key: "appointments", label: "Appointments", icon: CalendarDays },
  { key: "inventory", label: "Inventory", icon: FolderOpen, badge: "Soon" },
  { key: "reports", label: "Reports", icon: Activity },
  { key: "settings", label: "Settings", icon: Settings },
];

function readDemoState(): DemoState {
  try {
    const raw = localStorage.getItem("vetflow-demo-state");
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DemoState>;
      return { patients: parsed.patients ?? seedPatients, consultations: parsed.consultations ?? seedConsultations, appointments: parsed.appointments ?? seedAppointments };
    }
  } catch {
    // Fall back to the deterministic seed data when storage is unavailable.
  }
  return { patients: seedPatients, consultations: seedConsultations, appointments: seedAppointments };
}

function viewFromPath(path: string): ViewKey {
  const segment = path.split("/")[1] as ViewKey;
  return navItems.some((item) => item.key === segment) ? segment : "dashboard";
}

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatToday() {
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(2026, 9, 31));
}

function IconButton({ label, children, onClick, className = "" }: { label: string; children: React.ReactNode; onClick?: () => void; className?: string }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function Button({ children, onClick, variant = "primary", className = "", disabled = false }: { children: React.ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "quiet" | "danger"; className?: string; disabled?: boolean }) {
  return <button disabled={disabled} className={`button button-${variant} ${className}`} onClick={onClick}>{children}</button>;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "success" | "warning" | "info" | "danger" | "mint" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function Avatar({ patient, size = "md" }: { patient: Patient; size?: "sm" | "md" | "lg" }) {
  return <div className={`avatar avatar-${size} avatar-${patient.tone}`}><span>{patient.initials}</span><PawPrint size={size === "lg" ? 14 : 11} strokeWidth={2.2} /></div>;
}

function SectionTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="section-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{action && <div className="section-heading-action">{action}</div>}</div>;
}

export default function Home() {
  const [location, setLocation] = useLocation();
  const [view, setView] = useState<ViewKey>(() => viewFromPath(window.location.pathname));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [state, setState] = useState<DemoState>(() => readDemoState());
  const [selectedPatientId, setSelectedPatientId] = useState("VET-2026-00124");
  const [profileTab, setProfileTab] = useState("Overview");
  const [showRegister, setShowRegister] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [patientSearch, setPatientSearch] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("All species");
  const [detailConsultation, setDetailConsultation] = useState<Consultation | null>(null);
  const [activeConsultation, setActiveConsultation] = useState<Consultation | null>(null);
  const [consultationPhase, setConsultationPhase] = useState<"ready" | "recording" | "paused" | "processing" | "notes" | "prescription">("ready");
  const [elapsed, setElapsed] = useState(0);
  const [notesDraft, setNotesDraft] = useState<Consultation["notes"] | null>(null);
  const [medicinesDraft, setMedicinesDraft] = useState<Medicine[]>([]);
  const [prescriptionFilter, setPrescriptionFilter] = useState("All");
  const [showAppointmentForm, setShowAppointmentForm] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    localStorage.setItem("vetflow-demo-state", JSON.stringify({ ...state, appointments: state.appointments ?? seedAppointments }));
  }, [state]);

  useEffect(() => {
    setView(viewFromPath(location));
  }, [location]);

  useEffect(() => {
    if (consultationPhase === "recording") {
      timerRef.current = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    } else if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [consultationPhase]);

  useEffect(() => {
    if (consultationPhase === "processing") {
      const timer = window.setTimeout(() => setConsultationPhase("notes"), 1800);
      return () => window.clearTimeout(timer);
    }
  }, [consultationPhase]);

  const selectedPatient = state.patients.find((patient) => patient.id === selectedPatientId) ?? state.patients[0];
  const patientConsultations = state.consultations.filter((consultation) => consultation.patientId === selectedPatient?.id);
  const completedConsultations = state.consultations.filter((consultation) => consultation.status === "Completed");
  const prescriptions = state.consultations.filter((consultation) => consultation.medicines.length > 0);

  const notify = (message: string) => { toast.success(message); };

  const navigate = (next: ViewKey) => {
    setView(next);
    setLocation(next === "dashboard" ? "/" : `/${next}`);
    setSidebarOpen(false);
    setShowNotifications(false);
    if (next !== "patients") setProfileTab("Overview");
  };

  const openPatient = (id: string, tab = "Overview") => {
    setSelectedPatientId(id);
    setProfileTab(tab);
    setView("patients");
    setLocation("/patients");
    setSidebarOpen(false);
  };

  const startConsultation = (patient = selectedPatient) => {
    const newConsultation: Consultation = {
      id: `CONS-2026-${String(100 + state.consultations.length + 1)}`,
      patientId: patient.id,
      date: "31 Oct 2026",
      time: "Now",
      reason: "General Consultation",
      status: "In progress",
      doctor: "Dr. Sharma",
      complaint: "To be documented",
      transcription: "",
      notes: { complaint: "", duration: "", examination: "", diagnosis: "Pending doctor’s confirmation", treatment: "", followUp: "" },
      medicines: [],
      approved: false,
    };
    setSelectedPatientId(patient.id);
    setActiveConsultation(newConsultation);
    setNotesDraft(newConsultation.notes);
    setMedicinesDraft(sampleMedicines.map((medicine) => ({ ...medicine })));
    setElapsed(0);
    setConsultationPhase("ready");
    setView("consultations");
    notify(`New consultation started for ${patient.name}`);
  };

  const startRecording = () => {
    setConsultationPhase("recording");
    notify("Recording started — speak naturally about the patient");
  };

  const pauseRecording = () => { setConsultationPhase("paused"); notify("Recording paused"); };
  const resumeRecording = () => { setConsultationPhase("recording"); notify("Recording resumed"); };
  const stopRecording = () => {
    setConsultationPhase("processing");
    const hydrated = { ...(activeConsultation as Consultation), transcription: demoTranscription, complaint: "Vomiting and loss of appetite", notes: { complaint: "Vomiting; loss of appetite; reduced activity", duration: "Approximately one day", examination: "Temperature: 102°F. Mild dehydration observed.", diagnosis: "Pending doctor’s confirmation", treatment: "As specified by the veterinarian", followUp: "After five days" } };
    setActiveConsultation(hydrated);
    setNotesDraft(hydrated.notes);
    notify("Audio captured — VetFlow AI is structuring the consultation");
  };

  const uploadAudio = (file: File) => {
    if (!activeConsultation) return;
    setConsultationPhase("processing");
    const hydrated = { ...(activeConsultation as Consultation), transcription: demoTranscription, complaint: "Vomiting and loss of appetite", notes: { complaint: "Vomiting; loss of appetite; reduced activity", duration: "Approximately one day", examination: "Temperature: 102°F. Mild dehydration observed.", diagnosis: "Pending doctor’s confirmation", treatment: "As specified by the veterinarian", followUp: "After five days" } };
    setActiveConsultation(hydrated);
    setNotesDraft(hydrated.notes);
    notify(`${file.name} uploaded — VetFlow AI is structuring the consultation`);
  };

  const saveNotes = () => {
    if (!activeConsultation || !notesDraft) return;
    const updated = { ...activeConsultation, notes: notesDraft, complaint: notesDraft.complaint, transcription: activeConsultation.transcription || demoTranscription };
    setActiveConsultation(updated);
    setState((current) => ({ ...current, consultations: [updated, ...current.consultations.filter((item) => item.id !== updated.id)] }));
    notify("Clinical notes saved to the consultation draft");
  };

  const savePrescriptionDraft = () => {
    if (!activeConsultation || !notesDraft) return;
    const updated = { ...activeConsultation, notes: notesDraft, medicines: medicinesDraft, status: "Draft" as const, approved: false, transcription: activeConsultation.transcription || demoTranscription };
    setActiveConsultation(updated);
    setState((current) => ({ ...current, consultations: [updated, ...current.consultations.filter((item) => item.id !== updated.id)] }));
    notify("Prescription saved as a draft");
  };

  const approvePrescription = () => {
    if (!activeConsultation || !notesDraft) return;
    const updated = { ...activeConsultation, notes: notesDraft, medicines: medicinesDraft, approved: true, status: "Completed" as const, transcription: activeConsultation.transcription || demoTranscription };
    setActiveConsultation(updated);
    setState((current) => ({
      patients: current.patients.map((patient) => patient.id === updated.patientId ? { ...patient, lastVisit: "31 Oct 2026", followUp: notesDraft.followUp || "—", medications: medicinesDraft.map((medicine) => medicine.name).join(", ") } : patient),
      consultations: [updated, ...current.consultations.filter((item) => item.id !== updated.id)],
      appointments: current.appointments ?? seedAppointments,
    }));
    setConsultationPhase("prescription");
    notify("Prescription approved and attached to the medical history");
  };

  const updateMedicine = (id: string, field: keyof Medicine, value: string) => {
    setMedicinesDraft((items) => items.map((medicine) => medicine.id === id ? { ...medicine, [field]: value } : medicine));
  };

  const addMedicine = () => {
    setMedicinesDraft((items) => [...items, { id: `med-${Date.now()}`, name: "", strength: "", dosage: "", route: "Oral", frequency: "", duration: "", instructions: "" }]);
  };

  const removeMedicine = (id: string) => setMedicinesDraft((items) => items.filter((medicine) => medicine.id !== id));

  const savePatient = (form: Record<string, string>) => {
    const nextIndex = 124 + state.patients.length;
    const name = form.name || "New patient";
    const patient: Patient = { id: `VET-2026-${String(nextIndex).padStart(5, "0")}`, name, species: form.species || "Dog", breed: form.breed || "—", age: form.age || "—", gender: form.gender || "—", weight: form.weight ? `${form.weight} kg` : "—", owner: form.owner || "—", phone: form.phone || "—", lastVisit: "31 Oct 2026", status: "Active", initials: initials(name), tone: "mint", allergies: form.allergies || "None known", conditions: form.conditions || "None recorded", medications: "None", followUp: "—", colour: form.colour, microchip: form.microchip, email: form.email, address: form.address };
    setState((current) => ({ ...current, patients: [patient, ...current.patients] }));
    setSelectedPatientId(patient.id);
    setShowRegister(false);
    setProfileTab("Overview");
    setView("patients");
    notify(`${patient.name} registered as ${patient.id}`);
  };

  const globalResults = globalSearch.trim() ? state.patients.filter((patient) => `${patient.name} ${patient.owner} ${patient.id}`.toLowerCase().includes(globalSearch.toLowerCase())) : [];
  const filteredPatients = state.patients.filter((patient) => `${patient.name} ${patient.owner} ${patient.id} ${patient.breed}`.toLowerCase().includes(patientSearch.toLowerCase()) && (speciesFilter === "All species" || patient.species === speciesFilter));

  const renderView = () => {
    if (view === "dashboard") return <Dashboard patients={state.patients ?? seedPatients} consultations={state.consultations ?? seedConsultations} appointments={state.appointments ?? seedAppointments} onRegister={() => setShowRegister(true)} onNewConsultation={() => startConsultation()} onPatients={() => navigate("patients")} onPrescriptions={() => navigate("prescriptions")} onSchedule={() => setShowAppointmentForm(true)} onOpenPatient={openPatient} onOpenConsultation={setDetailConsultation} />;
    if (view === "patients") return <PatientsView patients={filteredPatients} selectedPatient={selectedPatient} patientSearch={patientSearch} setPatientSearch={setPatientSearch} speciesFilter={speciesFilter} setSpeciesFilter={setSpeciesFilter} onRegister={() => setShowRegister(true)} onOpenPatient={openPatient} onNewConsultation={startConsultation} profileTab={profileTab} setProfileTab={setProfileTab} consultations={patientConsultations} onOpenConsultation={setDetailConsultation} />;
    if (view === "consultations") return <ConsultationView selectedPatient={selectedPatient} patientConsultations={patientConsultations} activeConsultation={activeConsultation} phase={consultationPhase} elapsed={elapsed} notesDraft={notesDraft} medicinesDraft={medicinesDraft} onSelectPatient={openPatient} onStart={startRecording} onPause={pauseRecording} onResume={resumeRecording} onStop={stopRecording} onUploadAudio={uploadAudio} onSaveNotes={saveNotes} onSaveDraft={savePrescriptionDraft} onNotesChange={setNotesDraft} onGoPrescription={() => setConsultationPhase("prescription")} onMedicineChange={updateMedicine} onAddMedicine={addMedicine} onRemoveMedicine={removeMedicine} onApprove={approvePrescription} onOpenConsultation={setDetailConsultation} onBack={() => navigate("dashboard")} />;
    if (view === "prescriptions") return <PrescriptionsView prescriptions={prescriptions} patients={state.patients} filter={prescriptionFilter} setFilter={setPrescriptionFilter} onOpen={setDetailConsultation} onPrint={() => window.print()} />;
    if (view === "appointments") return <AppointmentsView appointments={state.appointments ?? seedAppointments} onNew={() => setShowAppointmentForm(true)} onPatient={openPatient} />;
    if (view === "inventory") return <InventoryView />;
    if (view === "reports") return <ReportsView consultations={state.consultations} patients={state.patients} />;
    return <SettingsView />;
  };

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${sidebarOpen ? "sidebar-mobile-open" : ""}`}>
      <div className="brand-row"><div className="brand-mark"><Leaf size={16} fill="currentColor" /><PawPrint size={15} /></div><div className="brand-copy"><strong>VetFlow<span> AI</span></strong><small>Veterinary care, in flow</small></div><IconButton label="Close navigation" className="mobile-close" onClick={() => setSidebarOpen(false)}><X size={18} /></IconButton></div>
      <div className="clinic-switcher"><div className="clinic-avatar">VS</div><div className="clinic-copy"><strong>Vetspring Animal Hospital</strong><span>Dr. Sharma’s clinic</span></div><ChevronDown size={15} /></div>
      <nav className="primary-nav"><div className="nav-label">Workspace</div>{navItems.slice(0, 6).map((item) => <NavItem key={item.key} item={item} active={view === item.key} collapsed={sidebarCollapsed} onClick={() => navigate(item.key)} />)}<div className="nav-label nav-label-lower">Manage</div>{navItems.slice(6).map((item) => <NavItem key={item.key} item={item} active={view === item.key} collapsed={sidebarCollapsed} onClick={() => navigate(item.key)} />)}</nav>
      <div className="sidebar-bottom"><div className="demo-card"><div className="demo-dot" /><div><strong>Demo workspace</strong><span>Sample data enabled</span></div></div><button className="collapse-button" onClick={() => setSidebarCollapsed((value) => !value)}><ArrowLeft size={15} /><span>{sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}</span></button></div>
    </aside>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}
    <main className={`main-area ${sidebarCollapsed ? "main-collapsed" : ""}`}>
      <header className="topbar"><div className="mobile-top-brand"><IconButton label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={21} /></IconButton><div className="brand-mark small"><Leaf size={14} fill="currentColor" /><PawPrint size={13} /></div><strong>VetFlow<span> AI</span></strong></div><div className="topbar-left"><div className="breadcrumb"><span>Vetspring Animal Hospital</span><ChevronRight size={14} /><strong>{navItems.find((item) => item.key === view)?.label}</strong></div></div><div className="topbar-right"><div className="global-search"><Search size={16} /><input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Search patients, owners..." /><kbd>⌘ K</kbd>{globalResults.length > 0 && <div className="search-results">{globalResults.map((patient) => <button key={patient.id} onClick={() => { openPatient(patient.id); setGlobalSearch(""); }}><Avatar patient={patient} size="sm" /><span><strong>{patient.name}</strong><small>{patient.owner} · {patient.id}</small></span></button>)}</div>}</div><div className="topbar-date"><span>Today</span><strong>31 Oct 2026</strong></div><div className="notification-wrap"><IconButton label="Notifications" onClick={() => setShowNotifications((value) => !value)}><Bell size={18} /><i /></IconButton>{showNotifications && <div className="notification-popover"><div className="popover-heading"><strong>Notifications</strong><Badge tone="mint">3 new</Badge></div><div className="notification-item"><div className="notification-icon mint"><CheckCircle2 size={16} /></div><div><strong>Prescription approved</strong><span>Bruno’s record is up to date.</span><small>8 min ago</small></div></div><div className="notification-item"><div className="notification-icon amber"><Clock3 size={16} /></div><div><strong>Follow-up due today</strong><span>7 patients are awaiting review.</span><small>32 min ago</small></div></div><div className="notification-item"><div className="notification-icon blue"><CalendarDays size={16} /></div><div><strong>Next appointment</strong><span>Max · General checkup · 10:00 AM</span><small>1 hr ago</small></div></div></div>}</div><div className="doctor-menu"><div className="doctor-avatar">DS</div><div className="doctor-copy"><strong>Dr. Sharma</strong><span>Veterinarian</span></div><ChevronDown size={14} /></div></div></header>
      <div className="content-area">{renderView()}</div>
    </main>
    {showRegister && <RegisterModal onClose={() => setShowRegister(false)} onSave={savePatient} />}
    {showAppointmentForm && <AppointmentModal onClose={() => setShowAppointmentForm(false)} onSave={(appointment) => { setState((current) => ({ ...current, appointments: [...(current.appointments ?? seedAppointments), appointment] })); setShowAppointmentForm(false); notify("Appointment added to today’s schedule"); }} />}
    {detailConsultation && <ConsultationDetailModal consultation={detailConsultation} patient={state.patients.find((patient) => patient.id === detailConsultation.patientId) ?? selectedPatient} onClose={() => setDetailConsultation(null)} onPrint={() => window.print()} />}
  </div>;
}

function NavItem({ item, active, collapsed, onClick }: { item: { key: ViewKey; label: string; icon: LucideIcon; badge?: string }; active: boolean; collapsed: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return <button className={`nav-item ${active ? "nav-item-active" : ""}`} onClick={onClick} title={collapsed ? item.label : undefined}><Icon size={17} /><span>{item.label}</span>{item.badge && <em>{item.badge}</em>}</button>;
}

function Dashboard({ patients, consultations, appointments = seedAppointments, onRegister, onNewConsultation, onPatients, onPrescriptions, onSchedule, onOpenPatient, onOpenConsultation }: { patients: Patient[]; consultations: Consultation[]; appointments?: Appointment[]; onRegister: () => void; onNewConsultation: () => void; onPatients: () => void; onPrescriptions: () => void; onSchedule: () => void; onOpenPatient: (id: string, tab?: string) => void; onOpenConsultation: (consultation: Consultation) => void }) {
  return <div className="page-stack"><div className="page-header dashboard-header"><div><div className="eyebrow"><span className="live-dot" /> Saturday, 31 October 2026</div><h1>Good morning, Dr. Sharma</h1><p>Here’s what’s happening at your clinic today.</p></div><div className="header-actions"><Button variant="secondary" onClick={onRegister}><UserPlus size={16} /> Register patient</Button><Button onClick={onNewConsultation}><Mic size={16} /> New consultation</Button></div></div><div className="demo-banner"><div className="banner-icon"><Sparkles size={17} /></div><div><strong>Demo workspace</strong><span>Explore VetFlow AI with realistic sample data. Changes you make will persist locally in this browser.</span></div><button onClick={onPatients}>View patients <ArrowRight size={14} /></button></div><div className="stat-grid"><StatCard label="Total registered patients" value="1,248" delta="12%" detail="vs. last month" icon={PawPrint} tone="green" /><StatCard label="Today’s consultations" value="18" delta="4" detail="scheduled today" icon={Stethoscope} tone="blue" /><StatCard label="Pending follow-ups" value="7" delta="2" detail="need your attention" icon={Clock3} tone="amber" /><StatCard label="Prescriptions generated" value="14" delta="18%" detail="this month" icon={ClipboardList} tone="purple" /></div><div className="dashboard-grid"><section className="card appointments-card"><div className="card-heading"><div><div className="eyebrow">Today · 31 Oct</div><h3>Today’s appointments</h3></div><button className="text-button" onClick={onSchedule}>View calendar <ArrowRight size={14} /></button></div><div className="appointment-list">{appointments.map((appointment) => <div key={appointment.time} className="appointment-row"><div className="appointment-time">{appointment.time}</div><div className="appointment-pet"><div className={`mini-pet ${appointment.pet === "Coco" ? "cow" : ""}`}><PawPrint size={14} /></div><div><strong>{appointment.pet}</strong><span>{appointment.owner}</span></div></div><div className="appointment-type">{appointment.reason}</div><StatusBadge status={appointment.status} /></div>)}</div><div className="card-footer"><span><span className="status-dot green" /> 4 visits completed</span><span><span className="status-dot grey" /> 14 remaining today</span></div></section><section className="card action-card"><div className="card-heading"><div><div className="eyebrow">Shortcuts</div><h3>Quick actions</h3></div><Zap size={17} className="muted-icon" /></div><div className="quick-action-list"><QuickAction icon={Mic} title="New consultation" description="Record and structure a visit" prominent onClick={onNewConsultation} /><QuickAction icon={UserPlus} title="Register patient" description="Create a new patient record" onClick={onRegister} /><QuickAction icon={ClipboardList} title="View prescriptions" description="Review recent approvals" onClick={onPrescriptions} /><QuickAction icon={CalendarDays} title="Schedule appointment" description="Add a visit to the calendar" onClick={onSchedule} /></div></section></div><div className="dashboard-grid lower-grid"><section className="card"><div className="card-heading"><div><div className="eyebrow">Patient directory</div><h3>Recent patients</h3></div><button className="text-button" onClick={onPatients}>View all <ArrowRight size={14} /></button></div><div className="recent-patients">{patients.slice(0, 4).map((patient) => <button key={patient.id} className="recent-patient-row" onClick={() => onOpenPatient(patient.id)}><Avatar patient={patient} /><span><strong>{patient.name}</strong><small>{patient.species} · {patient.breed}</small></span><span className="recent-owner">{patient.owner}<small>Last visit {patient.lastVisit}</small></span><ChevronRight size={15} className="row-chevron" /></button>)}</div></section><section className="card"><div className="card-heading"><div><div className="eyebrow">Care activity</div><h3>Recent consultations</h3></div><button className="text-button" onClick={() => onOpenConsultation(consultations[0])}>See history <ArrowRight size={14} /></button></div><div className="consultation-feed">{consultations.slice(0, 3).map((consultation) => { const patient = patients.find((item) => item.id === consultation.patientId); return <button key={consultation.id} className="feed-row" onClick={() => onOpenConsultation(consultation)}><div className="feed-icon"><Stethoscope size={15} /></div><div><strong>{patient?.name} · {consultation.reason}</strong><span>{consultation.complaint}</span></div><div className="feed-time">{consultation.date}<small>{consultation.time}</small></div></button>; })}</div></section></div></div>;
}

function StatCard({ label, value, delta, detail, icon: Icon, tone }: { label: string; value: string; delta: string; detail: string; icon: LucideIcon; tone: string }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={18} /></div><div className="stat-main"><span>{label}</span><strong>{value}</strong><small><b className={tone === "amber" ? "down" : "up"}>{tone === "amber" ? "↓" : "↑"} {delta}</b> {detail}</small></div><MoreHorizontal size={16} className="stat-more" /></div>;
}

function QuickAction({ icon: Icon, title, description, prominent, onClick }: { icon: LucideIcon; title: string; description: string; prominent?: boolean; onClick: () => void }) {
  return <button className={`quick-action ${prominent ? "quick-action-prominent" : ""}`} onClick={onClick}><div className="quick-action-icon"><Icon size={17} /></div><div><strong>{title}</strong><span>{description}</span></div><ChevronRight size={15} /></button>;
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "Completed" || status === "Approved" ? "success" : status === "In Progress" || status === "Draft" ? "warning" : "info";
  return <Badge tone={tone}>{status}</Badge>;
}

function PatientsView({ patients, selectedPatient, patientSearch, setPatientSearch, speciesFilter, setSpeciesFilter, onRegister, onOpenPatient, onNewConsultation, profileTab, setProfileTab, consultations, onOpenConsultation }: { patients: Patient[]; selectedPatient: Patient; patientSearch: string; setPatientSearch: (value: string) => void; speciesFilter: string; setSpeciesFilter: (value: string) => void; onRegister: () => void; onOpenPatient: (id: string, tab?: string) => void; onNewConsultation: (patient?: Patient) => void; profileTab: string; setProfileTab: (value: string) => void; consultations: Consultation[]; onOpenConsultation: (consultation: Consultation) => void }) {
  const [showProfile, setShowProfile] = useState(true);
  const tabs = ["Overview", "Medical History", "Consultations", "Prescriptions", "Vaccinations", "Documents"];
  return <div className="page-stack"><div className="page-header"><div><div className="eyebrow">Patient management</div><h1>Patients</h1><p>One clear record for every animal in your care.</p></div><Button onClick={onRegister}><UserPlus size={16} /> Register patient</Button></div>{showProfile ? <div className="patient-workspace"><section className="patient-directory card"><div className="directory-toolbar"><div className="search-field"><Search size={16} /><input value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} placeholder="Search by patient, owner, or ID" /></div><div className="filter-select"><Filter size={14} /><select value={speciesFilter} onChange={(event) => setSpeciesFilter(event.target.value)}><option>All species</option><option>Dog</option><option>Cat</option><option>Cow</option></select></div><IconButton label="More filters"><MoreHorizontal size={17} /></IconButton></div><div className="directory-meta"><span>{patients.length} visible patients</span><span><span className="status-dot green" /> Sample data</span></div><div className="patient-table-wrap"><table className="patient-table"><thead><tr><th>Patient</th><th>Species & breed</th><th>Age / sex</th><th>Owner</th><th>Last consultation</th><th>Status</th><th /></tr></thead><tbody>{patients.map((patient) => <tr key={patient.id} className={patient.id === selectedPatient.id ? "selected-row" : ""} onClick={() => onOpenPatient(patient.id)}><td><div className="table-patient"><Avatar patient={patient} size="sm" /><div><strong>{patient.name}</strong><span>{patient.id}</span></div></div></td><td><strong>{patient.species}</strong><span className="cell-subtle">{patient.breed}</span></td><td><strong>{patient.age}</strong><span className="cell-subtle">{patient.gender} · {patient.weight}</span></td><td><strong>{patient.owner}</strong><span className="cell-subtle">{patient.phone}</span></td><td>{patient.lastVisit}</td><td><Badge tone={patient.status === "Active" ? "success" : "neutral"}>{patient.status}</Badge></td><td><ChevronRight size={15} className="row-chevron" /></td></tr>)}</tbody></table>{patients.length === 0 && <EmptyState title="No patients found" description="Try another search or filter." />}</div></section><section className="patient-profile card">{selectedPatient ? <><div className="profile-header"><div className="profile-identity"><Avatar patient={selectedPatient} size="lg" /><div><div className="profile-kicker"><Badge tone="success">Active patient</Badge><span>{selectedPatient.id}</span></div><h2>{selectedPatient.name}</h2><p>{selectedPatient.species} · {selectedPatient.breed} · {selectedPatient.age}</p></div></div><div className="profile-actions"><IconButton label="More actions"><MoreHorizontal size={17} /></IconButton><Button variant="secondary" onClick={() => onNewConsultation(selectedPatient)}><Mic size={15} /> New consultation</Button></div></div><div className="owner-strip"><div className="owner-avatar">{initials(selectedPatient.owner)}</div><div><span>Owner</span><strong>{selectedPatient.owner}</strong></div><div className="owner-contact"><Phone size={14} /> {selectedPatient.phone}</div><div className="owner-contact"><CalendarDays size={14} /> Last visit {selectedPatient.lastVisit}</div></div><div className="profile-tabs">{tabs.map((tab) => <button className={profileTab === tab ? "active" : ""} key={tab} onClick={() => setProfileTab(tab)}>{tab}</button>)}</div>{profileTab === "Overview" && <ProfileOverview patient={selectedPatient} consultations={consultations} onOpenConsultation={onOpenConsultation} />}{profileTab === "Medical History" && <MedicalHistory consultations={consultations} onOpenConsultation={onOpenConsultation} />}{profileTab === "Consultations" && <ConsultationMiniList consultations={consultations} onOpenConsultation={onOpenConsultation} />}{profileTab === "Prescriptions" && <PrescriptionMiniList consultations={consultations} onOpenConsultation={onOpenConsultation} />}{["Vaccinations", "Documents"].includes(profileTab) && <EmptyState title={`${profileTab} are ready for your workflow`} description="This demo module is prepared for the next phase of the clinic record." />}</> : <EmptyState title="Select a patient" description="Choose a patient from the directory to view their record." />}</section></div> : <section className="card directory-only"><div className="card-heading"><div><div className="eyebrow">Patient directory</div><h3>Search all patients</h3></div><button className="text-button" onClick={() => setShowProfile(true)}>Open profile panel</button></div></section>}</div>;
}

function ProfileOverview({ patient, consultations, onOpenConsultation }: { patient: Patient; consultations: Consultation[]; onOpenConsultation: (consultation: Consultation) => void }) {
  return <div className="profile-body"><div className="profile-stat-row"><ProfileStat label="Current weight" value={patient.weight} /><ProfileStat label="Total consultations" value={String(consultations.length + 2).padStart(2, "0")} /><ProfileStat label="Upcoming follow-up" value={patient.followUp} /><ProfileStat label="Record status" value="Active" /></div><div className="profile-columns"><div><div className="subheading"><h3>Clinical snapshot</h3><span>Updated today</span></div><div className="clinical-list"><ClinicalLine label="Known allergies" value={patient.allergies} icon={ShieldCheck} /><ClinicalLine label="Existing conditions" value={patient.conditions} icon={HeartPulse} /><ClinicalLine label="Current medications" value={patient.medications} icon={ClipboardList} /></div></div><div><div className="subheading"><h3>Medical timeline</h3><button className="text-button">View all <ArrowRight size={13} /></button></div><div className="timeline">{consultations.slice(0, 3).map((consultation, index) => <button key={consultation.id} className="timeline-item" onClick={() => onOpenConsultation(consultation)}><div className={`timeline-dot ${index === 0 ? "current" : ""}`} /><div><strong>{consultation.date}</strong><span>{consultation.reason}</span><small>{consultation.complaint}</small></div><ChevronRight size={14} /></button>)}</div></div></div></div>;
}

function ProfileStat({ label, value }: { label: string; value: string }) { return <div className="profile-stat"><span>{label}</span><strong>{value}</strong></div>; }
function ClinicalLine({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) { return <div className="clinical-line"><div className="clinical-line-icon"><Icon size={15} /></div><div><span>{label}</span><strong>{value}</strong></div></div>; }
function MedicalHistory({ consultations, onOpenConsultation }: { consultations: Consultation[]; onOpenConsultation: (consultation: Consultation) => void }) { return <div className="history-pane"><div className="history-intro"><div><h3>Medical history</h3><p>Every consultation is retained as a separate, reviewable record.</p></div><Badge tone="mint">{consultations.length} visits</Badge></div><div className="timeline large">{consultations.map((consultation) => <button key={consultation.id} className="timeline-item" onClick={() => onOpenConsultation(consultation)}><div className="timeline-dot current" /><div><strong>{consultation.date} · {consultation.time}</strong><span>{consultation.reason}</span><small>{consultation.complaint}</small></div><StatusBadge status={consultation.status} /><ChevronRight size={14} /></button>)}</div></div>; }
function ConsultationMiniList({ consultations, onOpenConsultation }: { consultations: Consultation[]; onOpenConsultation: (consultation: Consultation) => void }) { return <div className="history-pane"><div className="history-intro"><div><h3>Consultations</h3><p>Open any visit to review its transcript, notes, and approval trail.</p></div><Badge tone="info">{consultations.length} records</Badge></div><div className="mini-table">{consultations.map((consultation) => <button key={consultation.id} onClick={() => onOpenConsultation(consultation)}><div className="feed-icon"><Stethoscope size={15} /></div><span><strong>{consultation.reason}</strong><small>{consultation.id} · {consultation.date}</small></span><StatusBadge status={consultation.status} /><ChevronRight size={14} /></button>)}</div></div>; }
function PrescriptionMiniList({ consultations, onOpenConsultation }: { consultations: Consultation[]; onOpenConsultation: (consultation: Consultation) => void }) { const items = consultations.filter((item) => item.medicines.length); return <div className="history-pane"><div className="history-intro"><div><h3>Prescriptions</h3><p>Approved medicines attached to this patient’s chart.</p></div><Badge tone="mint">{items.length} attached</Badge></div>{items.length ? <div className="mini-table">{items.map((consultation) => <button key={consultation.id} onClick={() => onOpenConsultation(consultation)}><div className="feed-icon"><ClipboardList size={15} /></div><span><strong>{consultation.medicines.length} medicines</strong><small>{consultation.id} · {consultation.date}</small></span><StatusBadge status={consultation.approved ? "Approved" : "Draft"} /><ChevronRight size={14} /></button>)}</div> : <EmptyState title="No prescriptions attached" description="Approved prescriptions will appear here." />}</div>; }

function ConsultationView({ selectedPatient, patientConsultations, activeConsultation, phase, elapsed, notesDraft, medicinesDraft, onSelectPatient, onStart, onPause, onResume, onStop, onUploadAudio, onSaveNotes, onSaveDraft, onNotesChange, onGoPrescription, onMedicineChange, onAddMedicine, onRemoveMedicine, onApprove, onOpenConsultation, onBack }: { selectedPatient: Patient; patientConsultations: Consultation[]; activeConsultation: Consultation | null; phase: "ready" | "recording" | "paused" | "processing" | "notes" | "prescription"; elapsed: number; notesDraft: Consultation["notes"] | null; medicinesDraft: Medicine[]; onSelectPatient: (id: string, tab?: string) => void; onStart: () => void; onPause: () => void; onResume: () => void; onStop: () => void; onUploadAudio: (file: File) => void; onSaveNotes: () => void; onSaveDraft: () => void; onNotesChange: (value: Consultation["notes"] | null) => void; onGoPrescription: () => void; onMedicineChange: (id: string, field: keyof Medicine, value: string) => void; onAddMedicine: () => void; onRemoveMedicine: (id: string) => void; onApprove: () => void; onOpenConsultation: (consultation: Consultation) => void; onBack: () => void }) {
  const [patientPicker, setPatientPicker] = useState("");
  const duration = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const phaseLabel = phase === "ready" ? "Ready to record" : phase === "recording" ? "Recording consultation" : phase === "paused" ? "Recording paused" : phase === "processing" ? "Analyzing consultation" : phase === "notes" ? "Review clinical notes" : "Review prescription";
  return <div className="page-stack consultation-page"><div className="page-header"><div><button className="back-link" onClick={onBack}><ArrowLeft size={14} /> Dashboard</button><div className="eyebrow">AI voice consultation</div><h1>New consultation</h1><p>Turn the conversation into a clear, reviewable care record.</p></div><div className="header-actions"><Badge tone="mint"><span className="status-dot green" /> Demo workflow</Badge></div></div><div className="consultation-stepper"><Step number="1" label="Patient" active={phase === "ready" || phase === "recording" || phase === "paused" || phase === "processing"} done={Boolean(activeConsultation?.transcription)} /><Step number="2" label="Voice capture" active={phase === "recording" || phase === "paused" || phase === "processing"} done={Boolean(activeConsultation?.transcription)} /><Step number="3" label="Clinical notes" active={phase === "notes"} done={phase === "prescription"} /><Step number="4" label="Prescription" active={phase === "prescription"} done={Boolean(activeConsultation?.approved)} /></div><div className="consultation-layout"><section className="consultation-main"><div className="card patient-context"><div className="patient-context-main"><Avatar patient={selectedPatient} size="md" /><div><div className="eyebrow">Selected patient</div><h3>{selectedPatient.name} <span>{selectedPatient.id}</span></h3><p>{selectedPatient.species} · {selectedPatient.breed} · {selectedPatient.age} · {selectedPatient.weight}</p></div></div><div className="patient-context-owner"><span>Owner</span><strong>{selectedPatient.owner}</strong><small>{selectedPatient.phone}</small></div><div className="picker-wrap"><button className="text-button" onClick={() => setPatientPicker((value) => value ? "" : "open")}>Change patient <ChevronDown size={13} /></button>{patientPicker && <div className="picker-popover"><button onClick={() => { onSelectPatient("VET-2026-00124"); setPatientPicker(""); }}>Bruno · Rahul Sharma</button><button onClick={() => { onSelectPatient("VET-2026-00125"); setPatientPicker(""); }}>Bella · Priya Patel</button><button onClick={() => { onSelectPatient("VET-2026-00126"); setPatientPicker(""); }}>Max · Amit Verma</button><button onClick={() => { onSelectPatient("VET-2026-00127"); setPatientPicker(""); }}>Coco · Ramesh Pawar</button><button onClick={() => { onSelectPatient("VET-2026-00128"); setPatientPicker(""); }}>Oreo · Neha Singh</button></div>}</div></div>{phase === "notes" || phase === "prescription" ? <DocumentationPanel phase={phase} activeConsultation={activeConsultation} patient={selectedPatient} notesDraft={notesDraft} medicinesDraft={medicinesDraft} onSaveNotes={onSaveNotes} onSaveDraft={onSaveDraft} onNotesChange={onNotesChange} onGoPrescription={onGoPrescription} onMedicineChange={onMedicineChange} onAddMedicine={onAddMedicine} onRemoveMedicine={onRemoveMedicine} onApprove={onApprove} /> : <RecordingPanel phase={phase} phaseLabel={phaseLabel} duration={duration} onStart={onStart} onPause={onPause} onResume={onResume} onStop={onStop} onUploadAudio={onUploadAudio} transcription={activeConsultation?.transcription ?? ""} />}</section><aside className="consultation-aside"><div className="card history-card"><div className="card-heading"><div><div className="eyebrow">Patient context</div><h3>Previous history</h3></div><Badge tone="neutral">{patientConsultations.length} records</Badge></div>{patientConsultations.slice(0, 3).map((consultation) => <button className="history-row" key={consultation.id} onClick={() => onOpenConsultation(consultation)}><div className="history-date"><strong>{consultation.date.split(" ")[0]}</strong><span>{consultation.date.split(" ").slice(1).join(" ")}</span></div><div><strong>{consultation.reason}</strong><span>{consultation.complaint}</span></div><ChevronRight size={14} /></button>)}<div className="privacy-note"><ShieldCheck size={14} /><span>Previous records stay separate. Nothing is overwritten.</span></div></div><div className="card guidance-card"><div className="guidance-icon"><Sparkles size={18} /></div><div><strong>AI documentation guardrails</strong><p>VetFlow only structures what was said. Diagnosis and treatment remain in the veterinarian’s hands.</p></div></div></aside></div></div>;
}

function Step({ number, label, active, done }: { number: string; label: string; active: boolean; done: boolean }) { return <div className={`step ${active ? "active" : ""} ${done ? "done" : ""}`}><div className="step-number">{done ? <Check size={14} /> : number}</div><span>{label}</span></div>; }

function RecordingPanel({ phase, phaseLabel, duration, onStart, onPause, onResume, onStop, onUploadAudio, transcription }: { phase: string; phaseLabel: string; duration: string; onStart: () => void; onPause: () => void; onResume: () => void; onStop: () => void; onUploadAudio: (file: File) => void; transcription: string }) {
  const isRecording = phase === "recording";
  const isPaused = phase === "paused";
  const isProcessing = phase === "processing";
  return <div className="card recording-card"><div className="recording-top"><div><div className="eyebrow">Voice capture</div><h2>{isProcessing ? "Analyzing consultation…" : transcription ? "Consultation transcribed" : "Record the consultation"}</h2><p>{isProcessing ? "VetFlow AI is organizing the clinical information. This usually takes a few seconds." : transcription ? "Your transcript is ready for a clinical review." : "Speak naturally. You can pause at any time and review everything before it enters the chart."}</p></div><Badge tone={isProcessing ? "info" : transcription ? "success" : isPaused ? "warning" : isRecording ? "danger" : "neutral"}><span className={`status-dot ${isProcessing || isRecording ? "red" : transcription ? "green" : "grey"}`} /> {isProcessing ? "Processing" : phaseLabel}</Badge></div>{transcription ? <div className="transcription-preview"><div className="transcript-label"><CheckCircle2 size={15} /> Consultation Successfully Transcribed <span>Demo transcript</span></div><p>“{transcription}”</p><div className="transcript-actions"><Button variant="secondary" onClick={() => {}}>Play recording</Button><Button onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })}>Review clinical notes <ArrowRight size={15} /></Button></div></div> : <><div className={`recording-stage ${isRecording ? "is-recording" : ""} ${isPaused ? "is-paused" : ""} ${isProcessing ? "is-processing" : ""}`}><div className="waveform">{Array.from({ length: 32 }).map((_, index) => <i key={index} style={{ height: `${18 + ((index * 17) % 40)}px`, animationDelay: `${index * 0.035}s` }} />)}</div><div className="mic-orb"><div className="mic-halo" /><div className="mic-button"><Mic size={32} /></div></div><strong>{isProcessing ? "Structuring clinical notes" : isRecording ? "Listening…" : isPaused ? "Paused" : "Ready when you are"}</strong><span>{duration} {isRecording || isPaused ? "· recording time" : ""}</span></div><div className="recording-controls">{phase === "ready" && <Button onClick={onStart}><Mic size={17} /> Start recording</Button>}{phase === "recording" && <><Button variant="secondary" onClick={onPause}><span className="pause-bars" /> Pause</Button><Button variant="danger" onClick={onStop}><span className="stop-square" /> Stop & process</Button></>}{phase === "paused" && <><Button onClick={onResume}><Mic size={17} /> Resume recording</Button><Button variant="danger" onClick={onStop}><span className="stop-square" /> Stop & process</Button></>}{phase === "processing" && <Button disabled><span className="button-spinner" /> Analyzing…</Button>}</div><div className="upload-audio"><input id="vetflow-audio-upload" type="file" accept="audio/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) onUploadAudio(file); event.currentTarget.value = ""; }} /><label htmlFor="vetflow-audio-upload"><Download size={14} /> Upload audio file</label><span>MP3, WAV, M4A · max 50 MB</span></div></>}</div>;
}

function DocumentationPanel({ phase, activeConsultation, patient, notesDraft, medicinesDraft, onSaveNotes, onSaveDraft, onNotesChange, onGoPrescription, onMedicineChange, onAddMedicine, onRemoveMedicine, onApprove }: { phase: "notes" | "prescription"; activeConsultation: Consultation | null; patient: Patient; notesDraft: Consultation["notes"] | null; medicinesDraft: Medicine[]; onSaveNotes: () => void; onSaveDraft: () => void; onNotesChange: (value: Consultation["notes"] | null) => void; onGoPrescription: () => void; onMedicineChange: (id: string, field: keyof Medicine, value: string) => void; onAddMedicine: () => void; onRemoveMedicine: (id: string) => void; onApprove: () => void }) {
  if (phase === "prescription") return <PrescriptionEditor medicines={medicinesDraft} onMedicineChange={onMedicineChange} onAddMedicine={onAddMedicine} onRemoveMedicine={onRemoveMedicine} onApprove={onApprove} onSaveDraft={onSaveDraft} />;
  const update = (field: keyof Consultation["notes"], value: string) => notesDraft && onNotesChange({ ...notesDraft, [field]: value });
  return <div className="card documentation-card"><div className="documentation-header"><div><div className="eyebrow">AI-generated documentation</div><h2>Review clinical notes</h2><p>VetFlow extracted these details from the recording. Edit anything before saving.</p></div><Badge tone="mint"><Sparkles size={13} /> Extracted from speech</Badge></div><div className="source-note"><AlertCircle size={15} /><span>Diagnosis and treatment are intentionally left for doctor confirmation. VetFlow never invents clinical findings.</span></div><div className="editable-notes"><EditableNote label="Patient" value={activeConsultation ? `${patient.name} · ${patient.age} · ${patient.breed} · ${patient.weight}` : ""} onChange={() => {}} readOnly /><EditableNote label="Chief complaint" value={notesDraft?.complaint ?? ""} onChange={(value) => update("complaint", value)} /><EditableNote label="Duration" value={notesDraft?.duration ?? ""} onChange={(value) => update("duration", value)} /><EditableNote label="Clinical examination" value={notesDraft?.examination ?? ""} onChange={(value) => update("examination", value)} /><EditableNote label="Diagnosis" value={notesDraft?.diagnosis ?? ""} onChange={(value) => update("diagnosis", value)} hint="Doctor confirmation" /><EditableNote label="Treatment plan" value={notesDraft?.treatment ?? ""} onChange={(value) => update("treatment", value)} /><EditableNote label="Follow-up" value={notesDraft?.followUp ?? ""} onChange={(value) => update("followUp", value)} /></div><div className="documentation-footer"><span><ShieldCheck size={14} /> Review required before this becomes part of the chart.</span><div><Button variant="secondary" onClick={onSaveNotes}>Save notes</Button><Button onClick={() => { onSaveNotes(); onGoPrescription(); }}>Continue to prescription <ArrowRight size={15} /></Button></div></div></div>;
}

function EditableNote({ label, value, onChange, readOnly = false, hint }: { label: string; value: string; onChange: (value: string) => void; readOnly?: boolean; hint?: string }) { return <label className="editable-note"><span>{label} {hint && <em>{hint}</em>}</span><textarea readOnly={readOnly} value={value} onChange={(event) => onChange(event.target.value)} rows={value.length > 80 ? 3 : 2} /></label>; }

function PrescriptionEditor({ medicines, onMedicineChange, onAddMedicine, onRemoveMedicine, onApprove, onSaveDraft }: { medicines: Medicine[]; onMedicineChange: (id: string, field: keyof Medicine, value: string) => void; onAddMedicine: () => void; onRemoveMedicine: (id: string) => void; onApprove: () => void; onSaveDraft: () => void }) { return <div className="card prescription-editor"><div className="documentation-header"><div><div className="eyebrow">Automatic prescription extraction</div><h2>Review prescription</h2><p>Fictional demonstration entries extracted for your review. Nothing is final until you approve it.</p></div><Badge tone="warning">Draft · needs approval</Badge></div><div className="source-note"><AlertCircle size={15} /><span>These are fictional demo medicines, not treatment recommendations.</span></div><div className="medicine-list">{medicines.map((medicine, index) => <div className="medicine-card" key={medicine.id}><div className="medicine-card-heading"><div className="medicine-number">{String(index + 1).padStart(2, "0")}</div><div><strong>{medicine.name || "New medicine"}</strong><span>Medicine {index + 1} · extracted from consultation</span></div>{medicines.length > 1 && <IconButton label="Remove medicine" onClick={() => onRemoveMedicine(medicine.id)}><X size={16} /></IconButton>}</div><div className="medicine-fields"><Field label="Medicine name" value={medicine.name} onChange={(value) => onMedicineChange(medicine.id, "name", value)} /><Field label="Strength / concentration" value={medicine.strength} onChange={(value) => onMedicineChange(medicine.id, "strength", value)} /><Field label="Dosage" value={medicine.dosage} onChange={(value) => onMedicineChange(medicine.id, "dosage", value)} /><Field label="Route" value={medicine.route} onChange={(value) => onMedicineChange(medicine.id, "route", value)} /><Field label="Frequency" value={medicine.frequency} onChange={(value) => onMedicineChange(medicine.id, "frequency", value)} /><Field label="Duration" value={medicine.duration} onChange={(value) => onMedicineChange(medicine.id, "duration", value)} /><Field label="Special instructions" value={medicine.instructions} onChange={(value) => onMedicineChange(medicine.id, "instructions", value)} wide /></div></div>)}</div><button className="add-medicine" onClick={onAddMedicine}><Plus size={15} /> Add medicine</button><div className="prescription-footer"><span><ShieldCheck size={14} /> Final approval updates the patient history.</span><div><Button variant="secondary" onClick={onSaveDraft}>Save as draft</Button><Button onClick={onApprove}><Check size={16} /> Approve prescription</Button></div></div></div>; }
function Field({ label, value, onChange, wide = false, type = "text", inputMode, autoComplete }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; autoComplete?: string }) { return <label className={`field ${wide ? "field-wide" : ""}`}><span>{label}</span><input type={type} inputMode={inputMode} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }

function PrescriptionsView({ prescriptions, patients, filter, setFilter, onOpen, onPrint }: { prescriptions: Consultation[]; patients: Patient[]; filter: string; setFilter: (value: string) => void; onOpen: (consultation: Consultation) => void; onPrint: () => void }) { const visible = prescriptions.filter((item) => filter === "All" || (filter === "Approved" ? item.approved : !item.approved)); const previewPatient = visible[0] ? patients.find((patient) => patient.id === visible[0].patientId) : undefined; return <div className="page-stack"><div className="page-header"><div><div className="eyebrow">Medication management</div><h1>Prescriptions</h1><p>Review every medicine before it leaves the clinic.</p></div><Button onClick={onPrint}><Printer size={16} /> Print latest</Button></div><div className="demo-banner compact"><div className="banner-icon"><ShieldCheck size={17} /></div><div><strong>Doctor approval is the final gate</strong><span>Drafts stay editable. Approved prescriptions are attached to the patient’s chart and ready to print.</span></div></div><div className="card"><div className="table-toolbar"><div className="filter-pills">{["All", "Approved", "Draft"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}{item === "All" && <span>{prescriptions.length}</span>}</button>)}</div><div className="search-field compact-search"><Search size={15} /><input placeholder="Search prescriptions" /></div></div><div className="patient-table-wrap"><table className="patient-table prescription-table"><thead><tr><th>Prescription ID</th><th>Patient</th><th>Owner</th><th>Consultation date</th><th>Doctor</th><th>Medicines</th><th>Status</th><th /></tr></thead><tbody>{visible.map((consultation) => { const patient = patients.find((item) => item.id === consultation.patientId); return <tr key={consultation.id} onClick={() => onOpen(consultation)}><td><strong>RX-{consultation.id.split("-").pop()}</strong></td><td><strong>{patient?.name ?? "Patient"}</strong></td><td>{patient?.owner ?? "Clinic owner"}</td><td>{consultation.date}</td><td>{consultation.doctor}</td><td>{consultation.medicines.length} items</td><td><StatusBadge status={consultation.approved ? "Approved" : "Draft"} /></td><td><ChevronRight size={15} className="row-chevron" /></td></tr>; })}</tbody></table>{visible.length === 0 && <EmptyState title="No prescriptions in this view" description="Approved and draft prescriptions will appear here." />}</div></div><PrescriptionDocument consultation={visible[0]} patient={previewPatient} onPrint={onPrint} /></div>; }

function PrescriptionDocument({ consultation, patient, onPrint }: { consultation?: Consultation; patient?: Patient; onPrint: () => void }) { if (!consultation) return null; return <div className="card prescription-document"><div className="document-toolbar"><div><div className="eyebrow">Preview</div><h3>Prescription document</h3></div><div><Button variant="quiet" onClick={onPrint}><Printer size={14} /> Print</Button><Button variant="secondary" onClick={() => toast.success("PDF export prepared for download") }><Download size={14} /> Download PDF</Button></div></div><div className="document-paper"><div className="document-brand"><div className="brand-mark"><Leaf size={15} fill="currentColor" /><PawPrint size={14} /></div><div><strong>Vetspring Animal Hospital</strong><span>Compassionate care, intelligently documented</span></div><div className="document-id">RX-{consultation.id.split("-").pop()}<small>{consultation.date}</small></div></div><div className="document-patient-grid"><div><span>Patient</span><strong>{patient?.name ?? "Patient"} · {patient?.breed ?? "Animal"}</strong></div><div><span>Owner</span><strong>{patient?.owner ?? "Clinic owner"}</strong></div><div><span>Doctor</span><strong>{consultation.doctor}</strong></div></div><div className="document-section"><span className="document-label">Clinical notes</span><p>{consultation.notes.complaint}. {consultation.notes.examination}</p></div><div className="document-section"><span className="document-label">Medicines</span><table><thead><tr><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th></tr></thead><tbody>{consultation.medicines.map((medicine) => <tr key={medicine.id}><td><strong>{medicine.name}</strong><small>{medicine.strength}</small></td><td>{medicine.dosage}</td><td>{medicine.frequency}</td><td>{medicine.duration}</td></tr>)}</tbody></table></div><div className="document-followup"><div><span className="document-label">Follow-up</span><strong>{consultation.notes.followUp || "As advised by veterinarian"}</strong></div><div className="signature-line"><span>Doctor signature</span></div></div><div className="document-footnote"><ShieldCheck size={13} /> This is a demonstration prescription document. Verify all details before dispensing.</div></div></div>; }

function AppointmentsView({ appointments, onNew, onPatient }: { appointments: Appointment[]; onNew: () => void; onPatient: (id: string, tab?: string) => void }) { const [mode, setMode] = useState("Day"); return <div className="page-stack"><div className="page-header"><div><div className="eyebrow">Clinic schedule</div><h1>Appointments</h1><p>Keep the day moving without losing the care context.</p></div><Button onClick={onNew}><Plus size={16} /> Schedule appointment</Button></div><div className="calendar-toolbar card"><div className="calendar-date"><IconButton label="Previous day"><ArrowLeft size={16} /></IconButton><div><strong>Saturday, 31 October 2026</strong><span>18 appointments · 7 follow-ups pending</span></div><IconButton label="Next day"><ArrowRight size={16} /></IconButton></div><div className="view-pills">{["Day", "Week", "Month"].map((item) => <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{item}</button>)}</div></div><div className="card schedule-card"><div className="schedule-note"><CalendarDays size={16} /><span>Showing {mode.toLowerCase()} view · All times in IST</span><button className="text-button">Filter schedule <Filter size={13} /></button></div><div className="schedule-list">{appointments.map((item) => <button key={item.id} className="schedule-row" onClick={() => onPatient(item.pet === "Bruno" ? "VET-2026-00124" : item.pet === "Bella" ? "VET-2026-00125" : item.pet === "Max" ? "VET-2026-00126" : item.pet === "Coco" ? "VET-2026-00127" : "VET-2026-00128")}><div className="schedule-time">{item.time}</div><div className="schedule-line"><span className="schedule-dot" /></div><div className="schedule-patient"><div className="mini-pet"><PawPrint size={14} /></div><div><strong>{item.pet}</strong><span>{item.owner}</span></div></div><div className="schedule-reason"><strong>{item.reason}</strong><span>{item.doctor}</span></div><StatusBadge status={item.status} /><ChevronRight size={15} /></button>)}</div></div></div>; }

function InventoryView() { return <div className="page-stack"><div className="page-header"><div><div className="eyebrow">Operations · Future module</div><h1>Inventory</h1><p>A clear view of medicines, batches, and clinic readiness is coming next.</p></div><Badge tone="warning"><Clock3 size={13} /> Coming soon</Badge></div><div className="inventory-hero card"><div className="inventory-hero-copy"><div className="coming-soon-icon"><FolderOpen size={22} /></div><h2>Stock management, without the guesswork.</h2><p>VetFlow Inventory will connect approved prescriptions to stock levels, batches, expiry dates, and supplier records. Keep the care workflow moving while your team stays in control.</p><div className="inventory-rule"><ShieldCheck size={16} /><span>Stock is deducted only after dispensing confirmation — never when a prescription is drafted.</span></div></div><div className="inventory-preview"><div className="preview-heading"><span>Planned workspace</span><Badge tone="neutral">Preview</Badge></div>{["Medicine catalogue", "Stock availability", "Expiry & batch tracking", "Low-stock alerts", "Supplier records", "Inventory reports"].map((item, index) => <div className="preview-row" key={item}><div className="preview-check"><Check size={13} /></div><span>{item}</span><small>{index < 2 ? "Next" : "Planned"}</small></div>)}</div></div></div>; }

function ReportsView({ consultations, patients }: { consultations: Consultation[]; patients: Patient[] }) { return <div className="page-stack"><div className="page-header"><div><div className="eyebrow">Practice intelligence</div><h1>Reports</h1><p>See where your team is spending time and where care is moving forward.</p></div><Button variant="secondary" onClick={() => toast.success("Report export prepared") }><Download size={16} /> Export report</Button></div><div className="report-grid"><div className="card report-highlight"><div className="eyebrow">Documentation velocity</div><strong>34 min</strong><p>saved per clinician today through voice documentation.</p><div className="report-sparkline">{[22, 35, 28, 48, 42, 57, 64, 58, 76, 82].map((height, index) => <i style={{ height }} key={index} />)}</div><span className="report-foot"><b>↑ 18%</b> vs. last month</span></div><div className="card report-stat"><div className="stat-icon green"><PawPrint size={18} /></div><span>Active patient records</span><strong>{patients.length + 1243}</strong><small>Across 5 species</small></div><div className="card report-stat"><div className="stat-icon blue"><Stethoscope size={18} /></div><span>Completed consultations</span><strong>{consultations.length + 15}</strong><small>In the current period</small></div></div><div className="card report-table"><div className="card-heading"><div><div className="eyebrow">This month</div><h3>Care activity by module</h3></div><Badge tone="mint">31 Oct 2026</Badge></div>{[["Consultations", "18", "84%", "green"], ["Prescriptions", "14", "72%", "blue"], ["Follow-ups", "7", "48%", "amber"], ["New patients", "11", "36%", "purple"]].map(([label, count, percent, tone]) => <div className="report-bar-row" key={label}><span>{label}</span><div className="report-bar"><i className={tone} style={{ width: percent }} /></div><strong>{count}</strong><small>{percent}</small></div>)}</div></div>; }

function SettingsView() { return <div className="page-stack"><div className="page-header"><div><div className="eyebrow">Workspace preferences</div><h1>Settings</h1><p>Make VetFlow feel right for your clinic and your care team.</p></div><Button onClick={() => toast.success("Settings saved")}>Save changes</Button></div><div className="settings-layout"><div className="card settings-nav"><button className="active"><Settings size={16} /> Clinic profile</button><button><Users size={16} /> Team members</button><button><Bell size={16} /> Notifications</button><button><ShieldCheck size={16} /> Data & privacy</button></div><div className="card settings-form"><div className="card-heading"><div><div className="eyebrow">Clinic profile</div><h3>Vetspring Animal Hospital</h3><p>These details appear on prescription documents and care records.</p></div><Badge tone="success">Saved</Badge></div><div className="settings-grid"><Field label="Clinic name" value="Vetspring Animal Hospital" onChange={() => {}} /><Field label="Primary veterinarian" value="Dr. Sharma" onChange={() => {}} /><Field label="Phone" value="+91 98765 00000" onChange={() => {}} /><Field label="Email" value="care@vetspring.example" onChange={() => {}} /><Field label="Address" value="14 Green Park Road, New Delhi" onChange={() => {}} wide /></div><div className="settings-divider" /><div className="preference-row"><div><strong>Demo data label</strong><span>Keep sample content clearly marked during pilot demonstrations.</span></div><div className="toggle active"><i /></div></div><div className="preference-row"><div><strong>AI review reminders</strong><span>Ask for doctor approval before records and prescriptions are finalized.</span></div><div className="toggle active"><i /></div></div></div></div></div>; }

function EmptyState({ title, description }: { title: string; description: string }) { return <div className="empty-state"><div className="empty-icon"><FolderOpen size={20} /></div><strong>{title}</strong><span>{description}</span></div>; }

function RegisterModal({ onClose, onSave }: { onClose: () => void; onSave: (form: Record<string, string>) => void }) { const [form, setForm] = useState<Record<string, string>>({ species: "Dog", gender: "Male" }); const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value })); return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card register-modal"><div className="modal-header"><div><div className="eyebrow">New patient record</div><h2>Register a patient</h2><p>Capture the essentials now. You can enrich the record over time.</p></div><IconButton label="Close" onClick={onClose}><X size={18} /></IconButton></div><div className="modal-form"><div className="form-section-title">Pet information</div><div className="form-grid"><Field label="Pet name *" value={form.name ?? ""} onChange={(value) => update("name", value)} /><label className="field"><span>Species</span><select value={form.species ?? "Dog"} onChange={(event) => update("species", event.target.value)}>{["Dog", "Cat", "Cow", "Buffalo", "Goat", "Horse", "Other"].map((species) => <option key={species}>{species}</option>)}</select></label><Field label="Breed" value={form.breed ?? ""} onChange={(value) => update("breed", value)} /><Field label="Age" value={form.age ?? ""} onChange={(value) => update("age", value)} /><label className="field"><span>Gender</span><select value={form.gender ?? "Male"} onChange={(event) => update("gender", event.target.value)}><option>Male</option><option>Female</option><option>Unknown</option></select></label><Field label="Weight (kg)" inputMode="decimal" value={form.weight ?? ""} onChange={(value) => update("weight", value)} /><Field label="Colour" value={form.colour ?? ""} onChange={(value) => update("colour", value)} /><Field label="Microchip / ID" value={form.microchip ?? ""} onChange={(value) => update("microchip", value)} /><Field label="Allergies" value={form.allergies ?? ""} onChange={(value) => update("allergies", value)} wide /><Field label="Existing conditions" value={form.conditions ?? ""} onChange={(value) => update("conditions", value)} wide /></div><div className="form-section-title">Owner information</div><div className="form-grid"><Field label="Owner name *" autoComplete="name" value={form.owner ?? ""} onChange={(value) => update("owner", value)} /><Field label="Phone number *" type="tel" inputMode="tel" autoComplete="tel" value={form.phone ?? ""} onChange={(value) => update("phone", value)} /><Field label="Email" type="email" inputMode="email" autoComplete="email" value={form.email ?? ""} onChange={(value) => update("email", value)} /><Field label="Address" autoComplete="street-address" value={form.address ?? ""} onChange={(value) => update("address", value)} /></div><div className="upload-row"><label className="upload-box" htmlFor="pet-photo-upload"><input id="pet-photo-upload" type="file" accept="image/png,image/jpeg" hidden onChange={(event) => update("photo", event.target.files?.[0]?.name ?? "")} /><Plus size={18} /><span>{form.photo ? form.photo : "Upload pet photograph"}</span><small>JPG or PNG · optional</small></label><div className="upload-copy"><ShieldCheck size={15} /><span>A unique VetFlow patient ID will be generated when you save.</span></div></div></div><div className="modal-footer"><span>All fields can be updated later.</span><div><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => onSave(form)} disabled={!form.name || !form.owner}><UserPlus size={15} /> Save patient</Button></div></div></div></div>; }

function AppointmentModal({ onClose, onSave }: { onClose: () => void; onSave: (appointment: Appointment) => void }) { const [pet, setPet] = useState("Bruno"); const [time, setTime] = useState("12:30 PM"); return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card appointment-modal"><div className="modal-header"><div><div className="eyebrow">Clinic schedule</div><h2>Schedule appointment</h2><p>Add a visit or a follow-up directly to today’s flow.</p></div><IconButton label="Close" onClick={onClose}><X size={18} /></IconButton></div><div className="modal-form"><div className="form-grid"><label className="field"><span>Pet</span><select value={pet} onChange={(event) => setPet(event.target.value)}><option>Bruno</option><option>Bella</option><option>Max</option><option>Coco</option><option>Oreo</option></select></label><Field label="Date" value="31 Oct 2026" onChange={() => {}} /><Field label="Time" value={time} onChange={setTime} /><Field label="Reason" value="Follow-up consultation" onChange={() => {}} /><Field label="Assigned doctor" value="Dr. Sharma" onChange={() => {}} /><Field label="Owner contact" value="Auto-filled from patient" onChange={() => {}} /></div><div className="appointment-note"><CalendarDays size={16} /><div><strong>Follow-up context</strong><span>This visit will be linked to {pet}’s medical timeline after it is saved.</span></div></div></div><div className="modal-footer"><span>Demo appointment · local only</span><div><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => onSave({ id: `APT-${Date.now()}`, time, pet, owner: "Auto-filled owner", reason: "Follow-up consultation", doctor: "Dr. Sharma", status: "Upcoming" })}><CalendarDays size={15} /> Add appointment</Button></div></div></div></div>; }

function ConsultationDetailModal({ consultation, patient, onClose, onPrint }: { consultation: Consultation; patient: Patient; onClose: () => void; onPrint: () => void }) { return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card detail-modal"><div className="modal-header"><div className="detail-title"><Avatar patient={patient} size="sm" /><div><div className="eyebrow">{consultation.id}</div><h2>{patient.name} · {consultation.reason}</h2><p>{consultation.date} · {consultation.doctor} · {consultation.complaint}</p></div></div><div className="detail-header-actions"><StatusBadge status={consultation.approved ? "Approved" : consultation.status} /><IconButton label="Close" onClick={onClose}><X size={18} /></IconButton></div></div><div className="detail-body"><div className="detail-section"><div className="detail-section-heading"><h3>Original transcription</h3><Badge tone="info">Source</Badge></div><p className="quote-block">“{consultation.transcription || demoTranscription}”</p></div><div className="detail-section"><div className="detail-section-heading"><h3>Structured clinical notes</h3><Badge tone="mint"><Sparkles size={13} /> AI-assisted</Badge></div><div className="detail-notes-grid"><div><span>Chief complaint</span><strong>{consultation.notes.complaint}</strong></div><div><span>Duration</span><strong>{consultation.notes.duration}</strong></div><div><span>Clinical examination</span><strong>{consultation.notes.examination}</strong></div><div><span>Diagnosis</span><strong>{consultation.notes.diagnosis}</strong></div><div><span>Treatment plan</span><strong>{consultation.notes.treatment}</strong></div><div><span>Follow-up</span><strong>{consultation.notes.followUp}</strong></div></div></div>{consultation.medicines.length > 0 && <div className="detail-section"><div className="detail-section-heading"><h3>Extracted prescription</h3><Badge tone={consultation.approved ? "success" : "warning"}>{consultation.approved ? "Approved" : "Draft"}</Badge></div><div className="detail-medicines">{consultation.medicines.map((medicine) => <div key={medicine.id}><strong>{medicine.name}</strong><span>{medicine.dosage} · {medicine.frequency} · {medicine.duration}</span></div>)}</div></div>}<div className="audit-line"><ShieldCheck size={15} /><span>Audit trail: transcription generated · notes reviewed · {consultation.approved ? "prescription approved by Dr. Sharma" : "awaiting doctor approval"}</span><small>31 Oct 2026</small></div></div><div className="modal-footer"><span><FileText size={14} /> Attached to {patient.name}’s chart</span><div><Button variant="secondary" onClick={onPrint}><Printer size={14} /> Print record</Button><Button onClick={onClose}>Done</Button></div></div></div></div>; }
