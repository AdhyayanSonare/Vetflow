import { ChevronRight, FileText, Mic, Search, Stethoscope, UserPlus } from "lucide-react";
import type { Consultation, Patient } from "../data";
import { hasAllergy, SpeciesIcon } from "../kit";
import type { ConsultDraft } from "../store";
import { todayLabel } from "../store";

const icon = { size: 20, strokeWidth: 1.75 } as const;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const parseDate = (value: string) => { const time = Date.parse(value); return Number.isNaN(time) ? 0 : time; };
const stage: Record<string, string> = { ready: "Not recorded yet", recording: "Recording", paused: "Paused", processing: "Transcribing", transcribed: "Drafting notes", notes: "Notes in review", prescription: "Prescription in review" };

/** Static wave lines behind the hero: the product's one motif, quiet at rest. */
function HeroWaves() {
  const line = (amp: number, period: number, y: number) => {
    const points: string[] = [];
    for (let x = 0; x <= 400; x += 4) points.push(`${x === 0 ? "M" : "L"}${x} ${(y - amp * Math.sin((2 * Math.PI * x) / period)).toFixed(1)}`);
    return points.join(" ");
  };
  return <svg className="hero-waves" viewBox="0 0 400 160" preserveAspectRatio="none" aria-hidden="true">
    <path d={line(14, 160, 112)} />
    <path d={line(9, 110, 132)} />
    <path d={line(5, 70, 148)} />
  </svg>;
}

export function Dashboard({ patients, consultations, drafts, onStartConsult, onRegister, onOpenPatient, onOpenConsultation, onResume, onSearch, onMenu }: { patients: Patient[]; consultations: Consultation[]; drafts: Record<string, ConsultDraft>; onStartConsult: () => void; onRegister: () => void; onOpenPatient: (id: string) => void; onOpenConsultation: (consultation: Consultation) => void; onResume: (consultId: string) => void; onSearch: () => void; onMenu: () => void }) {
  const today = todayLabel();
  const patientOf = (id: string) => patients.find((patient) => patient.id === id);
  const openDrafts = Object.values(drafts).filter((draft) => !draft.consultation.approved && draft.phase !== "done").sort((a, b) => b.consultation.id.localeCompare(a.consultation.id));
  const awaiting = consultations.filter((consultation) => !consultation.approved && consultation.status === "Draft" && !drafts[consultation.id]);
  const seenToday = consultations.filter((consultation) => consultation.date === today && consultation.approved);
  const recent = [...patients].sort((a, b) => parseDate(b.lastVisit) - parseDate(a.lastVisit)).slice(0, 8);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return <div className="v2">
    <header className="page-title"><h1>Today</h1><button className="ibtn" aria-label="Search patients" onClick={onSearch}><Search size={24} strokeWidth={1.75} /></button><button className="ibtn" aria-label="Account, Dr. Sharma" onClick={onMenu}><span className="me">DS</span></button></header>
    <p className="summary num">{new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date())} · {plural(seenToday.length, "consultation")} today · {awaiting.length + openDrafts.length} waiting on you</p>

    <section className="hero" aria-label="Start a consultation">
      <HeroWaves />
      <p className="hero-kicker">{greeting}, Dr. Sharma</p>
      <h2 className="hero-title">Speak the visit.<br />VetFlow writes it up.</h2>
      <p className="hero-sub">Record the consultation. Notes and the prescription are drafted from what was said, for you to check and approve.</p>
      <div className="hero-actions">
        <button className="btn lg hero-primary" onClick={onStartConsult}><Mic {...icon} />Start consultation</button>
        <button className="btn lg hero-secondary" onClick={onRegister}><UserPlus {...icon} />Register patient</button>
      </div>
    </section>

    {openDrafts.length > 0 && <>
      <div className="sec-h"><h2>Continue</h2><span className="meta num">{openDrafts.length}</span></div>
      <ul className="list att">{openDrafts.map((draft) => {
        const patient = patientOf(draft.consultation.patientId);
        return <li key={draft.consultation.id}><button className="row" onClick={() => onResume(draft.consultation.id)}>
          <span className="lead"><Stethoscope {...icon} /></span>
          <span className="rbody"><span className="t1">{patient?.name ?? "Patient"} · consultation</span><span className="t2 num">{stage[draft.phase] ?? "In progress"} · started {draft.consultation.time}</span></span>
          <ChevronRight size={16} className="chev" />
        </button></li>;
      })}</ul>
    </>}

    <div className="sec-h"><h2>Awaiting approval</h2>{awaiting.length > 0 && <span className="meta num">{awaiting.length}</span>}</div>
    {awaiting.length ? <ul className="list att">{awaiting.map((consultation) => {
      const patient = patientOf(consultation.patientId);
      return <li key={consultation.id}><button className="row" onClick={() => onOpenConsultation(consultation)}>
        <span className="lead"><FileText {...icon} /></span>
        <span className="rbody"><span className="t1">Prescription · {patient?.name}</span><span className="t2 num">RX-{consultation.id.split("-").pop()} · {plural(consultation.medicines.length, "medicine")} · drafted by AI</span></span>
        <ChevronRight size={16} className="chev" />
      </button></li>;
    })}</ul> : <p className="empty">Nothing waiting. Approved prescriptions go straight to the record.</p>}

    <div className="sec-h"><h2>Seen today</h2>{seenToday.length > 0 && <span className="meta num">{seenToday.length}</span>}</div>
    {seenToday.length ? <ul className="list">{seenToday.map((consultation) => {
      const patient = patientOf(consultation.patientId);
      return <li key={consultation.id}><button className="row" onClick={() => onOpenConsultation(consultation)}>
        <span className="lead"><SpeciesIcon species={patient?.species ?? "Dog"} /></span>
        <span className="rbody"><span className="t1">{patient?.name} · {consultation.reason}</span><span className="t2">{consultation.notes.diagnosis || consultation.complaint}</span></span>
        <span className="trail num">{consultation.time}</span>
      </button></li>;
    })}</ul> : <p className="empty">No consultations yet today.</p>}

    <div className="sec-h"><h2>Recent patients</h2></div>
    <div className="pet-rail" role="list">{recent.map((patient) => <button key={patient.id} role="listitem" className="pet-card" onClick={() => onOpenPatient(patient.id)}>
      <span className="pet-face"><SpeciesIcon species={patient.species} size={24} /></span>
      <span className="pet-name">{patient.name}</span>
      <span className="pet-meta">{patient.breed}</span>
      {hasAllergy(patient) && <span className="pet-flag">Allergy</span>}
    </button>)}</div>
  </div>;
}
