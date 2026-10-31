import { ChevronRight, FileText, Mic, Phone, Plus, Search, Stethoscope } from "lucide-react";
import type { Appointment, Consultation, Patient } from "../data";
import { patientMeta, SpeciesIcon, statusTone } from "../kit";
import type { ConsultDraft } from "../store";

const icon = { size: 20, strokeWidth: 1.75 } as const;

/** Minutes until a "10:30 AM" style time today; negative once it has passed. */
function minutesUntil(time: string, now = new Date()) {
  const match = time.match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!match) return null;
  let hours = Number(match[1]) % 12;
  if (match[3]?.toUpperCase() === "PM") hours += 12;
  return hours * 60 + Number(match[2]) - (now.getHours() * 60 + now.getMinutes());
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function shortTime(time: string) {
  return time.replace(/\s*(AM|PM)$/i, "");
}

export function Dashboard({ patients, consultations, appointments, drafts, onStartConsult, onOpenPatient, onOpenConsultation, onResume, onSchedule, onSearch }: { patients: Patient[]; consultations: Consultation[]; appointments: Appointment[]; drafts: Record<string, ConsultDraft>; onStartConsult: (patientId?: string) => void; onOpenPatient: (id: string) => void; onOpenConsultation: (consultation: Consultation) => void; onResume: (consultId: string) => void; onSchedule: () => void; onSearch: () => void }) {
  const patientFor = (appointment: Appointment) => patients.find((patient) => patient.name === appointment.pet);
  const seen = appointments.filter((appointment) => appointment.status === "Completed").length;
  const next = appointments.find((appointment) => appointment.status === "In Progress") ?? appointments.find((appointment) => appointment.status === "Upcoming");
  const nextPatient = next ? patientFor(next) : undefined;
  const rest = appointments.filter((appointment) => appointment !== next);
  const draftRx = consultations.filter((consultation) => consultation.medicines.length > 0 && !consultation.approved);
  const openConsults = Object.values(drafts).filter((draft) => !draft.consultation.approved && !draftRx.some((item) => item.id === draft.consultation.id));
  const followUps = patients.filter((patient) => patient.followUp && patient.followUp !== "—").length;
  const attention = draftRx.length + openConsults.length;
  const minutes = next ? minutesUntil(next.time) : null;
  const when = next?.status === "In Progress" ? "In consult" : minutes !== null && minutes > 0 && minutes < 120 ? `Next up · in ${minutes} min` : "Next up";

  return <div className="v2">
    <header className="page-title"><h1>Today</h1><button className="ibtn" aria-label="Search patients" onClick={onSearch}><Search size={24} strokeWidth={1.75} /></button></header>
    <p className="summary num">{new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date())} · {seen} of {appointments.length} seen · {plural(draftRx.length, "draft")} · {plural(followUps, "follow-up")} due</p>

    {next && <section className="next" aria-label="Next up">
      <div className="next-top"><span className="next-time num">{shortTime(next.time)}</span><span className="next-when">{when}</span></div>
      <div className="next-pet">
        <span className="lead"><SpeciesIcon species={nextPatient?.species ?? "Dog"} /></span>
        <div className="rbody"><div className="next-name">{next.pet}</div><div className="t2">{nextPatient ? patientMeta(nextPatient) : next.owner}</div></div>
      </div>
      <p className="next-reason">{next.reason}</p>
      <div className="next-actions">
        <button className="btn lg primary" onClick={() => onStartConsult(nextPatient?.id)}><Mic {...icon} />Start consult</button>
        {nextPatient && nextPatient.phone !== "—" && <a className="ibtn outline" href={`tel:${nextPatient.phone}`} aria-label={`Call ${nextPatient.owner}`}><Phone {...icon} /></a>}
      </div>
    </section>}

    <div className="sec-h"><h2>Schedule</h2><button className="link" onClick={onSchedule}><Plus size={16} strokeWidth={2} />&nbsp;Add</button></div>
    {rest.length ? <ul className="list sched">{rest.map((appointment) => {
      const patient = patientFor(appointment);
      const done = appointment.status === "Completed";
      return <li key={appointment.id}><button className={`row s ${done ? "done" : ""}`} onClick={() => patient && onOpenPatient(patient.id)}>
        <span className="time num">{shortTime(appointment.time)}</span>
        <span className="lead"><SpeciesIcon species={patient?.species ?? "Dog"} /></span>
        <span className="rbody"><span className="t1">{appointment.pet}</span><span className="t2">{[patient?.breed, appointment.reason].filter(Boolean).join(" · ")}</span></span>
        {appointment.status !== "Upcoming" && <span className={`status ${statusTone(done ? "Seen" : appointment.status)}`}>{done ? "Seen" : appointment.status}</span>}
      </button></li>;
    })}</ul> : <p className="empty">Nothing else scheduled today.</p>}

    <div className="sec-h"><h2>Needs attention</h2>{attention > 0 && <span className="meta num">{attention}</span>}</div>
    {attention ? <ul className="list att">
      {openConsults.map((draft) => {
        const patient = patients.find((item) => item.id === draft.consultation.patientId);
        return <li key={draft.consultation.id}><button className="row" onClick={() => onResume(draft.consultation.id)}>
          <span className="lead"><Stethoscope {...icon} /></span>
          <span className="rbody"><span className="t1">Continue consultation · {patient?.name}</span><span className="t2 num">{draft.consultation.id} · {draft.phase === "ready" ? "not recorded yet" : draft.phase === "prescription" ? "prescription pending" : "notes in review"}</span></span>
          <ChevronRight size={16} className="chev" />
        </button></li>;
      })}
      {draftRx.map((consultation) => {
        const patient = patients.find((item) => item.id === consultation.patientId);
        return <li key={consultation.id}><button className="row" onClick={() => drafts[consultation.id] ? onResume(consultation.id) : onOpenConsultation(consultation)}>
          <span className="lead"><FileText {...icon} /></span>
          <span className="rbody"><span className="t1">Approve prescription · {patient?.name}</span><span className="t2 num">RX-{consultation.id.split("-").pop()} · {consultation.medicines.length} medicines · draft</span></span>
          <ChevronRight size={16} className="chev" />
        </button></li>;
      })}
    </ul> : <p className="empty">No drafts waiting.</p>}
  </div>;
}
