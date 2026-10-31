import { FolderOpen, PawPrint } from "lucide-react";
import type { Patient } from "./data";

export function IconButton({ label, children, onClick, className = "" }: { label: string; children: React.ReactNode; onClick?: () => void; className?: string }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

export function Button({ children, onClick, variant = "primary", className = "", disabled = false }: { children: React.ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "quiet" | "danger"; className?: string; disabled?: boolean }) {
  return <button disabled={disabled} className={`button button-${variant} ${className}`} onClick={onClick}>{children}</button>;
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "success" | "warning" | "info" | "danger" | "mint" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Avatar({ patient, size = "md" }: { patient: Patient; size?: "sm" | "md" | "lg" }) {
  return <div className={`avatar avatar-${size} avatar-${patient.tone}`}><span>{patient.initials}</span><PawPrint size={size === "lg" ? 14 : 11} strokeWidth={2.2} /></div>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === "Completed" || status === "Approved" ? "success" : status === "In Progress" || status === "Draft" ? "warning" : "info";
  return <Badge tone={tone}>{status}</Badge>;
}

export function EmptyState({ title, description }: { title: string; description: string }) { return <div className="empty-state"><div className="empty-icon"><FolderOpen size={20} /></div><strong>{title}</strong><span>{description}</span></div>; }

export function Field({ label, value, onChange, wide = false, type = "text", inputMode, autoComplete }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; autoComplete?: string }) { return <label className={`field ${wide ? "field-wide" : ""}`}><span>{label}</span><input type={type} inputMode={inputMode} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }

export function EditableNote({ label, value, onChange, readOnly = false, hint }: { label: string; value: string; onChange: (value: string) => void; readOnly?: boolean; hint?: string }) { return <label className="editable-note"><span>{label} {hint && <em>{hint}</em>}</span><textarea readOnly={readOnly} value={value} onChange={(event) => onChange(event.target.value)} rows={value.length > 80 ? 3 : 2} /></label>; }

