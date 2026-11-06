import { Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/client";
import { DataTable } from "@/components/common/DataTable";
import { CheckRow, NativeSelect, TextField } from "@/components/common/Fields";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { Section } from "@/components/common/Page";
import { QueryBoundary } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { ReportView } from "@/features/reports/ReportView";
import { money } from "@/lib/format";
import { Page, PageHeader } from "@/components/common/Page";
import { SettingsShell } from "./SettingsShell";
import { useAddBranch, useBranches, useLicences, useSaveSettings, useSaveSubscription, useSettings, useSubscription, type Branch } from "./api";

function PlainFrame({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <Page><PageHeader title={title} description={description} />{children}</Page>;
}

export function BranchesPage() {
  const branches = useBranches();
  const add = useAddBranch();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setError(null);
    try { await add.mutateAsync({ name: name.trim() }); toast.success("Branch added with its own store."); setOpen(false); setName(""); } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <SettingsShell title="Branches" description="Each branch gets a store of its own. Staff can be limited to the branches they work in." actions={<Button onClick={() => setOpen(true)}><Plus /> Add branch</Button>}>
      <QueryBoundary query={branches}>
        {rows => <DataTable<Branch> caption="Branches" rows={rows} rowKey={b => b.id} columns={[{ key: "name", header: "Branch", primary: true, cell: b => b.name }, { key: "active", header: "Status", cell: b => <StatusBadge tone={b.active ? "ok" : "neutral"}>{b.active ? "Active" : "Inactive"}</StatusBadge> }]} />}
      </QueryBoundary>
      <ResponsiveDialog open={open} onOpenChange={setOpen} title="Add a branch" description="A store is created for it automatically.">
        <TextField label="Branch name" required autoFocus value={name} onChange={e => setName(e.target.value)} />
        {error && <p role="alert" className="mt-3 rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
        <DialogActions><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!name.trim() || add.isPending} onClick={() => void go()}>{add.isPending && <Loader2 className="animate-spin" />}Add branch</Button></DialogActions>
      </ResponsiveDialog>
    </SettingsShell>
  );
}

export function FeaturesPage() {
  const q = useSettings();
  const save = useSaveSettings();
  const { features } = useAuth();
  const [f, setF] = useState<{ voiceEnabled: boolean; barcodeEnabled: boolean; allowNegativeOverride: boolean; days: string; retention: string; lang: string } | null>(null);
  useEffect(() => { if (q.data) setF({ voiceEnabled: q.data.voiceEnabled, barcodeEnabled: q.data.barcodeEnabled, allowNegativeOverride: q.data.allowNegativeOverride, days: q.data.expiryAlertDays.join(", "), retention: String(q.data.transcriptRetentionDays), lang: q.data.asrDefaultLanguage }); }, [q.data]);

  const submit = async () => {
    if (!f) return;
    const days = f.days.split(/[,\s]+/).filter(Boolean).map(Number);
    if (!days.length || days.some(d => !Number.isInteger(d) || d < 1 || d > 730)) { toast.error("Enter alert days as whole numbers, for example 90, 60, 30."); return; }
    try { await save.mutateAsync({ voiceEnabled: f.voiceEnabled, barcodeEnabled: f.barcodeEnabled, allowNegativeOverride: f.allowNegativeOverride, expiryAlertDays: days, transcriptRetentionDays: Number(f.retention) || 0, asrDefaultLanguage: f.lang }); toast.success("Settings saved."); }
    catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <SettingsShell title="Features" description="Switch parts of Vetflow on or off for your clinics. Everything works with voice and barcode switched off.">
      <QueryBoundary query={q}>
        {() => f && (
          <div className="max-w-2xl space-y-6">
            <Section title="Voice">
              <div className="rounded-xl border border-border bg-card p-4">
                <CheckRow label="Voice consultations" description="Record or upload audio and get a draft of the notes and prescription to review." checked={f.voiceEnabled} onChange={e => setF({ ...f, voiceEnabled: e.target.checked })} />
                <p className="mt-2 text-sm text-muted-foreground">On this server: transcription is {features.transcriptionAvailable ? <b>available</b> : <b>not set up</b>}, and note drafting is {features.extractionAvailable ? <b>available</b> : <b>not set up</b>}. Typing a dictation always works.</p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <NativeSelect label="Default language" value={f.lang} onChange={e => setF({ ...f, lang: e.target.value })} hint="Hindi needs a speech service that supports it.">{[["en", "English"], ["de", "German"], ["fr", "French"], ["es", "Spanish"], ["hi", "Hindi"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
                  <TextField label="Keep transcripts for (days)" inputMode="numeric" value={f.retention} onChange={e => setF({ ...f, retention: e.target.value })} hint="0 keeps them. Audio is never stored." />
                </div>
              </div>
            </Section>
            <Section title="Barcodes">
              <div className="rounded-xl border border-border bg-card p-4"><CheckRow label="Camera barcode scanning" description="Adds a scan button to item search. Handheld scanners work either way, because they type into the search box." checked={f.barcodeEnabled} onChange={e => setF({ ...f, barcodeEnabled: e.target.checked })} /></div>
            </Section>
            <Section title="Stock rules">
              <div className="space-y-4 rounded-xl border border-border bg-card p-4">
                <TextField label="Warn about expiry at (days before)" value={f.days} onChange={e => setF({ ...f, days: e.target.value })} hint="For example 90, 60, 30." />
                <CheckRow label="Allow an authorised override of negative stock" description="Lets an admin or inventory manager record a movement that takes stock below zero, with a reason. It is always audited. Off is the safe default." checked={f.allowNegativeOverride} onChange={e => setF({ ...f, allowNegativeOverride: e.target.checked })} />
              </div>
            </Section>
            <Button size="lg" disabled={save.isPending} onClick={() => void submit()}>{save.isPending && <Loader2 className="animate-spin" />}Save settings</Button>
          </div>
        )}
      </QueryBoundary>
    </SettingsShell>
  );
}

export function SubscriptionPage() {
  const q = useSubscription();
  const save = useSaveSubscription();
  const [plan, setPlan] = useState("");
  const [period, setPeriod] = useState("monthly");
  const [next, setNext] = useState("");
  useEffect(() => { if (q.data) { setPlan(q.data.plan); setPeriod(q.data.billingPeriod); setNext(q.data.nextInvoiceDate ?? ""); } }, [q.data]);
  const submit = async () => { try { await save.mutateAsync({ plan: plan.trim(), billingPeriod: period, nextInvoiceDate: next || null }); toast.success("Subscription saved."); } catch (e) { toast.error(errorMessage(e)); } };
  return (
    <SettingsShell title="Subscription" description="Your plan and billing period. Invoices are issued by Astraon Labs and recorded here. There is no online payment.">
      <QueryBoundary query={q}>
        {sub => (
          <div className="max-w-2xl space-y-6">
            <div className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
              <TextField label="Plan" value={plan} onChange={e => setPlan(e.target.value)} />
              <NativeSelect label="Billing period" value={period} onChange={e => setPeriod(e.target.value)}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></NativeSelect>
              <TextField label="Next invoice date" type="date" value={next} onChange={e => setNext(e.target.value)} />
              <div className="flex items-end"><Button disabled={!plan.trim() || save.isPending} onClick={() => void submit()}>{save.isPending && <Loader2 className="animate-spin" />}Save</Button></div>
            </div>
            <Section title="Invoices">
              {sub.invoices.length === 0 ? <p className="rounded-xl border border-border bg-card p-4 text-muted-foreground">No invoices have been recorded yet.</p> : (
                <ul className="divide-y divide-border rounded-xl border border-border bg-card">{sub.invoices.map(i => <li key={i.id} className="flex justify-between gap-3 p-4"><span><span className="num font-medium">{i.number}</span><span className="block text-sm text-muted-foreground">{i.periodStart} to {i.periodEnd}</span></span><span className="num">{money(i.amountPaise)}</span></li>)}</ul>
              )}
            </Section>
          </div>
        )}
      </QueryBoundary>
    </SettingsShell>
  );
}

export function AuditPage() {
  return (
    <SettingsShell title="Audit log" description="Every stock change, sign-in, approval and setting change, with who and when. It cannot be edited or deleted.">
      <ReportView name="audit" filters={{}} />
    </SettingsShell>
  );
}

export function LicencesPage() {
  const q = useLicences();
  const { can } = useAuth();
  const Frame = can("settings.manage") ? SettingsShell : PlainFrame;
  return (
    <Frame title="Licences" description="The models and software Vetflow is built on.">
      <QueryBoundary query={q}>
        {l => (
          <div className="max-w-3xl space-y-6">
            <Section title="Models">
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">{l.models.map(m => (
                <li key={m.name} className="p-4"><p className="font-medium">{m.name} <span className="font-normal text-muted-foreground">by {m.by}</span></p><p className="text-sm">{m.use}</p><p className="mt-1 text-sm text-muted-foreground">Licence: {m.licence}. <a className="text-primary underline-offset-4 hover:underline" href={m.url} target="_blank" rel="noreferrer">Model page</a></p></li>
              ))}</ul>
            </Section>
            <Section title="Software"><ul className="list-disc space-y-1 pl-5">{l.software.map(s => <li key={s}>{s}</li>)}<li>Source Serif 4, IBM Plex Sans and IBM Plex Mono typefaces (SIL Open Font Licence 1.1)</li></ul></Section>
          </div>
        )}
      </QueryBoundary>
    </Frame>
  );
}
