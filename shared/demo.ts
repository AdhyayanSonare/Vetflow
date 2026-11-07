/**
 * The synthetic demo clinic. Shared by the seed, the demo launcher and the end-to-end tests so there is
 * one list of accounts. All of it is invented. Do not use this password anywhere real.
 */
export const DEMO_PASSWORD = "Vetflow-demo-2026";
export const DEMO_CLINIC = "Greenfield Veterinary Group";
/** The name earlier seeds used. Still recognised when clearing a half-loaded demo database. */
export const LEGACY_DEMO_CLINICS = ["Greenfield Veterinary Group (demo data)"];

export const DEMO_USERS = [
  { email: "admin@greenfield.demo", name: "Anita Verma", role: "admin", title: "Group administrator" },
  { email: "stores@greenfield.demo", name: "Imran Qureshi", role: "inventory_manager", title: "Inventory manager" },
  { email: "pharmacy@greenfield.demo", name: "Kavya Nair", role: "pharmacist", title: "Pharmacist" },
  { email: "dr.sharma@greenfield.demo", name: "Dr. Meera Sharma", role: "vet", title: "Veterinarian" },
  { email: "dr.rao@greenfield.demo", name: "Dr. Arjun Rao", role: "vet", title: "Veterinarian" },
  { email: "viewer@greenfield.demo", name: "Sunil Das", role: "viewer", title: "Viewer" },
] as const;

export type DemoRole = (typeof DEMO_USERS)[number]["role"];
export const demoUser = (role: DemoRole) => DEMO_USERS.find(u => u.role === role)!;
