import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import { errorMessage } from "@/api/client";
import { Page, PageHeader } from "@/components/common/Page";
import { SearchInput } from "@/components/common/SearchInput";
import { ErrorState, LoadingState, QueryBoundary } from "@/components/common/States";
import { patientMeta, SpeciesTile } from "@/features/patients/components";
import { usePatients } from "@/features/patients/api";
import { useDebounce } from "@/hooks/useMedia";
import { useCreateConsultation } from "./api";

/** Pick the patient, then start a consultation. With ?patient=<id> it starts straight away. */
export default function NewConsultationPage() {
  const [, navigate] = useLocation();
  const preset = new URLSearchParams(useSearch()).get("patient");
  const [text, setText] = useState("");
  const q = useDebounce(text.trim(), 250);
  const patients = usePatients(q);
  const create = useCreateConsultation();
  const started = useRef(false);
  const [failure, setFailure] = useState<unknown>(null);

  const start = (animalId: string) => {
    if (started.current) return;
    started.current = true;
    setFailure(null);
    create.mutate(animalId, {
      onSuccess: c => navigate(`/consult/${c.id}`, { replace: true }),
      onError: e => { started.current = false; setFailure(e); toast.error(errorMessage(e)); },
    });
  };

  useEffect(() => { if (preset) start(preset); }, [preset]); // eslint-disable-line react-hooks/exhaustive-deps

  if (preset) return <Page>{failure ? <ErrorState error={failure} onRetry={() => start(preset)} /> : <LoadingState rows={2} />}</Page>;

  return (
    <Page>
      <PageHeader title="New consultation" description="Who is the patient?" />
      <SearchInput value={text} onChange={setText} placeholder="Search by name, owner or phone" autoFocus wrapperClassName="mb-4 md:max-w-md" />
      {failure ? <ErrorState error={failure} className="mb-4" /> : null}
      <QueryBoundary query={patients} empty={{ when: p => p.length === 0, element: <p className="rounded-xl border border-border bg-card p-4 text-muted-foreground">No patients match. Register the patient first from the Patients page.</p> }}>
        {rows => (
          <ul className="space-y-2">
            {rows.slice(0, 20).map(a => (
              <li key={a.id}>
                <button type="button" disabled={create.isPending} onClick={() => start(a.id)} className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left hover:bg-tint/50 disabled:opacity-60">
                  <SpeciesTile species={a.species} />
                  <span className="min-w-0"><span className="block truncate font-medium">{a.name}</span><span className="block truncate text-sm text-muted-foreground">{patientMeta(a, [a.ownerName])}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
    </Page>
  );
}
