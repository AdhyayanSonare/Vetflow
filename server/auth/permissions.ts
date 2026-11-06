export type Role = "admin" | "inventory_manager" | "pharmacist" | "vet" | "viewer";

export const PERMISSIONS = [
  "users.manage", "settings.manage", "audit.read",
  "catalogue.write", "catalogue.read", "suppliers.write",
  "purchase.write", "purchase.confirm",
  "stock.issue", "stock.adjust", "stock.override", "stock.count", "transfer.write",
  "dispense.write", "dispense.counter",
  "clinical.read", "clinical.write", "prescription.approve",
  "reports.read", "import.run",
] as const;
export type Permission = typeof PERMISSIONS[number];

const ALL = new Set<Permission>(PERMISSIONS);
const only = (...p: Permission[]) => new Set<Permission>(p);

export const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  admin: ALL,
  inventory_manager: only("catalogue.write", "catalogue.read", "suppliers.write", "purchase.write", "purchase.confirm",
    "stock.issue", "stock.adjust", "stock.override", "stock.count", "transfer.write", "dispense.write", "dispense.counter",
    "reports.read", "import.run", "audit.read", "clinical.read"),
  pharmacist: only("catalogue.read", "purchase.write", "stock.issue", "stock.count", "transfer.write",
    "dispense.write", "reports.read", "clinical.read"),
  vet: only("catalogue.read", "clinical.read", "clinical.write", "prescription.approve", "reports.read"),
  viewer: only("catalogue.read", "clinical.read", "reports.read"),
};

export const can = (role: Role, p: Permission) => ROLE_PERMISSIONS[role]?.has(p) ?? false;
