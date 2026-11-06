import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Page } from "@/components/common/Page";
import { ErrorState, LoadingState } from "@/components/common/States";
import { usePrescription, type Prescription } from "@/features/prescriptions/api";
import { useConsultation, type Consultation } from "./api";
import { DoneStep } from "./DoneStep";
import { DraftingStep } from "./DraftingStep";
import { NotesStep } from "./NotesStep";
import { PrescriptionStep } from "./PrescriptionStep";
import { RecordStep } from "./RecordStep";
import { useConsultationFlow } from "./useConsultationFlow";

function Flow({ consultation, rx }: { consultation: Consultation; rx: Prescription | null }) {
  const flow = useConsultationFlow(consultation, rx);
  switch (flow.phase) {
    case "transcribing": case "drafting": case "drafted": return <DraftingStep flow={flow} />;
    case "notes": return <NotesStep flow={flow} />;
    case "prescription": return <PrescriptionStep flow={flow} />;
    case "done": return <DoneStep flow={flow} />;
    default: return <RecordStep flow={flow} />;
  }
}

/**
 * A consultation, resumable at any point: the page loads what is saved and opens at the right step.
 * The flow is started from a snapshot taken once. Later refetches (after every save) refresh the data
 * behind the screens but never restart the flow, which owns its own state from then on.
 */
export default function ConsultationPage() {
  const [, params] = useRoute<{ id: string }>("/consult/:id");
  const id = params?.id ?? "";
  const consultation = useConsultation(id);
  const rxId = consultation.data?.prescriptions[0]?.id;
  const rx = usePrescription(rxId);
  const [snapshot, setSnapshot] = useState<{ id: string; c: Consultation; rx: Prescription | null } | null>(null);

  useEffect(() => {
    if (snapshot?.id === id) return;
    if (consultation.data && consultation.data.id === id && (!rxId || rx.data)) setSnapshot({ id, c: consultation.data, rx: rx.data ?? null });
  }, [id, snapshot?.id, consultation.data, rxId, rx.data]);

  return (
    <Page>
      {consultation.isError ? <ErrorState error={consultation.error} onRetry={() => void consultation.refetch()} />
        : snapshot?.id === id ? <Flow key={id} consultation={snapshot.c} rx={snapshot.rx} />
        : <LoadingState rows={3} />}
    </Page>
  );
}
