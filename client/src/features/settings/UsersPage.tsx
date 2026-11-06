import { Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ROLE_LABEL, type Role } from "@shared/permissions";
import { errorMessage } from "@/api/client";
import { DataTable } from "@/components/common/DataTable";
import { CheckRow, NativeSelect, TextField } from "@/components/common/Fields";
import { DialogActions, ResponsiveDialog } from "@/components/common/ResponsiveDialog";
import { QueryBoundary } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { SettingsShell } from "./SettingsShell";
import { useBranches, useSaveUser, useUsers, type StaffUser } from "./api";

const ROLES = Object.keys(ROLE_LABEL) as Role[];
const ROLE_NOTE: Record<Role, string> = {
  admin: "Everything, including users and settings.",
  inventory_manager: "Runs stock, purchasing, counts and reports.",
  pharmacist: "Dispenses prescriptions and handles day-to-day stock.",
  vet: "Records consultations and approves prescriptions.",
  viewer: "Can look but not change anything.",
};

function UserDialog({ user, open, onClose }: { user: StaffUser | null; open: boolean; onClose: () => void }) {
  const save = useSaveUser(user?.id);
  const branches = useBranches();
  const [f, setF] = useState({ name: "", email: "", role: "vet" as Role, password: "", active: true, branchIds: [] as string[] });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setF({ name: user?.name ?? "", email: user?.email ?? "", role: user?.role ?? "vet", password: "", active: user?.active ?? true, branchIds: user?.branchIds ?? [] }); setError(null); } }, [open, user]);

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync(user ? { name: f.name, role: f.role, active: f.active, branchIds: f.branchIds, ...(f.password ? { password: f.password } : {}) } : { name: f.name, email: f.email, role: f.role, password: f.password, branchIds: f.branchIds });
      toast.success(user ? "User updated." : "User added.");
      onClose();
    } catch (e) { setError(errorMessage(e)); }
  };
  const valid = f.name.trim() && (user || (/^\S+@\S+\.\S+$/.test(f.email) && f.password.length >= 10));

  return (
    <ResponsiveDialog open={open} onOpenChange={o => { if (!o) onClose(); }} title={user ? `Edit ${user.name}` : "Add a user"} description={user ? user.email : "Each person gets their own account. Accounts are never shared."}>
      <div className="space-y-4">
        <TextField label="Name" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        {!user && <TextField label="Email" required type="email" inputMode="email" autoComplete="off" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />}
        <NativeSelect label="Role" value={f.role} onChange={e => setF({ ...f, role: e.target.value as Role })} hint={ROLE_NOTE[f.role]}>{ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</NativeSelect>
        <TextField label={user ? "New password (leave blank to keep the current one)" : "Password"} type="password" autoComplete="new-password" required={!user} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} hint="At least 10 characters, with a letter and a number. Changing it signs the person out everywhere." />
        <fieldset className="rounded-lg border border-border p-3">
          <legend className="px-1 font-medium">Branches</legend>
          <p className="mb-1 text-sm text-muted-foreground">Leave all unticked for access to every branch.</p>
          {branches.data?.map(b => <CheckRow key={b.id} label={b.name} checked={f.branchIds.includes(b.id)} onChange={e => setF({ ...f, branchIds: e.target.checked ? [...f.branchIds, b.id] : f.branchIds.filter(x => x !== b.id) })} />)}
        </fieldset>
        {user && <CheckRow label="Active" description="An inactive user cannot sign in. Their history stays." checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} />}
        {error && <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
        <DialogActions><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!valid || save.isPending} onClick={() => void submit()}>{save.isPending && <Loader2 className="animate-spin" />}{user ? "Save changes" : "Add user"}</Button></DialogActions>
      </div>
    </ResponsiveDialog>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const users = useUsers();
  const branches = useBranches();
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [open, setOpen] = useState(false);
  const edit = (u: StaffUser | null) => { setEditing(u); setOpen(true); };
  const branchNames = (ids: string[]) => (ids.length === 0 ? "All branches" : ids.map(id => branches.data?.find(b => b.id === id)?.name ?? "").filter(Boolean).join(", "));

  return (
    <SettingsShell title="Users" description="Who can sign in, what they can do, and which branches they work in." actions={<Button onClick={() => edit(null)}><Plus /> Add user</Button>}>
      <QueryBoundary query={users}>
        {rows => (
          <DataTable<StaffUser> caption="Users" rows={rows} rowKey={u => u.id} onRowClick={u => edit(u)}
            columns={[
              { key: "name", header: "Name", primary: true, cell: u => <span>{u.name}{u.email === me?.email && <StatusBadge className="ml-2">You</StatusBadge>}<span className="block text-sm font-normal text-muted-foreground">{u.email}</span></span> },
              { key: "role", header: "Role", cell: u => ROLE_LABEL[u.role] },
              { key: "branches", header: "Branches", hideOnPhone: true, cell: u => branchNames(u.branchIds) },
              { key: "active", header: "Status", cell: u => <StatusBadge tone={u.active ? "ok" : "neutral"}>{u.active ? "Active" : "Inactive"}</StatusBadge> },
            ]} />
        )}
      </QueryBoundary>
      <UserDialog user={editing} open={open} onClose={() => setOpen(false)} />
    </SettingsShell>
  );
}
