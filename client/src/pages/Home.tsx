import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Activity, ArrowLeft, Bell, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Clock3, FileText, FolderOpen, Home as HomeIcon, LayoutDashboard, Leaf, Menu, Mic, MoreHorizontal, PawPrint, Search, Settings, Stethoscope, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Redirect, Route, Switch, useLocation, useParams, useSearch } from "wouter";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { extractConsultationDetails } from "@/lib/extraction";
import { VoiceError, transcribeAudioBlob, validateAudio } from "@/lib/voice";
import type { Consultation, Medicine, ViewKey } from "@/vetflow/data";
import { patientMeta, Sheet, SpeciesIcon } from "@/vetflow/kit";
import { ConsultationDetailModal, RegisterModal } from "@/vetflow/modals";
import type { ConsultDraft, Phase } from "@/vetflow/store";
import { StoreProvider, todayLabel, useStore } from "@/vetflow/store";
import { Avatar, Badge, Button, EmptyState, IconButton } from "@/vetflow/ui";
import type { ExtractStatus } from "@/vetflow/views/Consultation";
import { ConsultationView } from "@/vetflow/views/Consultation";
import { Dashboard } from "@/vetflow/views/Dashboard";
import { matchesSpecies, PatientsView, profileTabs } from "@/vetflow/views/Patients";

// Secondary modules are rarely opened on a phone; keep them out of the first load.
const PrescriptionsView = lazy(() => import("@/vetflow/views/Prescriptions").then((m) => ({ default: m.PrescriptionsView })));
const InventoryView = lazy(() => import("@/vetflow/views/Inventory").then((m) => ({ default: m.InventoryView })));
const ReportsView = lazy(() => import("@/vetflow/views/Reports").then((m) => ({ default: m.ReportsView })));
const SettingsView = lazy(() => import("@/vetflow/views/Settings").then((m) => ({ default: m.SettingsView })));

const navItems: Array<{ key: ViewKey; label: string; icon: LucideIcon; badge?: string }> = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "patients", label: "Patients", icon: PawPrint },
  { key: "consultations", label: "Consultations", icon: Stethoscope },
  { key: "prescriptions", label: "Prescriptions", icon: ClipboardList },
  { key: "inventory", label: "Inventory", icon: FolderOpen, badge: "Soon" },
  { key: "reports", label: "Reports", icon: Activity },
  { key: "settings", label: "Settings", icon: Settings },
];

const tabSlug = (tab: string) => tab.toLowerCase().replace(/ /g, "-");

function viewFromPath(path: string): ViewKey {
  const segment = path.split("/")[1];
  if (segment === "consult") return "consultations";
  return navItems.find((item) => item.key === segment)?.key ?? "dashboard";
}

/** Shell-level navigation and overlays any screen can open. */
type ShellActions = {
  openPatient: (id: string, tab?: string) => void;
  /** With a patient, starts at once; without one, asks which patient first. */
  startConsultation: (patientId?: string) => void;
  openRegister: () => void;
  openConsultation: (consultation: Consultation) => void;
  openSearch: () => void;
  resume: (consultId: string) => void;
  openMenu: () => void;
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
  const [sheet, setSheet] = useState<null | "search" | "pick" | "more">(null);
  const [globalSearch, setGlobalSearch] = useState("");
  const [detailConsultation, setDetailConsultation] = useState<Consultation | null>(null);

  useEffect(() => {
    setSidebarOpen(false);
    setShowNotifications(false);
    setSheet(null);
  }, [location]);

  const actions: ShellActions = {
    openPatient: (id, tab) => setLocation(`/patients/${id}${tab && tab !== "Overview" ? `?tab=${tabSlug(tab)}` : ""}`),
    startConsultation: (patientId) => patientId ? setLocation(`/consult/new?patient=${patientId}`) : setSheet("pick"),
    openRegister: () => { setSheet(null); setShowRegister(true); },
    openConsultation: setDetailConsultation,
    openSearch: () => setSheet("search"),
    resume: (consultId) => setLocation(`/consult/${consultId}`),
    openMenu: () => setSheet("more"),
  };
  // Today, Patients and the consultation flow use the new visual system; on
  // phones they draw their own headers, and the flow hides the tab bar so a
  // stray tap can't leave a recording.
  const v2Route = location === "/" || location.startsWith("/patients");
  const flowRoute = location.startsWith("/consult");

  const navigate = (next: ViewKey) => setLocation(next === "dashboard" ? "/" : `/${next}`);
  const query = globalSearch.trim().toLowerCase();
  const globalResults = query ? store.patients.filter((patient) => `${patient.name} ${patient.owner} ${patient.id} ${patient.phone}`.toLowerCase().includes(query)) : [];

  return <ShellContext.Provider value={actions}><div className={`app-shell ${v2Route ? "v2-route" : ""} ${flowRoute ? "flow-route" : "has-tabbar"}`}>
    <aside className={`sidebar ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${sidebarOpen ? "sidebar-mobile-open" : ""}`}>
      <div className="brand-row"><div className="brand-mark"><Leaf size={16} fill="currentColor" /><PawPrint size={15} /></div><div className="brand-copy"><strong>VetFlow<span> AI</span></strong><small>Veterinary care, in flow</small></div><IconButton label="Close navigation" className="mobile-close" onClick={() => setSidebarOpen(false)}><X size={18} /></IconButton></div>
      <div className="clinic-switcher"><div className="clinic-avatar">VS</div><div className="clinic-copy"><strong>Vetspring Animal Hospital</strong><span>Dr. Sharma’s clinic</span></div><ChevronDown size={15} /></div>
      <nav className="primary-nav"><div className="nav-label">Workspace</div>{navItems.slice(0, 5).map((item) => <NavItem key={item.key} item={item} active={view === item.key} collapsed={sidebarCollapsed} onClick={() => navigate(item.key)} />)}<div className="nav-label nav-label-lower">Manage</div>{navItems.slice(5).map((item) => <NavItem key={item.key} item={item} active={view === item.key} collapsed={sidebarCollapsed} onClick={() => navigate(item.key)} />)}</nav>
      <div className="sidebar-bottom"><div className="demo-card"><div className="demo-dot" /><div><strong>Demo workspace</strong><span>Sample data enabled</span></div></div><button className="collapse-button" onClick={() => setSidebarCollapsed((value) => !value)}><ArrowLeft size={15} /><span>{sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}</span></button></div>
    </aside>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}
    <main className={`main-area ${sidebarCollapsed ? "main-collapsed" : ""}`}>
      <header className="topbar"><div className="mobile-top-brand"><IconButton label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={21} /></IconButton><div className="brand-mark small"><Leaf size={14} fill="currentColor" /><PawPrint size={13} /></div><strong>VetFlow<span> AI</span></strong></div><div className="topbar-left"><div className="breadcrumb"><span>Vetspring Animal Hospital</span><ChevronRight size={14} /><strong>{navItems.find((item) => item.key === view)?.label}</strong></div></div><div className="topbar-right"><IconButton label="Search patients" className="mobile-search" onClick={actions.openSearch}><Search size={20} /></IconButton><div className="global-search"><Search size={16} /><input type="search" value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Search patients, owners..." />{globalResults.length > 0 && <div className="search-results">{globalResults.map((patient) => <button key={patient.id} onClick={() => { actions.openPatient(patient.id); setGlobalSearch(""); }}><Avatar patient={patient} size="sm" /><span><strong>{patient.name}</strong><small>{patient.owner} · {patient.id}</small></span></button>)}</div>}</div><div className="topbar-date"><span>Today</span><strong>{todayLabel()}</strong></div><div className="notification-wrap"><IconButton label="Notifications" onClick={() => setShowNotifications((value) => !value)}><Bell size={18} /><i /></IconButton>{showNotifications && <div className="notification-popover"><div className="popover-heading"><strong>Notifications</strong><Badge tone="mint">2 new</Badge></div><div className="notification-item"><div className="notification-icon mint"><CheckCircle2 size={16} /></div><div><strong>Prescription approved</strong><span>Max’s record is up to date.</span><small>8 min ago</small></div></div><div className="notification-item"><div className="notification-icon amber"><Clock3 size={16} /></div><div><strong>Draft waiting</strong><span>Bella’s prescription needs approval.</span><small>32 min ago</small></div></div></div>}</div><div className="doctor-menu"><div className="doctor-avatar">DS</div><div className="doctor-copy"><strong>Dr. Sharma</strong><span>Veterinarian</span></div><ChevronDown size={14} /></div></div></header>
      <div className="content-area"><Suspense fallback={null}><Switch>
        <Route path="/"><DashboardRoute /></Route>
        <Route path="/patients"><PatientsRoute /></Route>
        <Route path="/patients/:id"><PatientsRoute /></Route>
        <Route path="/consultations"><ResumeConsultationRoute /></Route>
        <Route path="/consult/new"><StartConsultationRoute /></Route>
        <Route path="/consult/:id"><ConsultationRoute /></Route>
        <Route path="/prescriptions"><PrescriptionsRoute /></Route>
        <Route path="/inventory"><InventoryView /></Route>
        <Route path="/reports"><ReportsView consultations={store.consultations} patients={store.patients} /></Route>
        <Route path="/settings"><SettingsView /></Route>
        <Route><Redirect to="/" /></Route>
      </Switch></Suspense></div>
    </main>
    {showRegister && <RegisterModal onClose={() => setShowRegister(false)} onSave={(form) => { const patient = store.addPatient(form); setShowRegister(false); actions.openPatient(patient.id); toast.success(`${patient.name} registered as ${patient.id}`); }} />}
    {!flowRoute && <nav className="tabbar" aria-label="Primary">
      <TabLink label="Today" icon={HomeIcon} active={view === "dashboard"} onClick={() => navigate("dashboard")} />
      <TabLink label="Patients" icon={PawPrint} active={view === "patients"} onClick={() => navigate("patients")} />
      <button className="tab rec" aria-label="Start a consultation" onClick={() => actions.startConsultation()}><span className="disc"><Mic size={24} strokeWidth={1.75} /></span></button>
      <TabLink label="Prescriptions" icon={FileText} active={view === "prescriptions"} onClick={() => navigate("prescriptions")} />
      <TabLink label="More" icon={MoreHorizontal} active={["inventory", "reports", "settings"].includes(view)} onClick={actions.openMenu} />
    </nav>}
    {sheet === "search" && <PatientSheet title="Find a patient" onClose={() => setSheet(null)} onPick={(id) => actions.openPatient(id)} onRegister={actions.openRegister} />}
    {sheet === "pick" && <PatientSheet title="Who are you seeing?" onClose={() => setSheet(null)} onPick={(id) => setLocation(`/consult/new?patient=${id}`)} onRegister={actions.openRegister} />}
    {sheet === "more" && <Sheet title="More" onClose={() => setSheet(null)}>
      <ul className="list tint">
        <MoreRow icon={UserPlus} label="Register patient" onClick={actions.openRegister} />
        <MoreRow icon={Stethoscope} label="Continue last consultation" onClick={() => navigate("consultations")} />
        <MoreRow icon={Activity} label="Reports" onClick={() => navigate("reports")} />
        <MoreRow icon={FolderOpen} label="Inventory" meta="Soon" onClick={() => navigate("inventory")} />
        <MoreRow icon={Settings} label="Settings" onClick={() => navigate("settings")} />
      </ul>
    </Sheet>}
    {detailConsultation && <ConsultationDetailModal consultation={detailConsultation} patient={store.patients.find((patient) => patient.id === detailConsultation.patientId) ?? store.patients[0]} onClose={() => setDetailConsultation(null)} onPrint={() => window.print()} />}
  </div></ShellContext.Provider>;
}

function NavItem({ item, active, collapsed, onClick }: { item: { key: ViewKey; label: string; icon: LucideIcon; badge?: string }; active: boolean; collapsed: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return <button className={`nav-item ${active ? "nav-item-active" : ""}`} onClick={onClick} title={collapsed ? item.label : undefined} aria-current={active ? "page" : undefined}><Icon size={17} /><span>{item.label}</span>{item.badge && <em>{item.badge}</em>}</button>;
}

function TabLink({ label, icon: Icon, active, onClick }: { label: string; icon: LucideIcon; active: boolean; onClick: () => void }) {
  return <button className="tab" aria-current={active ? "page" : undefined} onClick={onClick}><span className="pill"><Icon size={24} strokeWidth={1.75} /></span>{label}</button>;
}

function MoreRow({ icon: Icon, label, meta, onClick }: { icon: LucideIcon; label: string; meta?: string; onClick: () => void }) {
  return <li><button className="row s" onClick={onClick}><span className="lead"><Icon size={20} strokeWidth={1.75} /></span><span className="rbody"><span className="t1">{label}</span></span>{meta && <span className="trail">{meta}</span>}<ChevronRight size={16} className="chev" /></button></li>;
}

/** Search-and-pick sheet, used both for finding a record and for choosing who a consultation is for. */
function PatientSheet({ title, onClose, onPick, onRegister }: { title: string; onClose: () => void; onPick: (id: string) => void; onRegister: () => void }) {
  const { patients } = useStore();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const results = q ? patients.filter((patient) => `${patient.name} ${patient.owner} ${patient.id} ${patient.phone}`.toLowerCase().includes(q)) : patients.slice(0, 6);
  return <Sheet title={title} onClose={onClose}>
    <label className="search" style={{ margin: "8px 16px 12px" }}><Search size={20} strokeWidth={1.75} /><input type="search" inputMode="search" autoFocus autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, owner, phone or ID" aria-label="Search patients" /></label>
    <ul className="list">
      {results.map((patient) => <li key={patient.id}><button className="row" onClick={() => onPick(patient.id)}>
        <span className="lead"><SpeciesIcon species={patient.species} /></span>
        <span className="rbody"><span className="t1">{patient.name}</span><span className="t2">{patientMeta(patient)}</span></span>
        <ChevronRight size={16} className="chev" />
      </button></li>)}
      <li><button className="row add-row" onClick={onRegister}><span className="lead"><UserPlus size={20} strokeWidth={1.75} /></span>{q && !results.length ? `Register “${query.trim()}”` : "Register new patient"}</button></li>
    </ul>
  </Sheet>;
}

function DashboardRoute() {
  const store = useStore();
  const shell = useShell();
  return <Dashboard patients={store.patients} consultations={store.consultations} drafts={store.drafts} onStartConsult={() => shell.startConsultation()} onRegister={shell.openRegister} onOpenPatient={(id) => shell.openPatient(id)} onOpenConsultation={shell.openConsultation} onResume={shell.resume} onSearch={shell.openSearch} onMenu={shell.openMenu} />;
}

function PatientsRoute() {
  const store = useStore();
  const shell = useShell();
  const params = useParams<{ id?: string }>();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const [patientSearch, setPatientSearch] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("All");
  const selectedPatient = params.id ? store.patients.find((patient) => patient.id === params.id) : undefined;
  const tabParam = new URLSearchParams(search).get("tab");
  const profileTab = profileTabs.find((tab) => tabSlug(tab) === tabParam) ?? "Overview";
  const { setLastPatient } = store;

  useEffect(() => {
    if (selectedPatient) setLastPatient(selectedPatient.id);
  }, [selectedPatient, setLastPatient]);

  if (params.id && !selectedPatient) return <Redirect to="/patients" replace />;

  const filtered = store.patients.filter((patient) => `${patient.name} ${patient.owner} ${patient.id} ${patient.breed} ${patient.phone}`.toLowerCase().includes(patientSearch.toLowerCase()) && matchesSpecies(patient, speciesFilter));
  const consultations = selectedPatient ? store.consultations.filter((consultation) => consultation.patientId === selectedPatient.id) : [];
  return <PatientsView patients={filtered} allPatients={store.patients} selectedPatient={selectedPatient} patientSearch={patientSearch} setPatientSearch={setPatientSearch} speciesFilter={speciesFilter} setSpeciesFilter={setSpeciesFilter} onRegister={shell.openRegister} onOpenPatient={(id) => shell.openPatient(id)} onBack={() => setLocation("/patients")} onNewConsultation={(patient) => shell.startConsultation(patient.id)} profileTab={profileTab} setProfileTab={(tab) => selectedPatient && setLocation(`/patients/${selectedPatient.id}${tab === "Overview" ? "" : `?tab=${tabSlug(tab)}`}`, { replace: true })} consultations={consultations} onOpenConsultation={shell.openConsultation} />;
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
    setLocation(`/consult/${id}`, { replace: true });
  }, [store, patientId, setLocation]);

  return null;
}

/** The Consultations nav item resumes the latest unapproved draft, or asks who to see. */
function ResumeConsultationRoute() {
  const { drafts } = useStore();
  const shell = useShell();
  const open = Object.values(drafts).filter((draft) => !draft.consultation.approved).sort((a, b) => b.consultation.id.localeCompare(a.consultation.id))[0];
  useEffect(() => { if (!open) shell.startConsultation(); }, [open, shell]);
  return open ? <Redirect to={`/consult/${open.consultation.id}`} replace /> : <Redirect to="/" replace />;
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

/**
 * The live consultation: record (or upload) → Groq Whisper transcript → AI
 * extraction of notes and medicines → the vet reviews, edits and approves.
 * The vet never writes the prescription from scratch; they correct the draft.
 */
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

  const recorder = useAudioRecorder();
  const runRef = useRef(0);
  const [voiceError, setVoiceError] = useState("");
  const [extractStatus, setExtractStatus] = useState<ExtractStatus>("idle");
  const [extractError, setExtractError] = useState("");
  const [pendingAudio, setPendingAudio] = useState<{ blob: Blob; name?: string } | null>(null);
  const [audioUrl, setAudioUrl] = useState("");

  const setPhase = (next: Phase, patch: Partial<ConsultDraft> = {}) => updateDraft(id, { phase: next, elapsed: elapsedRef.current, ...patch });

  const patient = store.patients.find((item) => item.id === consultation.patientId) ?? store.patients[0];
  const withEdits = (patch: Partial<Consultation>): Consultation => ({ ...consultation, notes: draft.notes, ...patch });

  const reportVoiceError = (error: unknown) => {
    const message = error instanceof VoiceError ? error.message : "Something went wrong with the recording. Please try again.";
    setVoiceError(message);
  };

  const extractDetails = async (base: Consultation, run: number) => {
    setExtractStatus("running");
    setExtractError("");
    try {
      const result = await extractConsultationDetails(base.transcription);
      if (run !== runRef.current) return;
      updateDraft(id, {
        consultation: { ...base, complaint: result.notes.complaint || base.complaint },
        notes: { ...result.notes, diagnosis: result.notes.diagnosis || "Pending doctor’s confirmation" },
        medicines: result.medicines.map((medicine, index) => ({ id: `med-${Date.now()}-${index}`, ...medicine })),
      });
      setExtractStatus("done");
    } catch (error) {
      if (run !== runRef.current) return;
      setExtractStatus("failed");
      setExtractError(error instanceof VoiceError ? error.message : "Could not extract details. Retry, or fill the notes in manually.");
    }
  };

  const transcribe = async (audio: { blob: Blob; name?: string }) => {
    const run = ++runRef.current;
    setPendingAudio(audio);
    setVoiceError("");
    setPhase("processing");
    try {
      const result = await transcribeAudioBlob(audio.blob, { name: audio.name });
      if (run !== runRef.current) return;
      const withTranscript = { ...consultation, transcription: result.transcript };
      setPhase("transcribed", { consultation: withTranscript });
      void extractDetails(withTranscript, run);
    } catch (error) {
      if (run !== runRef.current) return;
      setPhase("ready");
      reportVoiceError(error);
    }
  };

  useEffect(() => {
    // Audio lives in memory only: a reload mid-recording or mid-upload can't
    // continue, so return to Ready. A saved transcript re-runs extraction.
    if (draft.phase === "recording" || draft.phase === "paused" || draft.phase === "processing") {
      updateDraft(id, { phase: "ready", elapsed: 0 });
      setElapsed(0);
      setVoiceError("The page reloaded before the recording was sent. Please record or upload again.");
    } else if (draft.phase === "transcribed" && draft.consultation.transcription) {
      void extractDetails(draft.consultation, ++runRef.current);
    }
    const persist = () => store.updateDraftNow(id, { elapsed: elapsedRef.current });
    window.addEventListener("pagehide", persist);
    return () => { runRef.current += 1; window.removeEventListener("pagehide", persist); persist(); };
    // Mount/unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (!pendingAudio) { setAudioUrl(""); return; }
    const url = URL.createObjectURL(pendingAudio.blob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingAudio]);

  const start = async () => {
    setVoiceError("");
    setExtractStatus("idle");
    setPendingAudio(null);
    try {
      await recorder.start();
    } catch (error) {
      reportVoiceError(error);
      return;
    }
    elapsedRef.current = 0;
    setElapsed(0);
    setPhase("recording");
  };
  const stop = async () => {
    let blob: Blob;
    try {
      blob = await recorder.stop();
    } catch (error) {
      setPhase("ready");
      reportVoiceError(error);
      return;
    }
    await transcribe({ blob, name: "consultation-recording" });
  };
  const uploadAudio = async (file: File) => {
    try {
      validateAudio(file);
    } catch (error) {
      reportVoiceError(error);
      return;
    }
    await transcribe({ blob: file, name: file.name });
  };

  const saveNotes = (quiet = false) => {
    const updated = withEdits({ complaint: draft.notes.complaint || consultation.complaint });
    updateDraft(id, { consultation: updated });
    store.saveConsultation(updated);
    if (!quiet) toast.success("Notes saved");
  };
  const saveDraft = () => {
    const updated = withEdits({ medicines: draft.medicines, status: "Draft", approved: false });
    updateDraft(id, { consultation: updated });
    store.saveConsultation(updated);
    toast.success("Draft saved");
  };
  const approve = () => {
    const updated = withEdits({ medicines: draft.medicines, status: "Completed", approved: true });
    setPhase("done", { consultation: updated });
    store.saveConsultation(updated);
  };
  const setMedicines = (medicines: Medicine[]) => updateDraft(id, { medicines });

  const screenKey = ["ready", "recording", "paused"].includes(phase) ? "record" : phase === "processing" ? "transcribed" : phase;
  return <div key={screenKey} className="v2-enter"><ConsultationView patients={store.patients} patient={patient} consultation={consultation} phase={phase} elapsed={elapsed} notes={draft.notes} medicines={draft.medicines}
    voiceError={voiceError} canRetry={Boolean(pendingAudio)} onRetry={() => { if (pendingAudio) void transcribe(pendingAudio); }} audioUrl={audioUrl}
    extractStatus={extractStatus} extractError={extractError} onRetryExtract={() => void extractDetails(consultation, ++runRef.current)}
    onClose={() => setLocation("/")}
    onSelectPatient={(patientId) => { updateDraft(id, { consultation: { ...consultation, patientId } }); store.setLastPatient(patientId); }}
    onStart={start} onPause={() => { recorder.pause(); setPhase("paused"); }} onResume={() => { recorder.resume(); setPhase("recording"); }}
    onStop={stop}
    onDiscard={() => { recorder.cancel(); setPendingAudio(null); setElapsed(0); elapsedRef.current = 0; setPhase("ready"); }}
    onUploadAudio={uploadAudio}
    onNotesChange={(notes) => updateDraft(id, { notes })} onSaveNotes={saveNotes} onGoNotes={() => setPhase("notes")} onGoPrescription={() => setPhase("prescription")}
    onMedicinesChange={setMedicines} onSaveDraft={saveDraft} onApprove={approve}
    onPrint={() => window.print()}
    onNext={() => shell.startConsultation()} onOpenRecord={() => shell.openPatient(patient.id)} /></div>;
}

function PrescriptionsRoute() {
  const store = useStore();
  const shell = useShell();
  const [filter, setFilter] = useState("All");
  const prescriptions = store.consultations.filter((consultation) => consultation.medicines.length > 0);
  return <PrescriptionsView prescriptions={prescriptions} patients={store.patients} filter={filter} setFilter={setFilter} onOpen={shell.openConsultation} onPrint={() => window.print()} />;
}
