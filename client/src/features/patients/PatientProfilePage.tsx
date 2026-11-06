import { ChevronLeft, FileText, MessageCircle, Mic, Phone } from "lucide-react";
import { Link, useRoute } from "wouter";
import { Page, PageHeader, Section } from "@/components/common/Page";
import { QueryBoundary } from "@/components/common/States";
import { StatusText } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { dateIST, dateTimeIST } from "@/lib/format";
import { usePatient, type AnimalProfile, type ConsultationSummary } from "./api";
import { AllergyChip, patientMeta, SpeciesTile, whatsappLink } from "./components";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return value ? <div><dt className="text-sm text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div> : null;
}

function Visit({ c }: { c: ConsultationSummary }) {
  const rows: Array<[string, string | null]> = [
    ["Complaint", c.complaint], ["Duration", c.durationText], ["Examination", c.examination], ["Diagnosis", c.diagnosis], ["Treatment", c.treatmentPlan], ["Follow-up", c.followUpNote],
  ];
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="font-medium">{dateTimeIST(c.startedAt)}</p><p className="text-sm text-muted-foreground">{c.vetName}{c.source === "voice" ? " · drafted from voice" : ""}</p></div>
        <div className="flex items-center gap-2"><StatusText status={c.status} />{c.status === "draft" && <Button asChild size="sm" variant="secondary"><Link href={`/consult/${c.id}`}>Continue</Link></Button>}</div>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">{rows.map(([k, v]) => <Field key={k} label={k} value={v} />)}</dl>
    </li>
  );
}

function Profile({ a }: { a: AnimalProfile }) {
  const { can } = useAuth();
  const share = whatsappLink(a.ownerPhone, `Hello ${a.ownerName}, this is a message about ${a.name} from the clinic.`);
  return (
    <Page>
      <PageHeader
        back={<Link href="/patients" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Patients</Link>}
        title={<span className="flex items-center gap-3"><SpeciesTile species={a.species} />{a.name}</span>}
        description={<><span>{patientMeta(a)}</span><span className="num ml-2 text-sm">{a.code}</span></>}
        actions={can("clinical.write") ? <Button asChild size="lg"><Link href={`/consult/new?patient=${a.id}`}><Mic /> Start consultation</Link></Button> : undefined}
      />

      {(a.allergies || a.conditions) && (
        <div className="mb-6 flex flex-wrap items-center gap-2"><AllergyChip animal={a} />{a.conditions && <span className="rounded-full bg-tint px-3 py-1 text-sm">Conditions: {a.conditions}</span>}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          <Section title="Visit history">
            {a.consultations.length === 0
              ? <p className="rounded-xl border border-border bg-card p-4 text-muted-foreground">No visits recorded yet.</p>
              : <ul className="space-y-3">{a.consultations.map(c => <Visit key={c.id} c={c} />)}</ul>}
          </Section>
          <Section title="Prescriptions">
            {a.prescriptions.length === 0
              ? <p className="rounded-xl border border-border bg-card p-4 text-muted-foreground">No prescriptions yet.</p>
              : <ul className="divide-y divide-border rounded-xl border border-border bg-card">{a.prescriptions.map(p => (
                  <li key={p.id}><Link href={`/prescriptions/${p.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-tint/50">
                    <span className="flex items-center gap-3"><FileText className="size-5 text-muted-foreground" /><span>{dateIST(p.createdAt)}</span></span><StatusText status={p.status} />
                  </Link></li>))}</ul>}
          </Section>
        </div>

        <aside>
          <Section title="Owner">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="font-medium">{a.ownerName}</p>
              <dl className="mt-2 space-y-2"><Field label="Email" value={a.ownerEmail} /><Field label="Address" value={a.ownerAddress} /></dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {a.ownerPhone && <Button asChild variant="secondary" size="sm"><a href={`tel:${a.ownerPhone.replace(/[^\d+]/g, "")}`}><Phone /> {a.ownerPhone}</a></Button>}
                {share && <Button asChild variant="secondary" size="sm"><a href={share} target="_blank" rel="noreferrer"><MessageCircle /> WhatsApp</a></Button>}
              </div>
            </div>
          </Section>
          <Section title="Details">
            <dl className="space-y-3 rounded-xl border border-border bg-card p-4">
              <Field label="Species" value={a.species} /><Field label="Breed" value={a.breed} /><Field label="Sex" value={a.sex} />
              <Field label="Date of birth" value={a.dob ? dateIST(a.dob) : null} /><Field label="Colour" value={a.colour} />
              <Field label="Weight" value={a.weightKg ? `${a.weightKg} kg` : null} /><Field label="Microchip" value={a.microchip && <span className="num">{a.microchip}</span>} />
            </dl>
          </Section>
        </aside>
      </div>
    </Page>
  );
}

export default function PatientProfilePage() {
  const [, params] = useRoute<{ id: string }>("/patients/:id");
  const q = usePatient(params?.id ?? "");
  return <QueryBoundary query={q}>{a => <Profile a={a} />}</QueryBoundary>;
}
