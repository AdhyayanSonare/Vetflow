import { useEffect } from "react";
import { Cat, Dog, PawPrint, TriangleAlert, X } from "lucide-react";
import type { Patient } from "./data";

/** Line glyph per species; patients have no photos, and initials read as noise. */
export function SpeciesIcon({ species, size = 20 }: { species: string; size?: number }) {
  const Icon = species === "Dog" ? Dog : species === "Cat" ? Cat : PawPrint;
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" />;
}

export function hasAllergy(patient: Patient) {
  const value = patient.allergies.trim().toLowerCase();
  return value !== "" && value !== "none known" && value !== "none";
}

/** The one filled colour block on a record: allergies are the fact that must not be missed. */
export function AllergyChip({ patient }: { patient: Patient }) {
  if (!hasAllergy(patient)) return <span className="noallergy">No known allergies</span>;
  return <span className="allergy"><TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" />Allergic to {patient.allergies.toLowerCase()}</span>;
}

/** Seamless two-sine path, drawn wider than the viewBox so the drift loops. */
const WAVE_PATH = (() => {
  const points: string[] = [];
  for (let x = 0; x <= 772; x += 2) {
    const y = 36 - 13 * Math.sin((2 * Math.PI * x) / 86) - 4.5 * Math.sin((2 * Math.PI * x) / 43);
    points.push(`${x === 0 ? "M" : "L"}${x} ${y.toFixed(1)}`);
  }
  return points.join(" ");
})();

function WaveMask({ id, y, height }: { id: string; y: number; height: number }) {
  return <defs>
    <linearGradient id={`${id}-fade`} x1="0" x2="1"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".12" stopColor="#fff" /><stop offset=".88" stopColor="#fff" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
    <mask id={id} maskUnits="userSpaceOnUse" x="0" y={y} width="343" height={height}><rect x="0" y={y} width="343" height={height} fill={`url(#${id}-fade)`} /></mask>
  </defs>;
}

/** Recorder wave: flat when idle or paused, moving only while recording. */
export function Wave({ live }: { live: boolean }) {
  return <svg className={`wave ${live ? "live" : ""}`} viewBox="0 0 343 72" aria-hidden="true">
    <WaveMask id="vf-wave" y={-10} height={92} />
    <g mask="url(#vf-wave)"><g className="amp"><g className="drift"><path d={WAVE_PATH} /></g></g></g>
  </svg>;
}

/** The same line settling flat once, as the closing beat of a consultation. */
export function SettleWave() {
  return <svg className="settle" viewBox="0 0 343 32" aria-hidden="true">
    <WaveMask id="vf-settle" y={-20} height={72} />
    <g mask="url(#vf-settle)"><g className="amp"><path transform="translate(0 -20)" d={WAVE_PATH} /></g></g>
  </svg>;
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="v2 v2-sheet-root">
    <div className="scrim" onClick={onClose} aria-hidden="true" />
    <section className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="grab" aria-hidden="true" />
      <div className="sheet-h"><h2>{title}</h2><button className="ibtn" aria-label="Close" onClick={onClose}><X size={20} strokeWidth={1.75} /></button></div>
      {children}
    </section>
  </div>;
}

export function patientMeta(patient: Patient, parts: Array<"breed" | "age" | "weight" | "owner" | "sex"> = ["breed", "age", "owner"]) {
  const map = { breed: patient.breed, age: patient.age, weight: patient.weight, owner: patient.owner, sex: patient.gender };
  return parts.map((key) => map[key]).filter((value) => value && value !== "—").join(" · ");
}

export function statusTone(status: string) {
  if (status === "Completed" || status === "Approved" || status === "Seen") return "ok";
  if (status === "Draft") return "warn";
  if (status === "In Progress" || status === "In progress" || status === "Arrived") return "brand";
  return "";
}

/** wa.me wants digits with a country code; demo numbers are Indian 10-digit. */
export function whatsappLink(phone: string, text?: string) {
  const digits = phone.replace(/\D/g, "");
  const full = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${full}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
