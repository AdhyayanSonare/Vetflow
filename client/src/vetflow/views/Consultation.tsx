import { useState } from "react";
import { AlertCircle, AudioLines, Check, ChevronLeft, ChevronRight, FileText, MessageCircle, Pause, Pill, Play, Plus, Printer, RotateCcw, Sparkles, Trash2, Upload, X } from "lucide-react";
import type { Consultation, Medicine, Patient } from "../data";
import { AllergyChip, hasAllergy, patientMeta, SettleWave, Sheet, SpeciesIcon, Wave, whatsappLink } from "../kit";
import type { Phase } from "../store";

const icon = { size: 20, strokeWidth: 1.75 } as const;
const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const medName = (medicine: Medicine) => [medicine.name || "New medicine", medicine.strength].filter(Boolean).join(" ");
const medLine = (medicine: Medicine) => [medicine.dosage, medicine.frequency, medicine.duration, medicine.route].filter(Boolean).join(" · ") || "Dose not stated";

export type ExtractStatus = "idle" | "running" | "done" | "failed";

type Props = {
  patients: Patient[];
  patient: Patient;
  consultation: Consultation;
  phase: Phase;
  elapsed: number;
  notes: Consultation["notes"];
  medicines: Medicine[];
  voiceError: string;
  canRetry: boolean;
  onRetry: () => void;
  audioUrl: string;
  extractStatus: ExtractStatus;
  extractError: string;
  onRetryExtract: () => void;
  onClose: () => void;
  onSelectPatient: (id: string) => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDiscard: () => void;
  onUploadAudio: (file: File) => void;
  onNotesChange: (notes: Consultation["notes"]) => void;
  onSaveNotes: (quiet?: boolean) => void;
  onGoNotes: () => void;
  onGoPrescription: () => void;
  onMedicinesChange: (medicines: Medicine[]) => void;
  onSaveDraft: () => void;
  onApprove: () => void;
  onPrint: () => void;
  onNext: () => void;
  onOpenRecord: () => void;
};

export function ConsultationView(props: Props) {
  const { phase } = props;
  if (phase === "done") return <DoneStep {...props} />;
  if (phase === "notes") return <NotesStep {...props} />;
  if (phase === "prescription") return <PrescriptionStep {...props} />;
  if (phase === "processing" || phase === "transcribed") return <PipelineStep {...props} />;
  return <RecordStep {...props} />;
}

function Strip({ patient, changeable, withOwner, patients, onSelectPatient }: { patient: Patient; changeable?: boolean; withOwner?: boolean; patients?: Patient[]; onSelectPatient?: (id: string) => void }) {
  const [picking, setPicking] = useState(false);
  const allergic = hasAllergy(patient);
  const body = <>
    <span className="lead"><SpeciesIcon species={patient.species} /></span>
    <span className="rbody">
      <span className="t1">{patient.name}</span>
      <span className="t2 num">{patientMeta(patient, withOwner ? ["breed", "age", "weight", "owner"] : ["breed", "age", "weight"])}{!withOwner && !allergic && <> · <span className="noallergy">No known allergies</span></>}</span>
      {allergic && <span><AllergyChip patient={patient} /></span>}
    </span>
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

function ErrorNote({ message, action, onAction }: { message: string; action?: string; onAction?: () => void }) {
  return <div className="error-note" role="alert"><AlertCircle size={18} strokeWidth={1.75} /><span>{message}</span>{action && <button className="link" onClick={onAction}><RotateCcw size={16} strokeWidth={2} />&nbsp;{action}</button>}</div>;
}

function RecordStep({ patients, patient, phase, elapsed, voiceError, canRetry, onRetry, onClose, onSelectPatient, onStart, onPause, onResume, onStop, onDiscard, onUploadAudio }: Props) {
  const recording = phase === "recording";
  const paused = phase === "paused";
  const active = recording || paused;
  return <div className="v2 flow">
    <Header step={1} onClose={onClose} />
    <Strip patient={patient} changeable={phase === "ready"} patients={patients} onSelectPatient={onSelectPatient} />
    <div className="stage">
      <div className={`clock num ${phase === "ready" ? "idle" : ""}`} role="timer" aria-label={`${elapsed} seconds`}>{clock(elapsed)}</div>
      <div className="state" aria-live="polite">
        {phase === "ready" && !voiceError && <p className="hint">Talk through the exam as you normally would. VetFlow listens and drafts the notes.</p>}
        {recording && <span className="recpill">Recording</span>}
        {paused && <span className="recpill paused">Paused</span>}
      </div>
      {phase === "ready" && !voiceError && <div className="idle-line" aria-hidden="true" />}
      {phase === "ready" && voiceError && <ErrorNote message={voiceError} action={canRetry ? "Retry" : undefined} onAction={onRetry} />}
      {active && <Wave live={recording} />}
    </div>
    {phase === "ready" && <div className="controls col">
      <div className="big"><button className="go" aria-label="Start recording" onClick={onStart}><i /></button>Record</div>
      <label className="btn ghost upload"><input type="file" accept="audio/*,.mp3,.wav,.m4a,.mp4,.webm,.ogg,.opus,.flac,.mpga" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) onUploadAudio(file); event.currentTarget.value = ""; }} /><Upload {...icon} />Upload audio</label>
    </div>}
    {active && <div className="controls">
      <div className="side">{recording ? <button className="ibtn" aria-label="Pause recording" onClick={onPause}><Pause {...icon} /></button> : <button className="ibtn" aria-label="Resume recording" onClick={onResume}><Play {...icon} /></button>}{recording ? "Pause" : "Resume"}</div>
      <div className="big"><button className="stop" aria-label="Stop and transcribe" onClick={onStop}><i /></button>Stop</div>
      <div className="side"><button className="ibtn" aria-label="Discard recording" onClick={() => { if (window.confirm("Discard this recording?")) onDiscard(); }}><Trash2 {...icon} /></button>Discard</div>
    </div>}
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
const isStated = (value: string) => Boolean(value.trim()) && !/pending doctor/i.test(value);

/** Transcribing → drafting, shown as a live checklist so the wait explains itself. */
function PipelineStep({ patient, phase, elapsed, consultation, notes, medicines, extractStatus, extractError, onRetryExtract, onClose, onGoNotes }: Props) {
  const transcribing = phase === "processing";
  const drafting = !transcribing && (extractStatus === "running" || extractStatus === "idle");
  const failed = extractStatus === "failed";
  const ready = extractStatus === "done";
  const stated = noteFields.filter((field) => isStated(notes[field.key])).length;
  const steps = [
    { label: "Audio captured", sub: elapsed ? `${clock(elapsed)} recorded` : "Uploaded file", state: "done" },
    { label: "Transcribing", sub: transcribing ? "Turning speech into text" : "Transcript ready", state: transcribing ? "active" : "done" },
    { label: "Drafting notes and prescription", sub: failed ? "Couldn’t draft from this transcript" : ready ? "Draft ready for your review" : "Reading what was said", state: transcribing ? "todo" : failed ? "failed" : ready ? "done" : "active" },
  ];
  return <div className="v2 flow">
    <Header step={1} onClose={onClose} />
    <Strip patient={patient} />
    <section className="pipe-head">
      <h1>{ready ? "Your draft is ready" : failed ? "Transcript ready" : "Working on it"}</h1>
      <p>{ready ? "Everything below came from the conversation. Check it before it goes on the record." : failed ? "The notes couldn’t be drafted automatically. Retry, or fill them in from the transcript." : "Keep this screen open. It usually takes a few seconds."}</p>
    </section>
    <ol className="pipe" aria-live="polite">{steps.map((step) => <li key={step.label} className={`pipe-step ${step.state}`}>
      <span className="pipe-dot">{step.state === "done" ? <Check size={16} strokeWidth={2.5} /> : step.state === "failed" ? <AlertCircle size={16} strokeWidth={2} /> : null}</span>
      <span className="rbody"><span className="t1">{step.label}</span><span className="t2">{step.sub}</span></span>
    </li>)}</ol>

    {consultation.transcription && <figure className="quote reveal">
      <figcaption><AudioLines size={16} strokeWidth={1.75} />Transcript</figcaption>
      <blockquote>{consultation.transcription}</blockquote>
    </figure>}

    {ready && <div className="found reveal-group">
      <div className="found-item"><span className="found-n num">{stated}</span><span>note fields filled</span></div>
      <div className="found-item"><span className="found-n num">{medicines.length}</span><span>{medicines.length === 1 ? "medicine" : "medicines"}</span></div>
      <div className="found-item wide"><span className="found-k">Diagnosis</span><span className="found-v">{isStated(notes.diagnosis) ? notes.diagnosis : "Not stated — needs you"}</span></div>
    </div>}
    {failed && <div style={{ padding: "16px 16px 0" }}><ErrorNote message={extractError} action="Retry" onAction={onRetryExtract} /></div>}

    <div className="actionbar">
      {failed ? <button className="btn lg primary" onClick={onGoNotes}>Fill in notes manually</button> : <button className="btn lg primary" disabled={!ready || drafting} onClick={onGoNotes}>{ready ? <>Review notes<ChevronRight {...icon} /></> : <><span className="spinner" aria-hidden="true" />{transcribing ? "Transcribing…" : "Drafting…"}</>}</button>}
    </div>
  </div>;
}

function NotesStep({ patient, consultation, elapsed, notes, audioUrl, onClose, onNotesChange, onSaveNotes, onGoPrescription }: Props) {
  const diagnosisUnconfirmed = !isStated(notes.diagnosis);
  return <div className="v2 flow">
    <Header step={2} title="Review notes" onClose={onClose} />
    <Strip patient={patient} />
    <p className="ai-note"><Sparkles size={16} strokeWidth={1.75} />Drafted from the conversation. Blank means it wasn’t said.</p>
    {consultation.transcription && <details className="transcript"><summary><span className="num">Transcript{elapsed ? ` · ${clock(elapsed)}` : ""}</span><ChevronRight size={18} /></summary>{audioUrl && <audio controls src={audioUrl} style={{ width: "calc(100% - 32px)", margin: "0 16px 12px" }} />}<p>{consultation.transcription}</p></details>}
    <div className="note-fields">{noteFields.map((field) => {
      const value = notes[field.key];
      return <label key={field.key} className={`nfield ${field.key === "diagnosis" && diagnosisUnconfirmed ? "confirm" : ""}`}>
        <span>{field.label}{field.key === "diagnosis" && diagnosisUnconfirmed ? <em style={{ color: "var(--warn)" }}>Needs your confirmation</em> : isStated(value) ? <em>from transcript</em> : <em>not mentioned</em>}</span>
        <textarea rows={2} value={field.key === "diagnosis" && !isStated(value) ? "" : value} placeholder={field.key === "diagnosis" ? "Enter your diagnosis" : "Not mentioned"} onChange={(event) => onNotesChange({ ...notes, [field.key]: event.target.value })} />
      </label>;
    })}</div>
    <div className="actionbar"><button className="btn lg secondary" onClick={() => onSaveNotes()}>Save</button><button className="btn lg primary" onClick={() => { onSaveNotes(true); onGoPrescription(); }}>Next: Prescription</button></div>
  </div>;
}

const choice = {
  dosage: ["½ tab", "1 tab", "2 tab"],
  route: ["Oral", "SC", "IM", "IV"],
  frequency: ["SID", "BID", "TID"],
  duration: ["3 days", "5 days", "7 days", "10 days"],
};
const choiceLabel: Record<string, string> = { "3 days": "3 d", "5 days": "5 d", "7 days": "7 d", "10 days": "10 d" };
const nowLabel = () => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

function PrescriptionStep({ patient, notes, medicines, onGoNotes, onMedicinesChange, onSaveDraft, onApprove }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Drafts persist on every edit, so "Saved" is when this screen last wrote them.
  const [savedAt, setSavedAt] = useState(nowLabel);
  const current = medicines.find((medicine) => medicine.id === editing);
  const update = (id: string, field: keyof Medicine, value: string) => onMedicinesChange(medicines.map((medicine) => medicine.id === id ? { ...medicine, [field]: value } : medicine));
  const add = () => { const id = `med-${Date.now()}`; onMedicinesChange([...medicines, { id, name: "", strength: "", dosage: "", route: "Oral", frequency: "", duration: "", instructions: "" }]); setEditing(id); };
  return <div className="v2 flow">
    <Header step={3} title="Prescription" onBack={onGoNotes} />
    <Strip patient={patient} withOwner />
    <dl className="dx"><dt>Diagnosis</dt><dd>{isStated(notes.diagnosis) ? notes.diagnosis : <span style={{ color: "var(--warn)" }}>Not confirmed yet</span>}</dd></dl>
    <div className="sec-h"><h2>Medicines</h2><span className="meta">{medicines.length ? "Drafted from the conversation" : ""}</span></div>
    <ul className="list tint reveal-group">
      {medicines.length === 0 && <li><p className="empty" style={{ margin: 0 }}>No medicines were mentioned in the recording.</p></li>}
      {medicines.map((medicine) => <li key={medicine.id}><button className="row" onClick={() => setEditing(medicine.id)}>
        <span className="lead"><Pill {...icon} /></span>
        <span className="rbody"><span className="t1">{medName(medicine)}</span><span className="t2 num">{medLine(medicine)}</span></span>
        <ChevronRight size={16} className="chev" />
      </button></li>)}
      <li><button className="row add-row" onClick={add}><span className="lead"><Plus {...icon} /></span>{medicines.length ? "Add a missed medicine" : "Add medicine"}</button></li>
    </ul>
    {notes.treatment && <><div className="sec-h"><h2>Advice</h2></div><p className="note">{notes.treatment}{notes.followUp ? ` ${notes.followUp.replace(/\.?$/, ".")}` : ""}</p></>}
    <div className="draft-line"><span className="status warn">Draft · not approved</span><span className="meta num">Saved {savedAt}</span></div>
    <div className="actionbar"><button className="btn lg secondary" onClick={() => { onSaveDraft(); setSavedAt(nowLabel()); }}>Save draft</button><button className="btn lg primary" onClick={() => setConfirming(true)}><Check {...icon} />Approve</button></div>

    {current && <Sheet title="Edit medicine" onClose={() => setEditing(null)}>
      <label className="sfield"><span>Name and strength</span><input value={[current.name, current.strength].filter(Boolean).join(" ")} autoFocus={!current.name} autoComplete="off" placeholder="e.g. Metronidazole 250 mg" onChange={(event) => onMedicinesChange(medicines.map((medicine) => medicine.id === current.id ? { ...medicine, name: event.target.value, strength: "" } : medicine))} /></label>
      {(Object.keys(choice) as Array<keyof typeof choice>).map((field) => <ChoiceGroup key={field} label={field === "dosage" ? "Dose" : field[0].toUpperCase() + field.slice(1)} options={choice[field]} allowOther={field !== "route"} value={current[field]} onChange={(value) => update(current.id, field, value)} />)}
      <label className="sfield" style={{ paddingTop: 14 }}><span>Instructions</span><input value={current.instructions} autoComplete="off" placeholder="e.g. Give after food" onChange={(event) => update(current.id, "instructions", event.target.value)} /></label>
      <div className="actionbar">
        <button className="btn lg danger fit" onClick={() => { onMedicinesChange(medicines.filter((medicine) => medicine.id !== current.id)); setEditing(null); }}><Trash2 {...icon} />Remove</button>
        <button className="btn lg primary" onClick={() => setEditing(null)}>Done</button>
      </div>
    </Sheet>}

    {confirming && <Sheet title="Approve prescription?" onClose={() => setConfirming(false)}>
      <ul className="meds" style={{ border: 0 }}>{medicines.length ? medicines.map((medicine) => <li key={medicine.id}><span>{medName(medicine)}</span><span className="d num">{medLine(medicine)}</span></li>) : <li><span>No medicines</span></li>}</ul>
      <p className="hint" style={{ maxWidth: "none", padding: "8px 16px 0", textAlign: "left", fontSize: 13 }}>Approving adds this to {patient.name}’s record.</p>
      <div className="actionbar"><button className="btn lg secondary" onClick={() => setConfirming(false)}>Keep editing</button><button className="btn lg primary" onClick={() => { setConfirming(false); onApprove(); }}>Approve</button></div>
    </Sheet>}
  </div>;
}

function ChoiceGroup({ label, options, allowOther = true, value, onChange }: { label: string; options: string[]; allowOther?: boolean; value: string; onChange: (value: string) => void }) {
  const custom = !!value && !options.includes(value);
  const [other, setOther] = useState(custom);
  return <div className="grp-c">
    <span className="grp-l">{label}</span>
    <div className="opts">
      {options.map((option) => <button key={option} className="opt num" aria-pressed={value === option && !other} onClick={() => { setOther(false); onChange(option); }}>{choiceLabel[option] ?? option}</button>)}
      {(allowOther || other) && <button className="opt" aria-pressed={other} onClick={() => setOther(true)} style={{ color: other ? undefined : "var(--ink-2)" }}>Other</button>}
    </div>
    {other && <input className="opt-input" value={value} autoFocus aria-label={`${label}, custom`} onChange={(event) => onChange(event.target.value)} />}
  </div>;
}

function DoneStep({ patient, consultation, medicines, onClose, onPrint, onNext, onOpenRecord }: Props) {
  const rx = `RX-${consultation.id.split("-").pop()}`;
  const summary = `${patient.name}: prescription ${rx} from Vetspring Animal Hospital, ${consultation.date}.\n${medicines.map((medicine) => `• ${medName(medicine)}: ${medLine(medicine)}${medicine.instructions ? ` (${medicine.instructions})` : ""}`).join("\n")}${consultation.notes.followUp ? `\nFollow-up: ${consultation.notes.followUp}.` : ""}`;
  return <div className="v2 flow">
    <header className="subbar"><span className="ttl" /><button className="ibtn" aria-label="Close and return to Today" onClick={onClose}><X size={24} strokeWidth={1.75} /></button></header>
    <section className="top">
      <span className="mark pop"><Check size={24} strokeWidth={2} /></span>
      <h1>Prescription approved</h1>
      <p className="num">{patient.name} · {patient.owner} · {consultation.date.replace(/ \d{4}$/, "")}, {consultation.time} · {rx}</p>
    </section>
    <SettleWave />
    <div className="sec-h" style={{ paddingTop: 20 }}><h2>Medicines</h2><span className="meta num">{medicines.length}</span></div>
    {medicines.length ? <ul className="meds reveal-group">{medicines.map((medicine) => <li key={medicine.id}><span>{medName(medicine)}</span><span className="d num">{[medicine.dosage, medicine.frequency, medicine.duration.replace(/ days?$/, " d")].filter(Boolean).join(" · ")}</span></li>)}</ul> : <p className="empty">No medicines prescribed.</p>}
    <div className="sec-h"><h2>Next steps</h2></div>
    <ul className="list tint">
      {patient.phone !== "—" && <li><a className="row s" href={whatsappLink(patient.phone, summary)} target="_blank" rel="noreferrer"><span className="lead"><MessageCircle {...icon} /></span><span className="rbody"><span className="t1">Share with owner</span><span className="t2">WhatsApp · {patient.owner}</span></span><ChevronRight size={16} className="chev" /></a></li>}
      <li><button className="row s" onClick={onPrint}><span className="lead"><Printer {...icon} /></span><span className="rbody"><span className="t1">Print</span></span><ChevronRight size={16} className="chev" /></button></li>
      <li><button className="row s" onClick={onOpenRecord}><span className="lead"><FileText {...icon} /></span><span className="rbody"><span className="t1">Open {patient.name}’s record</span></span><ChevronRight size={16} className="chev" /></button></li>
    </ul>
    <div className="actionbar"><button className="btn lg secondary" onClick={onClose}>Today</button><button className="btn lg primary" onClick={onNext}>Next consultation<ChevronRight {...icon} /></button></div>
  </div>;
}
