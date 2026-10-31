import { useState } from "react";
import { ChevronRight, FileText, Mic, Search, Stethoscope, UserPlus } from "lucide-react";
import type { Consultation, Patient } from "../data";
import { hasAllergy, SpeciesIcon } from "../kit";
import type { ConsultDraft } from "../store";
import { todayLabel } from "../store";

const icon = { size: 20, strokeWidth: 1.75 } as const;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const parseDate = (value: string) => { const time = Date.parse(value); return Number.isNaN(time) ? 0 : time; };
/** The greeting animates in once per session; after that Today appears instantly. */
function useIntroOnce() {
  const [intro] = useState(() => {
    try {
      if (sessionStorage.getItem("vf-intro")) return false;
      sessionStorage.setItem("vf-intro", "1");
    } catch { /* storage blocked: just animate */ }
    return true;
  });
  return intro;
}

function Words({ text, start = 0 }: { text: string; start?: number }) {
  return <>{text.split(" ").map((word, index) => <span key={index} className="word" style={{ animationDelay: `${start + index * 55}ms` }}>{word}{" "}</span>)}</>;
}

const stage: Record<string, string> = { ready: "Not recorded yet", recording: "Recording", paused: "Paused", processing: "Transcribing", transcribed: "Drafting notes", notes: "Notes in review", prescription: "Prescription in review" };

export function Dashboard({ patients, consultations, drafts, onStartConsult, onRegister, onOpenPatient, onOpenConsultation, onResume, onSearch, onMenu }: { patients: Patient[]; consultations: Consultation[]; drafts: Record<string, ConsultDraft>; onStartConsult: () => void; onRegister: () => void; onOpenPatient: (id: string) => void; onOpenConsultation: (consultation: Consultation) => void; onResume: (consultId: string) => void; onSearch: () => void; onMenu: () => void }) {
  const today = todayLabel();
  const patientOf = (id: string) => patients.find((patient) => patient.id === id);
  const openDrafts = Object.values(drafts).filter((draft) => !draft.consultation.approved && draft.phase !== "done").sort((a, b) => b.consultation.id.localeCompare(a.consultation.id));
  const awaiting = consultations.filter((consultation) => !consultation.approved && consultation.status === "Draft" && !drafts[consultation.id]);
  const seenToday = consultations.filter((consultation) => consultation.date === today && consultation.approved);
  const recent = [...patients].sort((a, b) => parseDate(b.lastVisit) - parseDate(a.lastVisit)).slice(0, 8);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const waiting = awaiting.length + openDrafts.length;
  const intro = useIntroOnce();

  return <div className="v2">
    <header className="page-title"><span style={{ flex: 1 }} /><button className="ibtn" aria-label="Search patients" onClick={onSearch}><Search size={24} strokeWidth={1.75} /></button><button className="ibtn" aria-label="Account, Dr. Sharma" onClick={onMenu}><span className="me">DS</span></button></header>

    <section className={`greet ${intro ? "intro" : ""}`}>
      <h1><Words text={`${greeting},`} /><br /><Words text="Dr. Sharma" start={110} /></h1>
      <p className="num">{new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date())} · {plural(seenToday.length, "consultation")} so far</p>
      <span className={`greet-chip ${waiting ? "warn" : ""}`}><i />{waiting ? `${waiting} waiting on you` : "You’re all caught up"}</span>
      <div className="greet-actions">
        <button className="btn lg primary" onClick={onStartConsult}><Mic {...icon} />Start consultation</button>
        <button className="btn lg secondary" onClick={onRegister}><UserPlus {...icon} />Register patient</button>
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
