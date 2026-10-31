import { useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, FileText, MessageCircle, MoreVertical, Phone, Plus, Printer, Search, Stethoscope } from "lucide-react";
import type { Consultation, Patient } from "../data";
import { AllergyChip, hasAllergy, patientMeta, Sheet, SpeciesIcon, statusTone, whatsappLink } from "../kit";
import { todayLabel } from "../store";

const icon = { size: 20, strokeWidth: 1.75 } as const;
export const speciesChips = [{ key: "All", label: "All" }, { key: "Dog", label: "Dogs" }, { key: "Cat", label: "Cats" }, { key: "Other", label: "Other" }];
export const matchesSpecies = (patient: Patient, filter: string) => filter === "All" || (filter === "Other" ? patient.species !== "Dog" && patient.species !== "Cat" : patient.species === filter);
const parseDate = (value: string) => { const time = Date.parse(value); return Number.isNaN(time) ? 0 : time; };
const shortDate = (value: string) => value === todayLabel() ? "Today" : value.replace(/ \d{4}$/, "");

export function PatientsView({ patients, allPatients, selectedPatient, patientSearch, setPatientSearch, speciesFilter, setSpeciesFilter, onRegister, onOpenPatient, onBack, onNewConsultation, onBook, profileTab, setProfileTab, consultations, onOpenConsultation }: { patients: Patient[]; allPatients: Patient[]; selectedPatient?: Patient; patientSearch: string; setPatientSearch: (value: string) => void; speciesFilter: string; setSpeciesFilter: (value: string) => void; onRegister: () => void; onOpenPatient: (id: string) => void; onBack: () => void; onNewConsultation: (patient: Patient) => void; onBook: (patient: Patient) => void; profileTab: string; setProfileTab: (value: string) => void; consultations: Consultation[]; onOpenConsultation: (consultation: Consultation) => void }) {
  const sorted = [...patients].sort((a, b) => parseDate(b.lastVisit) - parseDate(a.lastVisit));
  return <div className={`v2 wide pt-split ${selectedPatient ? "has-record" : ""}`}>
    <section className="pt-list">
      <header className="page-title"><h1>Patients</h1><button className="ibtn" aria-label="Register patient" onClick={onRegister}><Plus size={24} strokeWidth={1.75} /></button></header>
      <label className="search"><Search {...icon} /><input type="search" inputMode="search" autoComplete="off" value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} placeholder="Name, owner, phone or ID" aria-label="Search patients" /></label>
      <div className="chips" role="group" aria-label="Species">{speciesChips.map((chip) => <button key={chip.key} className="fchip" aria-pressed={speciesFilter === chip.key} onClick={() => setSpeciesFilter(chip.key)}><span>{chip.label} <b className="num">{allPatients.filter((patient) => matchesSpecies(patient, chip.key)).length}</b></span></button>)}</div>
      <h2 className="grp">{patientSearch ? `${sorted.length} ${sorted.length === 1 ? "match" : "matches"}` : "Seen recently"}</h2>
      {sorted.length ? <ul className="list">{sorted.map((patient) => <li key={patient.id}><button className="row" aria-current={patient.id === selectedPatient?.id ? "true" : undefined} onClick={() => onOpenPatient(patient.id)} style={patient.id === selectedPatient?.id ? { background: "var(--brand-tint)" } : undefined}>
        <span className="lead"><SpeciesIcon species={patient.species} /></span>
        <span className="rbody"><span className="t1">{patient.name}</span><span className="t2">{hasAllergy(patient) && <span style={{ color: "var(--warn)", fontWeight: 600 }}>Allergy · </span>}{patientMeta(patient)}</span></span>
        <span className="trail num">{shortDate(patient.lastVisit)}</span>
      </button></li>)}</ul> : <p className="empty">No patients match “{patientSearch}”. <button className="link" onClick={onRegister}>Register a patient</button></p>}
    </section>
    <section className="pt-record">{selectedPatient && <PatientRecord key={selectedPatient.id} patient={selectedPatient} consultations={consultations} tab={profileTab} setTab={setProfileTab} onBack={onBack} onNewConsultation={() => onNewConsultation(selectedPatient)} onBook={() => onBook(selectedPatient)} onOpenConsultation={onOpenConsultation} />}</section>
  </div>;
}

function PatientRecord({ patient, consultations, tab, setTab, onBack, onNewConsultation, onBook, onOpenConsultation }: { patient: Patient; consultations: Consultation[]; tab: string; setTab: (tab: string) => void; onBack: () => void; onNewConsultation: () => void; onBook: () => void; onOpenConsultation: (consultation: Consultation) => void }) {
  const [menu, setMenu] = useState(false);
  const history = [...consultations].sort((a, b) => parseDate(b.date) - parseDate(a.date));
  const last = history[0];
  const prescriptions = history.filter((consultation) => consultation.medicines.length > 0);
  const details = [patient.colour, patient.microchip && `Chip ${patient.microchip}`].filter((value) => value && value !== "—").join(" · ");
  return <div className="v2 with-tabbar v2-enter" style={{ display: "flex", flexDirection: "column" }}>
    <header className="subbar"><button className="ibtn back-desktop-hide" aria-label="Back to Patients" onClick={onBack}><ChevronLeft size={24} strokeWidth={1.75} /></button><span className="ttl" /><button className="ibtn" aria-label={`More actions for ${patient.name}`} onClick={() => setMenu(true)}><MoreVertical size={24} strokeWidth={1.75} /></button></header>
    {menu && <Sheet title={patient.name} onClose={() => setMenu(false)}><ul className="list tint">
      <li><button className="row s" onClick={() => { setMenu(false); onBook(); }}><span className="lead"><CalendarPlus {...icon} /></span><span className="rbody"><span className="t1">Book appointment</span></span><ChevronRight size={16} className="chev" /></button></li>
      <li><button className="row s" onClick={() => { setMenu(false); setTimeout(() => window.print(), 50); }}><span className="lead"><Printer {...icon} /></span><span className="rbody"><span className="t1">Print record</span></span><ChevronRight size={16} className="chev" /></button></li>
    </ul></Sheet>}
    <section className="hdr">
      <span className="lead"><SpeciesIcon species={patient.species} size={24} /></span>
      <div className="rbody">
        <h1>{patient.name}</h1>
        <p className="t2 num" style={{ margin: 0 }}>{patientMeta(patient, ["breed", "sex", "age", "weight"])}</p>
        <p className="id num" style={{ margin: "2px 0 0" }}>{patient.id}</p>
        <div><AllergyChip patient={patient} /></div>
      </div>
    </section>

    <ul className="list owner"><li><div className="row s">
      <span className="rbody"><span className="t1">{patient.owner}</span><span className="t2 num">Owner · {patient.phone}</span></span>
      {patient.phone !== "—" && <span className="acts">
        <a className="ibtn outline" href={`tel:${patient.phone}`} aria-label={`Call ${patient.owner}`}><Phone {...icon} /></a>
        <a className="ibtn outline" href={whatsappLink(patient.phone)} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${patient.owner}`}><MessageCircle {...icon} /></a>
      </span>}
    </div></li></ul>

    <div className="tabs" role="tablist">{["Summary", "History", "Prescriptions"].map((name) => <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>)}</div>

    {tab === "Summary" && <dl className="kv">
      {last && <div><dt className="num">Last visit · {last.date.replace(/ \d{4}$/, "")}</dt><dd>{last.reason}<small>{[last.notes.examination, last.notes.treatment].filter(Boolean).join(" ")}</small></dd></div>}
      <div><dt>Ongoing</dt><dd>{patient.conditions}</dd></div>
      <div><dt>Current medicines</dt><dd className="num">{patient.medications}</dd></div>
      {(patient.vaccinesDue || patient.vaccinesDone) && <div><dt>Vaccinations</dt><dd className="num">{patient.vaccinesDue && <span className="due">{patient.vaccinesDue}</span>}{patient.vaccinesDue && patient.vaccinesDone && " · "}{patient.vaccinesDone}</dd></div>}
      {patient.followUp !== "—" && <div><dt>Follow-up</dt><dd className="num"><span className="due">{patient.followUp}</span></dd></div>}
      {details && <div><dt>Details</dt><dd className="num">{details}</dd></div>}
    </dl>}

    {tab === "History" && (history.length ? <ul className="list" style={{ borderTop: 0 }}>{history.map((consultation) => <li key={consultation.id}><button className="row" onClick={() => onOpenConsultation(consultation)}>
      <span className="lead"><Stethoscope {...icon} /></span>
      <span className="rbody"><span className="t1">{consultation.reason}</span><span className="t2 num">{shortDate(consultation.date)} · {consultation.complaint}</span></span>
      <span className={`status ${statusTone(consultation.approved ? "Approved" : consultation.status)}`}>{consultation.approved ? "Approved" : consultation.status}</span>
    </button></li>)}</ul> : <p className="empty">No visits recorded yet.</p>)}

    {tab === "Prescriptions" && (prescriptions.length ? <ul className="list tint" style={{ borderTop: 0 }}>{prescriptions.map((consultation) => <li key={consultation.id}><button className="row" onClick={() => onOpenConsultation(consultation)}>
      <span className="lead"><FileText {...icon} /></span>
      <span className="rbody"><span className="t1">{consultation.medicines.map((medicine) => medicine.name).join(", ")}</span><span className="t2 num">RX-{consultation.id.split("-").pop()} · {shortDate(consultation.date)}</span></span>
      <ChevronRight size={16} className="chev" />
    </button></li>)}</ul> : <p className="empty">No prescriptions yet.</p>)}

    <div className="actionbar"><button className="btn lg primary block" onClick={onNewConsultation}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 5, background: "#fff" }} />Start consultation</button></div>
  </div>;
}
