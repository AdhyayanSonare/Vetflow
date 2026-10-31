import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Activity, ArrowLeft, Bell, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Clock3, FolderOpen, LayoutDashboard, Leaf, Menu, PawPrint, Search, Settings, Stethoscope, X } from "lucide-react";
import { toast } from "sonner";
import { Redirect, Route, Switch, useLocation, useParams, useSearch } from "wouter";
import type { Consultation, Medicine, ViewKey } from "@/vetflow/data";
import { demoTranscription } from "@/vetflow/data";
import { AppointmentModal, ConsultationDetailModal, RegisterModal } from "@/vetflow/modals";
import type { ConsultDraft, Phase } from "@/vetflow/store";
import { StoreProvider, todayLabel, useStore } from "@/vetflow/store";
import { Avatar, Badge, Button, EmptyState, IconButton } from "@/vetflow/ui";
import { ConsultationView } from "@/vetflow/views/Consultation";
import { Dashboard } from "@/vetflow/views/Dashboard";
import { PatientsView } from "@/vetflow/views/Patients";

// Secondary modules are rarely opened on a phone; keep them out of the first load.
const PrescriptionsView = lazy(() => import("@/vetflow/views/Prescriptions").then((m) => ({ default: m.PrescriptionsView })));
const AppointmentsView = lazy(() => import("@/vetflow/views/Appointments").then((m) => ({ default: m.AppointmentsView })));
const InventoryView = lazy(() => import("@/vetflow/views/Inventory").then((m) => ({ default: m.InventoryView })));
const ReportsView = lazy(() => import("@/vetflow/views/Reports").then((m) => ({ default: m.ReportsView })));
const SettingsView = lazy(() => import("@/vetflow/views/Settings").then((m) => ({ default: m.SettingsView })));

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

const profileTabs = ["Overview", "Medical History", "Consultations", "Prescriptions", "Vaccinations", "Documents"];
const tabSlug = (tab: string) => tab.toLowerCase().replace(/ /g, "-");

function viewFromPath(path: string): ViewKey {
  const segment = path.split("/")[1];
  if (segment === "consult") return "consultations";
  return navItems.find((item) => item.key === segment)?.key ?? "dashboard";
}

/** Shell-level navigation and overlays any screen can open. */
type ShellActions = {
  openPatient: (id: string, tab?: string) => void;
  startConsultation: (patientId?: string) => void;
  openRegister: () => void;
  openAppointmentForm: () => void;
  openConsultation: (consultation: Consultation) => void;
};
const ShellContext = createContext<ShellActions | null>(null);
const useShell = () => useContext(ShellContext)!;

export default function Home() {
  return <StoreProvider><Shell /></StoreProvider>;
}

function Shell() {
  const store = useStore();
  const [location, setLocation] = useLocation();
  const view = viewFromPath(location);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAppointmentForm, setShowAppointmentForm] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [detailConsultation, setDetailConsultation] = useState<Consultation | null>(null);

  useEffect(() => {
    setSidebarOpen(false);
    setShowNotifications(false);
  }, [location]);

  const actions: ShellActions = {
    openPatient: (id, tab) => setLocation(`/patients/${id}${tab && tab !== "Overview" ? `?tab=${tabSlug(tab)}` : ""}`),
    startConsultation: (patientId) => setLocation(`/consult/new${patientId ? `?patient=${patientId}` : ""}`),
    openRegister: () => setShowRegister(true),
    openAppointmentForm: () => setShowAppointmentForm(true),
    openConsultation: setDetailConsultation,
  };

  const navigate = (next: ViewKey) => setLocation(next === "dashboard" ? "/" : `/${next}`);
  const query = globalSearch.trim().toLowerCase();
  const globalResults = query ? store.patients.filter((patient) => `${patient.name} ${patient.owner} ${patient.id} ${patient.phone}`.toLowerCase().includes(query)) : [];

  return <ShellContext.Provider value={actions}><div className="app-shell">
    <aside className={`sidebar ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${sidebarOpen ? "sidebar-mobile-open" : ""}`}>
      <div className="brand-row"><div className="brand-mark"><Leaf size={16} fill="currentColor" /><PawPrint size={15} /></div><div className="brand-copy"><strong>VetFlow<span> AI</span></strong><small>Veterinary care, in flow</small></div><IconButton label="Close navigation" className="mobile-close" onClick={() => setSidebarOpen(false)}><X size={18} /></IconButton></div>
      <div className="clinic-switcher"><div className="clinic-avatar">VS</div><div className="clinic-copy"><strong>Vetspring Animal Hospital</strong><span>Dr. Sharma’s clinic</span></div><ChevronDown size={15} /></div>
      <nav className="primary-nav"><div className="nav-label">Workspace</div>{navItems.slice(0, 6).map((item) => <NavItem key={item.key} item={item} active={view === item.key} collapsed={sidebarCollapsed} onClick={() => navigate(item.key)} />)}<div className="nav-label nav-label-lower">Manage</div>{navItems.slice(6).map((item) => <NavItem key={item.key} item={item} active={view === item.key} collapsed={sidebarCollapsed} onClick={() => navigate(item.key)} />)}</nav>
      <div className="sidebar-bottom"><div className="demo-card"><div className="demo-dot" /><div><strong>Demo workspace</strong><span>Sample data enabled</span></div></div><button className="collapse-button" onClick={() => setSidebarCollapsed((value) => !value)}><ArrowLeft size={15} /><span>{sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}</span></button></div>
    </aside>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}
    <main className={`main-area ${sidebarCollapsed ? "main-collapsed" : ""}`}>
      <header className="topbar"><div className="mobile-top-brand"><IconButton label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={21} /></IconButton><div className="brand-mark small"><Leaf size={14} fill="currentColor" /><PawPrint size={13} /></div><strong>VetFlow<span> AI</span></strong></div><div className="topbar-left"><div className="breadcrumb"><span>Vetspring Animal Hospital</span><ChevronRight size={14} /><strong>{navItems.find((item) => item.key === view)?.label}</strong></div></div><div className="topbar-right"><div className="global-search"><Search size={16} /><input type="search" value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Search patients, owners..." /><kbd>⌘ K</kbd>{globalResults.length > 0 && <div className="search-results">{globalResults.map((patient) => <button key={patient.id} onClick={() => { actions.openPatient(patient.id); setGlobalSearch(""); }}><Avatar patient={patient} size="sm" /><span><strong>{patient.name}</strong><small>{patient.owner} · {patient.id}</small></span></button>)}</div>}</div><div className="topbar-date"><span>Today</span><strong>{todayLabel()}</strong></div><div className="notification-wrap"><IconButton label="Notifications" onClick={() => setShowNotifications((value) => !value)}><Bell size={18} /><i /></IconButton>{showNotifications && <div className="notification-popover"><div className="popover-heading"><strong>Notifications</strong><Badge tone="mint">3 new</Badge></div><div className="notification-item"><div className="notification-icon mint"><CheckCircle2 size={16} /></div><div><strong>Prescription approved</strong><span>Bruno’s record is up to date.</span><small>8 min ago</small></div></div><div className="notification-item"><div className="notification-icon amber"><Clock3 size={16} /></div><div><strong>Follow-up due today</strong><span>7 patients are awaiting review.</span><small>32 min ago</small></div></div><div className="notification-item"><div className="notification-icon blue"><CalendarDays size={16} /></div><div><strong>Next appointment</strong><span>Max · General checkup · 10:00 AM</span><small>1 hr ago</small></div></div></div>}</div><div className="doctor-menu"><div className="doctor-avatar">DS</div><div className="doctor-copy"><strong>Dr. Sharma</strong><span>Veterinarian</span></div><ChevronDown size={14} /></div></div></header>
      <div className="content-area"><Suspense fallback={null}><Switch>
        <Route path="/"><DashboardRoute /></Route>
        <Route path="/patients"><PatientsRoute /></Route>
        <Route path="/patients/:id"><PatientsRoute /></Route>
        <Route path="/consultations"><ResumeConsultationRoute /></Route>
        <Route path="/consult/new"><StartConsultationRoute /></Route>
        <Route path="/consult/:id"><ConsultationRoute /></Route>
        <Route path="/prescriptions"><PrescriptionsRoute /></Route>
        <Route path="/appointments"><AppointmentsRoute /></Route>
        <Route path="/inventory"><InventoryView /></Route>
        <Route path="/reports"><ReportsView consultations={store.consultations} patients={store.patients} /></Route>
        <Route path="/settings"><SettingsView /></Route>
        <Route><Redirect to="/" /></Route>
      </Switch></Suspense></div>
    </main>
    {showRegister && <RegisterModal onClose={() => setShowRegister(false)} onSave={(form) => { const patient = store.addPatient(form); setShowRegister(false); actions.openPatient(patient.id); toast.success(`${patient.name} registered as ${patient.id}`); }} />}
    {showAppointmentForm && <AppointmentModal patients={store.patients} date={todayLabel()} onClose={() => setShowAppointmentForm(false)} onSave={(appointment) => { store.addAppointment(appointment); setShowAppointmentForm(false); toast.success("Appointment added to today’s schedule"); }} />}
    {detailConsultation && <ConsultationDetailModal consultation={detailConsultation} patient={store.patients.find((patient) => patient.id === detailConsultation.patientId) ?? store.patients[0]} onClose={() => setDetailConsultation(null)} onPrint={() => window.print()} />}
  </div></ShellContext.Provider>;
}

function NavItem({ item, active, collapsed, onClick }: { item: { key: ViewKey; label: string; icon: LucideIcon; badge?: string }; active: boolean; collapsed: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return <button className={`nav-item ${active ? "nav-item-active" : ""}`} onClick={onClick} title={collapsed ? item.label : undefined} aria-current={active ? "page" : undefined}><Icon size={17} /><span>{item.label}</span>{item.badge && <em>{item.badge}</em>}</button>;
}

function DashboardRoute() {
  const store = useStore();
  const shell = useShell();
  const [, setLocation] = useLocation();
  return <Dashboard patients={store.patients} consultations={store.consultations} appointments={store.appointments} onRegister={shell.openRegister} onNewConsultation={() => shell.startConsultation()} onPatients={() => setLocation("/patients")} onPrescriptions={() => setLocation("/prescriptions")} onSchedule={shell.openAppointmentForm} onOpenPatient={shell.openPatient} onOpenConsultation={shell.openConsultation} />;
}

function PatientsRoute() {
  const store = useStore();
  const shell = useShell();
  const params = useParams<{ id?: string }>();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const [patientSearch, setPatientSearch] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("All species");
  const selectedPatient = params.id ? store.patients.find((patient) => patient.id === params.id) : undefined;
  const tabParam = new URLSearchParams(search).get("tab");
  const profileTab = profileTabs.find((tab) => tabSlug(tab) === tabParam) ?? "Overview";
  const { setLastPatient } = store;

  useEffect(() => {
    if (selectedPatient) setLastPatient(selectedPatient.id);
  }, [selectedPatient, setLastPatient]);

  if (params.id && !selectedPatient) return <Redirect to="/patients" replace />;

  const filtered = store.patients.filter((patient) => `${patient.name} ${patient.owner} ${patient.id} ${patient.breed} ${patient.phone}`.toLowerCase().includes(patientSearch.toLowerCase()) && (speciesFilter === "All species" || patient.species === speciesFilter));
  const consultations = selectedPatient ? store.consultations.filter((consultation) => consultation.patientId === selectedPatient.id) : [];
  return <PatientsView patients={filtered} selectedPatient={selectedPatient} patientSearch={patientSearch} setPatientSearch={setPatientSearch} speciesFilter={speciesFilter} setSpeciesFilter={setSpeciesFilter} onRegister={shell.openRegister} onOpenPatient={shell.openPatient} onNewConsultation={(patient) => shell.startConsultation(patient?.id)} profileTab={profileTab} setProfileTab={(tab) => selectedPatient && setLocation(`/patients/${selectedPatient.id}${tab === "Overview" ? "" : `?tab=${tabSlug(tab)}`}`, { replace: true })} consultations={consultations} onOpenConsultation={shell.openConsultation} />;
}

/** `/consult/new?patient=ID` creates a draft and replaces itself with the draft's permanent URL. */
function StartConsultationRoute() {
  const store = useStore();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const started = useRef(false);
  const requested = new URLSearchParams(search).get("patient");
  const patientId = store.patients.some((patient) => patient.id === requested) ? requested! : store.lastPatientId;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const id = store.startConsultation(patientId);
    const patient = store.patients.find((item) => item.id === patientId);
    toast.success(`New consultation started for ${patient?.name ?? "patient"}`);
    setLocation(`/consult/${id}`, { replace: true });
  }, [store, patientId, setLocation]);

  return null;
}

/** The Consultations nav item resumes the latest unapproved draft, or starts one. */
function ResumeConsultationRoute() {
  const { drafts } = useStore();
  const open = Object.values(drafts).filter((draft) => !draft.consultation.approved).sort((a, b) => b.consultation.id.localeCompare(a.consultation.id))[0];
  return <Redirect to={open ? `/consult/${open.consultation.id}` : "/consult/new"} replace />;
}

function ConsultationRoute() {
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const shell = useShell();
  const draft = store.drafts[id];
  if (draft) return <ActiveConsultation key={id} draft={draft} />;
  const saved = store.consultations.find((consultation) => consultation.id === id);
  return <div className="page-stack"><EmptyState title={saved ? "This consultation is in the record" : "Consultation not found"} description={saved ? "Open it to review the transcript, notes and prescription." : "It may have been started on another device."} />{saved && <Button onClick={() => shell.openConsultation(saved)}>Open consultation</Button>}</div>;
}

function ActiveConsultation({ draft }: { draft: ConsultDraft }) {
  const store = useStore();
  const shell = useShell();
  const [, setLocation] = useLocation();
  const { updateDraft } = store;
  const id = draft.consultation.id;
  const phase = draft.phase;
  const consultation = draft.consultation;
  // The timer ticks locally so only this screen re-renders each second; the
  // total is written to the draft whenever the phase changes or the page hides.
  const [elapsed, setElapsed] = useState(draft.elapsed);
  const elapsedRef = useRef(elapsed);
  elapsedRef.current = elapsed;

  const setPhase = (next: Phase, patch: Partial<ConsultDraft> = {}) => updateDraft(id, { phase: next, elapsed: elapsedRef.current, ...patch });

  useEffect(() => {
    // A reload can't continue a live recording; land on Paused with the time kept.
    if (draft.phase === "recording") updateDraft(id, { phase: "paused" });
    const persist = () => store.updateDraftNow(id, { elapsed: elapsedRef.current });
    window.addEventListener("pagehide", persist);
    return () => { window.removeEventListener("pagehide", persist); persist(); };
    // Mount/unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "processing") return;
    const timer = window.setTimeout(() => updateDraft(id, { phase: "notes" }), 1800);
    return () => window.clearTimeout(timer);
  }, [phase, id, updateDraft]);

  const patient = store.patients.find((item) => item.id === consultation.patientId) ?? store.patients[0];
  const patientConsultations = store.consultations.filter((item) => item.patientId === patient.id && item.id !== id);
  const hydrated = (): Consultation => ({ ...consultation, transcription: demoTranscription, complaint: "Vomiting and loss of appetite", notes: { complaint: "Vomiting; loss of appetite; reduced activity", duration: "Approximately one day", examination: "Temperature: 102°F. Mild dehydration observed.", diagnosis: "Pending doctor’s confirmation", treatment: "As specified by the veterinarian", followUp: "After five days" } });
  const withEdits = (patch: Partial<Consultation>): Consultation => ({ ...consultation, notes: draft.notes, transcription: consultation.transcription || demoTranscription, ...patch });

  const stop = (message: string) => {
    const next = hydrated();
    setPhase("processing", { consultation: next, notes: next.notes });
    toast.success(message);
  };
  const saveNotes = () => {
    const updated = withEdits({ complaint: draft.notes.complaint });
    updateDraft(id, { consultation: updated });
    store.saveConsultation(updated);
    toast.success("Clinical notes saved to the consultation draft");
  };
  const saveDraft = () => {
    const updated = withEdits({ medicines: draft.medicines, status: "Draft", approved: false });
    updateDraft(id, { consultation: updated });
    store.saveConsultation(updated);
    toast.success("Prescription saved as a draft");
  };
  const approve = () => {
    const updated = withEdits({ medicines: draft.medicines, status: "Completed", approved: true });
    setPhase("prescription", { consultation: updated });
    store.saveConsultation(updated);
    toast.success("Prescription approved and attached to the medical history");
  };
  const setMedicines = (medicines: Medicine[]) => updateDraft(id, { medicines });

  return <ConsultationView patients={store.patients} selectedPatient={patient} patientConsultations={patientConsultations} activeConsultation={consultation} phase={phase} elapsed={elapsed} notesDraft={draft.notes} medicinesDraft={draft.medicines}
    onSelectPatient={(patientId) => { updateDraft(id, { consultation: { ...consultation, patientId } }); store.setLastPatient(patientId); }}
    onStart={() => setPhase("recording")} onPause={() => setPhase("paused")} onResume={() => setPhase("recording")}
    onStop={() => stop("Audio captured — VetFlow AI is structuring the consultation")}
    onUploadAudio={(file) => stop(`${file.name} uploaded — VetFlow AI is structuring the consultation`)}
    onSaveNotes={saveNotes} onSaveDraft={saveDraft} onNotesChange={(notes) => notes && updateDraft(id, { notes })} onGoPrescription={() => setPhase("prescription")}
    onMedicineChange={(medicineId, field, value) => setMedicines(draft.medicines.map((medicine) => medicine.id === medicineId ? { ...medicine, [field]: value } : medicine))}
    onAddMedicine={() => setMedicines([...draft.medicines, { id: `med-${Date.now()}`, name: "", strength: "", dosage: "", route: "Oral", frequency: "", duration: "", instructions: "" }])}
    onRemoveMedicine={(medicineId) => setMedicines(draft.medicines.filter((medicine) => medicine.id !== medicineId))}
    onApprove={approve} onOpenConsultation={shell.openConsultation} onBack={() => setLocation("/")} />;
}

function PrescriptionsRoute() {
  const store = useStore();
  const shell = useShell();
  const [filter, setFilter] = useState("All");
  const prescriptions = store.consultations.filter((consultation) => consultation.medicines.length > 0);
  return <PrescriptionsView prescriptions={prescriptions} patients={store.patients} filter={filter} setFilter={setFilter} onOpen={shell.openConsultation} onPrint={() => window.print()} />;
}

function AppointmentsRoute() {
  const store = useStore();
  const shell = useShell();
  return <AppointmentsView appointments={store.appointments} onNew={shell.openAppointmentForm} onPet={(name) => { const patient = store.patients.find((item) => item.name === name); if (patient) shell.openPatient(patient.id); }} />;
}
