import { useMutation } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { api, errorMessage } from "@/api/client";
import { NativeSelect } from "@/components/common/Fields";
import { Section } from "@/components/common/Page";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { InventoryShell } from "../InventoryShell";
import { useInvalidateStock, useStores } from "../items/api";

type Preview = { committed: boolean; rows: number; valid: number; invalid: number; opening: number; errors: Array<{ row: number; errors: string[] }>; itemsCreated?: number; draftReceiptId?: string | null };
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Check an Excel file first, row by row, and save only when every row is valid. Opening stock becomes a draft receipt to confirm. */
export default function ImportPage() {
  const stores = useStores();
  const invalidate = useInvalidateStock();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [storeId, setStoreId] = useState("");
  const usable = (stores.data ?? []).filter(s => s.kind !== "transit" && s.active);

  const check = useMutation({ mutationFn: (f: File) => api.post<Preview>("/api/import/items", undefined, { raw: f, contentType: XLSX }), onSuccess: setPreview });
  const save = useMutation({
    mutationFn: (f: File) => api.post<Preview>("/api/import/items", undefined, {
      raw: f, contentType: XLSX, query: { commit: "true", storeId: storeId || usable.find(s => s.kind === "central")?.id || usable[0]?.id },
    }),
    onSuccess: p => { setPreview(p); invalidate(); toast.success(`${p.itemsCreated} items imported.`); },
  });

  const pick = (f: File | null) => { setFile(f); setPreview(null); if (f) check.mutate(f, { onError: e => toast.error(errorMessage(e)) }); };

  return (
    <InventoryShell title="Import" description="Bring your item list and opening stock in from Excel. Nothing is saved until every row passes.">
      <Section title="1. Get the template">
        <Button asChild variant="secondary"><a href="/api/import/template.xlsx" download><Download /> Download the Excel template</a></Button>
        <p className="mt-2 text-sm text-muted-foreground">Fill in one row per item. Delete the example row. Opening stock needs a batch number, an expiry date and a cost.</p>
      </Section>

      <Section title="2. Upload and check">
        <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card p-6 text-center hover:bg-tint/40">
          <FileSpreadsheet className="size-7 text-muted-foreground" />
          <span className="font-medium">{file ? file.name : "Choose your Excel file"}</span>
          <span className="text-sm text-muted-foreground">.xlsx, up to 5 MB</span>
          <input type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e => pick(e.target.files?.[0] ?? null)} />
        </label>
        {check.isPending && <p className="mt-3 flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking every row…</p>}
        {check.isError && <p role="alert" className="mt-3 rounded-md bg-danger-tint px-3 py-2 text-danger">{errorMessage(check.error)}</p>}
      </Section>

      {preview && (
        <Section title="3. Result">
          <div className="mb-3 flex flex-wrap gap-2">
            <StatusBadge tone="neutral">{preview.rows} rows read</StatusBadge>
            <StatusBadge tone="ok">{preview.valid} ready</StatusBadge>
            {preview.invalid > 0 && <StatusBadge tone="danger">{preview.invalid} with problems</StatusBadge>}
          </div>
          {preview.errors.length > 0 && (
            <ul className="mb-4 divide-y divide-border rounded-xl border border-danger/30 bg-card" aria-label="Rows with problems">
              {preview.errors.map(e => <li key={e.row} className="p-3"><p className="font-medium">Row <span className="num">{e.row}</span></p><ul className="list-disc pl-5 text-sm text-danger">{e.errors.map(m => <li key={m}>{m}</li>)}</ul></li>)}
            </ul>
          )}
          {preview.committed ? (
            <div className="rounded-xl border border-ok/40 bg-ok-tint p-4"><p className="font-medium text-ok">{preview.itemsCreated} items imported.</p>
              {preview.draftReceiptId && <p className="mt-1">Opening stock is waiting as a draft receipt. <Link href={`/inventory/receipts/${preview.draftReceiptId}`} className="text-primary underline-offset-4 hover:underline">Review and confirm it</Link> to put it on the shelf.</p>}</div>
          ) : preview.invalid === 0 && file ? (
            <div className="space-y-3">
              {preview.opening > 0 && <NativeSelect label="Hold the opening stock in" value={storeId || usable.find(s => s.kind === "central")?.id || usable[0]?.id || ""} onChange={e => setStoreId(e.target.value)}>{usable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>}
              <Button disabled={save.isPending} onClick={() => save.mutate(file, { onError: e => toast.error(errorMessage(e)) })}>{save.isPending && <Loader2 className="animate-spin" />}Import {preview.valid} items</Button>
            </div>
          ) : <p className="text-muted-foreground">Fix the rows above in your file and upload it again.</p>}
        </Section>
      )}
    </InventoryShell>
  );
}
