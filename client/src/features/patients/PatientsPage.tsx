import { Plus } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { DataTable } from "@/components/common/DataTable";
import { Page, PageHeader } from "@/components/common/Page";
import { SearchInput } from "@/components/common/SearchInput";
import { EmptyState, QueryBoundary } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { useDebounce } from "@/hooks/useMedia";
import { ageFrom, dateIST } from "@/lib/format";
import { usePatients, type Animal } from "./api";
import { AllergyChip, hasAllergy, SpeciesTile } from "./components";
import { RegisterPatientDialog } from "./RegisterPatientDialog";

export default function PatientsPage() {
  const { can } = useAuth();
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const [registering, setRegistering] = useState(false);
  const q = useDebounce(text.trim(), 250);
  const patients = usePatients(q);

  return (
    <Page>
      <PageHeader
        title="Patients"
        description="Search by name, owner, phone, ID or microchip."
        actions={can("clinical.write") ? <Button onClick={() => setRegistering(true)}><Plus /> Register patient</Button> : undefined}
      />
      <SearchInput value={text} onChange={setText} placeholder="Search patients" wrapperClassName="mb-4 md:max-w-md" />

      <QueryBoundary
        query={patients}
        empty={{
          when: p => p.length === 0,
          element: <EmptyState title={q ? `No patients match “${q}”` : "No patients yet"} description={q ? "Check the spelling, or try the owner's phone number." : "Register the first patient to start recording consultations."}
            action={can("clinical.write") ? <Button onClick={() => setRegistering(true)}><Plus /> Register patient</Button> : undefined} />,
        }}
      >
        {rows => (
          <DataTable<Animal>
            caption="Patients"
            rows={rows}
            rowKey={a => a.id}
            href={a => `/patients/${a.id}`}
            columns={[
              { key: "name", header: "Patient", primary: true, cell: a => (
                <span className="flex items-center gap-3"><SpeciesTile species={a.species} className="size-10" /><span className="min-w-0"><span className="block truncate font-medium">{a.name}</span><span className="block truncate text-sm font-normal text-muted-foreground">{[a.breed ?? a.species, ageFrom(a.dob)].filter(Boolean).join(" · ")}</span></span></span>
              ) },
              { key: "owner", header: "Owner", cell: a => <span>{a.ownerName}<span className="block text-sm text-muted-foreground">{a.ownerPhone}</span></span> },
              { key: "code", header: "ID", cell: a => <span className="num text-sm">{a.code}</span>, hideOnPhone: true },
              { key: "allergy", header: "Allergy", cell: a => hasAllergy(a) ? <AllergyChip animal={a} /> : <span className="text-muted-foreground">None recorded</span>, hideOnPhone: true },
              { key: "last", header: "Last visit", cell: a => a.lastConsultation ? dateIST(a.lastConsultation) : <span className="text-muted-foreground">No visits</span> },
            ]}
          />
        )}
      </QueryBoundary>

      <RegisterPatientDialog open={registering} onOpenChange={setRegistering} onCreated={a => navigate(`/patients/${a.id}`)} />
    </Page>
  );
}
