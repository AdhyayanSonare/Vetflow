import { Cat, Dog, PawPrint } from "lucide-react";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ageFrom } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Animal } from "./api";

export function SpeciesIcon({ species, className }: { species: string; className?: string }) {
  const Icon = species === "Dog" ? Dog : species === "Cat" ? Cat : PawPrint;
  return <Icon aria-hidden="true" className={cn("size-5", className)} />;
}

/** The avatar-like tile shown beside a patient. */
export function SpeciesTile({ species, className }: { species: string; className?: string }) {
  return <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-full bg-tint text-primary", className)}><SpeciesIcon species={species} /></span>;
}

export const hasAllergy = (a: Pick<Animal, "allergies">) => !!a.allergies && !/^(none|no|nil|n\/a|—|-)\b/i.test(a.allergies.trim());

export function AllergyChip({ animal }: { animal: Pick<Animal, "allergies"> }) {
  return hasAllergy(animal) ? <StatusBadge tone="danger">Allergy: {animal.allergies}</StatusBadge> : null;
}

/** "Labrador Retriever · 4 yr · 28 kg". Leaves out whatever is not recorded. */
export function patientMeta(a: Pick<Animal, "breed" | "dob" | "weightKg" | "sex" | "species">, extra: ReactNode[] = []) {
  return [a.breed ?? a.species, a.sex, ageFrom(a.dob), a.weightKg ? `${a.weightKg} kg` : "", ...extra].filter(Boolean).join(" · ");
}

/** WhatsApp link for a phone number as typed in India: ten digits get the +91 prefix. */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const full = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}
