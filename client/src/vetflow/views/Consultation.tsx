import { useState } from "react";
import { CalendarPlus, Check, ChevronLeft, ChevronRight, MessageCircle, Pause, Pill, Play, Plus, Printer, Trash2, Upload, X } from "lucide-react";
import type { Consultation, Medicine, Patient } from "../data";
import { AllergyChip, patientMeta, SettleWave, Sheet, SpeciesIcon, Wave, whatsappLink } from "../kit";
import type { Phase } from "../store";

const icon = { size: 20, strokeWidth: 1.75 } as const;
const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const medLine = (medicine: Medicine) => [medicine.dosage, medicine.frequency, medicine.duration, medicine.route].filter(Boolean).join(" · ");

type Props = {
  patients: Patient[];
  patient: Patient;
  consultation: Consultation;
  phase: Phase;
  elapsed: number;
  notes: Consultation["notes"];
  medicines: Medicine[];
  nextUp?: string;
  onClose: () => void;
  onSelectPatient: (id: string) => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDiscard: () => void;
  onUploadAudio: (file: File) => void;
  onNotesChange: (notes: Consultation["notes"]) => void;
  onSaveNotes: () => void;
  onGoNotes: () => void;
  onGoPrescription: () => void;
  onMedicinesChange: (medicines: Medicine[]) => void;
  onSaveDraft: () => void;
  onApprove: () => void;
  onPrint: () => void;
  onBookFollowUp: () => void;
  onNext: () => void;
};

export function ConsultationView(props: Props) {
  const { phase } = props;
  if (phase === "done") return <DoneStep {...props} />;
  if (phase === "notes") return <NotesStep {...props} />;
  if (phase === "prescription") return <PrescriptionStep {...props} />;
  return <RecordStep {...props} />;
}

function Strip({ patient, changeable, patients, onSelectPatient }: { patient: Patient; changeable?: boolean; patients?: Patient[]; onSelectPatient?: (id: string) => void }) {
  const [picking, setPicking] = useState(false);
  const body = <>
    <span className="lead"><SpeciesIcon species={patient.species} /></span>
    <span className="rbody"><span className="t1">{patient.name}</span><span className="t2 num">{patientMeta(patient, ["breed", "age", "weight", "owner"])}</span><span><AllergyChip patient={patient} /></span></span>
  </>;
  if (!changeable) return <div className="strip">{body}</div>;
  return <>
    <button className="strip" onClick={() => setPicking(true)} aria-label={`Patient: ${patient.name}. Change patient`}>{body}<span className="link" style={{ fontSize: 13 }}>Change</span></button>
    {picking && <Sheet title="Choose patient" onClose={() => setPicking(false)}>
      <ul className="list">{patients?.map((item) => <li key={item.id}><button className="row" onClick={() => { onSelectPatient?.(item.id); setPicking(false); }}>
        <span className="lead"><SpeciesIcon species={item.species} /></span>
        <span className="rbody"><span className="t1">{item.name}</span><span className="t2">{patientMeta(item)}</span></span>
        {item.id === patient.id && <Check size={18} strokeWidth={2} style={{ color: "var(--brand)" }} />}
      </button></li>)}</ul>
    </Sheet>}
  </>;
}

function Header({ step, title, onBack, onClose }: { step: number; title?: string; onBack?: () => void; onClose?: () => void }) {
  return <header className="subbar">
    {onBack ? <button className="ibtn" aria-label="Back" onClick={onBack}><ChevronLeft size={24} strokeWidth={1.75} /></button> : <button className="ibtn" aria-label="Close consultation (draft is saved)" onClick={onClose}><X size={24} strokeWidth={1.75} /></button>}
    <span className="ttl">{title}</span>
    <span className="stepno num">{step} of 3</span>
  </header>;
}

function RecordStep({ patients, patient, phase, elapsed, onClose, onSelectPatient, onStart, onPause, onResume, onStop, onDiscard, onUploadAudio }: Props) {
  const recording = phase === "recording";
  const paused = phase === "paused";
  const processing = phase === "processing";
  const active = recording || paused;
  return <div className="v2 flow">
    <Header step={1} onClose={onClose} />
    <Strip patient={patient} changeable={phase === "ready"} patients={patients} onSelectPatient={onSelectPatient} />
    <div className="stage">
      <div className={`clock num ${phase === "ready" ? "idle" : ""}`} role="timer" aria-label={`${elapsed} seconds`}>{clock(elapsed)}</div>
      <div className="state" aria-live="polite">
        {phase === "ready" && <p className="hint">Speak as you examine. Notes are drafted for your review.</p>}
        {recording && <span className="recpill">Recording</span>}
        {paused && <span className="recpill paused">Paused</span>}
        {processing && <span className="recpill busy">Drafting notes…</span>}
      </div>
      {phase === "ready" && <div className="idle-line" aria-hidden="true" />}
      {active && <Wave live={recording} />}
      {processing && <div className="progress" aria-hidden="true" />}
    </div>
    {phase === "ready" && <div className="controls col">
      <div className="big"><button className="go" aria-label="Start recording" onClick={onStart}><i /></button>Record</div>
      <label className="btn ghost upload"><input type="file" accept="audio/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) onUploadAudio(file); event.currentTarget.value = ""; }} /><Upload {...icon} />Upload audio</label>
    </div>}
    {active && <div className="controls">
      <div className="side">{recording ? <button className="ibtn" aria-label="Pause recording" onClick={onPause}><Pause {...icon} /></button> : <button className="ibtn" aria-label="Resume recording" onClick={onResume}><Play {...icon} /></button>}{recording ? "Pause" : "Resume"}</div>
      <div className="big"><button className="stop" aria-label="Stop and draft notes" onClick={onStop}><i /></button>Stop</div>
      <div className="side"><button className="ibtn" aria-label="Discard recording" onClick={() => { if (window.confirm("Discard this recording?")) onDiscard(); }}><Trash2 {...icon} /></button>Discard</div>
    </div>}
    {processing && <div className="controls" style={{ visibility: "hidden" }} aria-hidden="true"><div className="big"><button className="stop" tabIndex={-1}><i /></button>Stop</div></div>}
  </div>;
}

const noteFields: Array<{ key: keyof Consultation["notes"]; label: string }> = [
  { key: "complaint", label: "Chief complaint" },
  { key: "duration", label: "Duration" },
  { key: "examination", label: "Examination" },
  { key: "diagnosis", label: "Diagnosis" },
  { key: "treatment", label: "Treatment plan" },
  { key: "followUp", label: "Follow-up" },
];

function NotesStep({ patient, consultation, elapsed, notes, onClose, onNotesChange, onSaveNotes, onGoPrescription }: Props) {
  const diagnosisUnconfirmed = /pending/i.test(notes.diagnosis) || !notes.diagnosis.trim();
  return <div className="v2 flow">
    <Header step={2} title="Review notes" onClose={onClose} />
    <Strip patient={patient} />
    <details className="transcript"><summary><span className="num">Transcript · {clock(elapsed)}</span><ChevronRight size={18} /></summary><p>{consultation.transcription}</p></details>
    <div className="note-fields">{noteFields.map((field) => {
      const value = notes[field.key];
      const fromTranscript = value && consultation.notes[field.key] === value;
      return <label key={field.key} className={`nfield ${field.key === "diagnosis" && diagnosisUnconfirmed ? "confirm" : ""}`}>
        <span>{field.label}{field.key === "diagnosis" && diagnosisUnconfirmed ? <em style={{ color: "var(--warn)" }}>Needs your confirmation</em> : fromTranscript ? <em>from transcript</em> : null}</span>
        <textarea rows={2} value={value} placeholder="Not mentioned" onChange={(event) => onNotesChange({ ...notes, [field.key]: event.target.value })} />
      </label>;
    })}</div>
    <div className="actionbar"><button className="btn lg secondary" onClick={onSaveNotes}>Save</button><button className="btn lg primary" onClick={() => { onSaveNotes(); onGoPrescription(); }}>Next: Prescription</button></div>
  </div>;
}

const choice = {
  dosage: ["½ tablet", "1 tablet", "2 tablets", "5 ml"],
  route: ["Oral", "SC", "IM", "IV", "Topical"],
  frequency: ["Once daily", "Twice daily", "Three times daily"],
  duration: ["3 days", "5 days", "7 days", "10 days"],
};
const choiceLabel: Record<string, string> = { "Once daily": "SID", "Twice daily": "BID", "Three times daily": "TID", "3 days": "3 d", "5 days": "5 d", "7 days": "7 d", "10 days": "10 d" };

function PrescriptionStep({ patient, notes, medicines, consultation, onGoNotes, onMedicinesChange, onSaveDraft, onApprove }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const current = medicines.find((medicine) => medicine.id === editing);
  const update = (id: string, field: keyof Medicine, value: string) => onMedicinesChange(medicines.map((medicine) => medicine.id === id ? { ...medicine, [field]: value } : medicine));
  const add = () => { const id = `med-${Date.now()}`; onMedicinesChange([...medicines, { id, name: "", strength: "", dosage: "1 tablet", route: "Oral", frequency: "Twice daily", duration: "5 days", instructions: "" }]); setEditing(id); };
  return <div className="v2 flow">
    <Header step={3} title="Prescription" onBack={onGoNotes} />
    <Strip patient={patient} />
    <dl className="dx"><dt>Diagnosis</dt><dd>{notes.diagnosis || "Not recorded"}</dd></dl>
    <div className="sec-h"><h2>Medicines</h2><span className="meta num">{medicines.length}</span></div>
    <ul className="list tint">
      {medicines.map((medicine) => <li key={medicine.id}><button className="row" onClick={() => setEditing(medicine.id)}>
        <span className="lead"><Pill {...icon} /></span>
        <span className="rbody"><span className="t1">{[medicine.name || "New medicine", medicine.strength].filter(Boolean).join(" ")}</span><span className="t2 num">{medLine(medicine)}</span></span>
        <ChevronRight size={16} className="chev" />
      </button></li>)}
      <li><button className="row add-row" onClick={add}><span className="lead"><Plus {...icon} /></span>Add medicine</button></li>
    </ul>
    {notes.treatment && <><div className="sec-h"><h2>Advice</h2></div><p className="note">{notes.treatment}{notes.followUp ? `. Follow-up ${notes.followUp.toLowerCase()}.` : ""}</p></>}
    <div className="draft-line"><span className="status warn">Draft · not approved</span>{consultation.status === "Draft" && <span className="meta">Saved</span>}</div>
    <div className="actionbar"><button className="btn lg secondary" onClick={onSaveDraft}>Save draft</button><button className="btn lg primary" onClick={() => setConfirming(true)}><Check {...icon} />Approve</button></div>

    {current && <Sheet title="Edit medicine" onClose={() => setEditing(null)}>
      <label className="sfield"><span>Name</span><input value={current.name} autoFocus={!current.name} autoComplete="off" onChange={(event) => update(current.id, "name", event.target.value)} /></label>
      <label className="sfield"><span>Strength</span><input value={current.strength} autoComplete="off" placeholder="e.g. 250 mg" onChange={(event) => update(current.id, "strength", event.target.value)} /></label>
      {(Object.keys(choice) as Array<keyof typeof choice>).map((field) => <ChoiceGroup key={field} label={field === "dosage" ? "Dose" : field[0].toUpperCase() + field.slice(1)} options={choice[field]} value={current[field]} onChange={(value) => update(current.id, field, value)} />)}
      <label className="sfield" style={{ paddingTop: 14 }}><span>Instructions</span><input value={current.instructions} autoComplete="off" placeholder="e.g. Give after food" onChange={(event) => update(current.id, "instructions", event.target.value)} /></label>
      <div className="actionbar">
        <button className="btn lg danger fit" onClick={() => { onMedicinesChange(medicines.filter((medicine) => medicine.id !== current.id)); setEditing(null); }}><Trash2 {...icon} />Remove</button>
        <button className="btn lg primary" onClick={() => setEditing(null)}>Done</button>
      </div>
    </Sheet>}

    {confirming && <Sheet title="Approve prescription?" onClose={() => setConfirming(false)}>
      <ul className="meds" style={{ border: 0 }}>{medicines.length ? medicines.map((medicine) => <li key={medicine.id}><span>{[medicine.name, medicine.strength].filter(Boolean).join(" ")}</span><span className="d num">{medLine(medicine)}</span></li>) : <li><span>No medicines</span></li>}</ul>
      <p className="hint" style={{ maxWidth: "none", padding: "8px 16px 0", textAlign: "left", fontSize: 13 }}>Approving adds this to {patient.name}’s record.</p>
      <div className="actionbar"><button className="btn lg secondary" onClick={() => setConfirming(false)}>Keep editing</button><button className="btn lg primary" onClick={() => { setConfirming(false); onApprove(); }}>Approve</button></div>
    </Sheet>}
  </div>;
}

function ChoiceGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (value: string) => void }) {
  const custom = !!value && !options.includes(value);
  const [other, setOther] = useState(custom);
  return <div className="grp-c">
    <span className="grp-l">{label}</span>
    <div className="opts">
      {options.map((option) => <button key={option} className="opt num" aria-pressed={value === option && !other} onClick={() => { setOther(false); onChange(option); }}>{choiceLabel[option] ?? option}</button>)}
      <button className="opt" aria-pressed={other} onClick={() => setOther(true)} style={{ color: other ? undefined : "var(--ink-2)" }}>Other</button>
    </div>
    {other && <input className="opt-input" value={value} autoFocus aria-label={`${label}, custom`} onChange={(event) => onChange(event.target.value)} />}
  </div>;
}

function DoneStep({ patient, consultation, medicines, nextUp, onClose, onPrint, onBookFollowUp, onNext }: Props) {
  const rx = `RX-${consultation.id.split("-").pop()}`;
  const summary = `${patient.name}: prescription ${rx} from Vetspring Animal Hospital, ${consultation.date}.\n${medicines.map((medicine) => `• ${[medicine.name, medicine.strength].filter(Boolean).join(" ")}: ${medLine(medicine)}${medicine.instructions ? ` (${medicine.instructions})` : ""}`).join("\n")}${consultation.notes.followUp ? `\nFollow-up: ${consultation.notes.followUp}.` : ""}`;
  return <div className="v2 flow">
    <header className="subbar"><span className="ttl" /><button className="ibtn" aria-label="Close and return to Today" onClick={onClose}><X size={24} strokeWidth={1.75} /></button></header>
    <section className="top">
      <span className="mark"><Check size={24} strokeWidth={2} /></span>
      <h1>Prescription approved</h1>
      <p className="num">{patient.name} · {patient.owner} · {consultation.date}, {consultation.time} · {rx}</p>
    </section>
    <SettleWave />
    <div className="sec-h" style={{ paddingTop: 20 }}><h2>Medicines</h2><span className="meta num">{medicines.length}</span></div>
    {medicines.length ? <ul className="meds">{medicines.map((medicine) => <li key={medicine.id}><span>{[medicine.name, medicine.strength].filter(Boolean).join(" ")}</span><span className="d num">{[medicine.dosage, medicine.frequency, medicine.duration].filter(Boolean).join(" · ")}</span></li>)}</ul> : <p className="empty">No medicines prescribed.</p>}
    <div className="sec-h"><h2>Next steps</h2></div>
    <ul className="list tint">
      {patient.phone !== "—" && <li><a className="row s" href={whatsappLink(patient.phone, summary)} target="_blank" rel="noreferrer"><span className="lead"><MessageCircle {...icon} /></span><span className="rbody"><span className="t1">Share with owner</span><span className="t2">WhatsApp · {patient.owner}</span></span><ChevronRight size={16} className="chev" /></a></li>}
      <li><button className="row s" onClick={onBookFollowUp}><span className="lead"><CalendarPlus {...icon} /></span><span className="rbody"><span className="t1">Book follow-up</span><span className="t2">{consultation.notes.followUp || "Choose a time"}</span></span><ChevronRight size={16} className="chev" /></button></li>
      <li><button className="row s" onClick={onPrint}><span className="lead"><Printer {...icon} /></span><span className="rbody"><span className="t1">Print</span></span><ChevronRight size={16} className="chev" /></button></li>
    </ul>
    <div className="actionbar"><button className="btn lg primary" onClick={onNext}>{nextUp ? `Next patient · ${nextUp}` : "Back to Today"}<ChevronRight {...icon} /></button></div>
  </div>;
}
