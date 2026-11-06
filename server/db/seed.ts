import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { createApp } from "../app";
import { poolConfig } from "../config/database";
import { runTenantChecks } from "../jobs/nightly";
import { DEMO_CLINIC, DEMO_PASSWORD, DEMO_USERS } from "../../shared/demo";
import { hashPassword } from "../modules/auth/service";

/**
 * Synthetic demo data. Everything here is invented: the clinic, the people, the phone numbers,
 * the animals and the stock. The clinic name carries "(demo data)" so it can never be mistaken for real records.
 * It is loaded only by an explicit command (pnpm db:seed or pnpm demo), never by the app itself.
 * Business rules are exercised through the real API, so the seed also proves the flows work.
 */
export { DEMO_CLINIC, DEMO_PASSWORD, DEMO_USERS };

type Api = ReturnType<typeof apiClient>;
function apiClient(base: string) {
  let cookie = "";
  let csrf = "";
  // The seed reads many response shapes, so responses are untyped at this boundary only.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<any> => {
    const res = await fetch(base + path, {
      method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(csrf && method !== "GET" ? { "x-csrf-token": csrf } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.getSetCookie()[0];
    if (sc) cookie = sc.split(";")[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json().catch(() => null);
    if (json?.csrfToken) csrf = json.csrfToken;
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json?.error ?? json)}`);
    return json;
  };
  return { call, login: (email: string) => call("POST", "/api/auth/login", { email, password: DEMO_PASSWORD }) };
}

const istDate = (offsetDays: number) => new Date(Date.now() + 5.5 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

type ItemDef = {
  name: string; strength?: string; unit: string; cat: string; supplier: string; min: number; reorder: number;
  controlled?: boolean; vol?: number; bud?: number; loc?: string; barcode?: string;
  /** Opening stock: [batch, expiry in days from today, quantity, cost in rupees] */
  stock?: Array<[string, number, number, number]>;
};

const ITEMS: ItemDef[] = [
  { name: "Amoxicillin Clavulanate", strength: "250 mg", unit: "tablet", cat: "Antibiotics", supplier: "Medivet", min: 60, reorder: 200, loc: "Shelf A1", barcode: "8900000010011", stock: [["AC25-114", 420, 400, 9]] },
  { name: "Amoxicillin Clavulanate", strength: "500 mg", unit: "tablet", cat: "Antibiotics", supplier: "Medivet", min: 60, reorder: 200, loc: "Shelf A1", barcode: "8900000010028", stock: [["AC50-208", 380, 300, 14]] },
  { name: "Cefalexin", strength: "500 mg", unit: "capsule", cat: "Antibiotics", supplier: "Medivet", min: 40, reorder: 150, loc: "Shelf A2", stock: [["CX-77", 300, 180, 11]] },
  { name: "Doxycycline", strength: "100 mg", unit: "tablet", cat: "Antibiotics", supplier: "Medivet", min: 40, reorder: 120, loc: "Shelf A2", stock: [["DX-31", 500, 240, 6]] },
  { name: "Metronidazole", strength: "200 mg", unit: "tablet", cat: "Antibiotics", supplier: "Medivet", min: 60, reorder: 200, loc: "Shelf A2", barcode: "8900000010059", stock: [["MZ-902", 450, 500, 2.5]] },
  { name: "Enrofloxacin", strength: "50 mg", unit: "tablet", cat: "Antibiotics", supplier: "Medivet", min: 30, reorder: 100, loc: "Shelf A3", stock: [["EN-18", 330, 120, 8]] },
  { name: "Ceftriaxone", strength: "1 g", unit: "vial", cat: "Antibiotics", supplier: "Medivet", min: 10, reorder: 40, loc: "Fridge 1", stock: [["CT-554", 200, 4, 62]] },
  { name: "Carprofen", strength: "50 mg", unit: "tablet", cat: "Pain and inflammation", supplier: "Medivet", min: 60, reorder: 200, loc: "Shelf B1", barcode: "8900000010110", stock: [["CP-305", 400, 320, 18]] },
  { name: "Meloxicam", strength: "1.5 mg/ml", unit: "ml", cat: "Pain and inflammation", supplier: "Medivet", min: 100, reorder: 300, loc: "Shelf B1", stock: [["MX-61", 360, 450, 3.2]] },
  { name: "Tramadol", strength: "50 mg", unit: "tablet", cat: "Pain and inflammation", supplier: "Medivet", min: 20, reorder: 60, controlled: true, loc: "Controlled cabinet", stock: [["TR-12", 280, 8, 7]] },
  { name: "Dexamethasone", strength: "4 mg/ml", unit: "vial", cat: "Pain and inflammation", supplier: "Medivet", min: 6, reorder: 24, vol: 10, bud: 28, loc: "Shelf B2", stock: [["DM-77", 310, 14, 55]] },
  { name: "Prednisolone", strength: "10 mg", unit: "tablet", cat: "Pain and inflammation", supplier: "Medivet", min: 40, reorder: 120, loc: "Shelf B2", stock: [["PD-40", 390, 200, 4]] },
  { name: "Ondansetron", strength: "4 mg", unit: "tablet", cat: "Gut and digestion", supplier: "Medivet", min: 30, reorder: 90, loc: "Shelf C1", barcode: "8900000010233", stock: [["ON-3", 350, 12, 15]] },
  { name: "Famotidine", strength: "20 mg", unit: "tablet", cat: "Gut and digestion", supplier: "Medivet", min: 30, reorder: 90, loc: "Shelf C1", stock: [["FM-9", 55, 90, 3]] },
  { name: "Maropitant", strength: "10 mg/ml", unit: "vial", cat: "Gut and digestion", supplier: "Medivet", min: 4, reorder: 12, vol: 20, bud: 28, loc: "Shelf C2", stock: [["MP-21", 330, 8, 780]] },
  { name: "Ketamine", strength: "50 mg/ml", unit: "vial", cat: "Anaesthetics", supplier: "Surgical", min: 4, reorder: 12, controlled: true, vol: 10, bud: 28, loc: "Controlled cabinet", stock: [["KT-08", 260, 9, 340]] },
  { name: "Xylazine", strength: "20 mg/ml", unit: "vial", cat: "Anaesthetics", supplier: "Surgical", min: 4, reorder: 12, vol: 10, bud: 28, loc: "Controlled cabinet", stock: [["XY-33", 270, 7, 210]] },
  { name: "Propofol", strength: "10 mg/ml", unit: "ampoule", cat: "Anaesthetics", supplier: "Surgical", min: 10, reorder: 30, loc: "Shelf D1", stock: [["PF-72", 25, 18, 120]] },
  { name: "Isoflurane", strength: "250 ml", unit: "bottle", cat: "Anaesthetics", supplier: "Surgical", min: 2, reorder: 6, loc: "Shelf D2", stock: [["IS-5", 600, 5, 4200]] },
  { name: "Diazepam", strength: "5 mg/ml", unit: "ampoule", cat: "Anaesthetics", supplier: "Surgical", min: 6, reorder: 20, controlled: true, loc: "Controlled cabinet", stock: [["DZ-14", 240, 12, 38]] },
  { name: "Ringer's Lactate", strength: "500 ml", unit: "bag", cat: "Fluids", supplier: "Surgical", min: 20, reorder: 80, loc: "Store room", stock: [["RL-880", 500, 90, 48]] },
  { name: "Normal Saline 0.9%", strength: "500 ml", unit: "bag", cat: "Fluids", supplier: "Surgical", min: 20, reorder: 80, loc: "Store room", stock: [["NS-441", 520, 110, 42]] },
  { name: "Dextrose 5%", strength: "500 ml", unit: "bag", cat: "Fluids", supplier: "Surgical", min: 10, reorder: 40, loc: "Store room", stock: [["DX5-67", 480, 40, 52]] },
  { name: "Rabies vaccine", strength: "1 ml", unit: "dose", cat: "Vaccines", supplier: "AgroPharm", min: 20, reorder: 60, loc: "Fridge 1", barcode: "8900000010400", stock: [["RV-OLD", -12, 6, 95], ["RV-26A", 240, 54, 98]] },
  { name: "DHPPi vaccine", strength: "1 ml", unit: "dose", cat: "Vaccines", supplier: "AgroPharm", min: 20, reorder: 60, loc: "Fridge 1", stock: [["DH-19", 85, 40, 320]] },
  { name: "Feline tricat vaccine", strength: "1 ml", unit: "dose", cat: "Vaccines", supplier: "AgroPharm", min: 10, reorder: 30, loc: "Fridge 1", stock: [["FT-6", 200, 24, 380]] },
  { name: "Ivermectin", strength: "10 mg/ml", unit: "vial", cat: "Antiparasitic", supplier: "AgroPharm", min: 3, reorder: 10, vol: 50, bud: 28, loc: "Shelf E1", stock: [["IV-90", 18, 6, 410]] },
  { name: "Albendazole", strength: "400 mg", unit: "tablet", cat: "Antiparasitic", supplier: "AgroPharm", min: 40, reorder: 120, loc: "Shelf E1", stock: [["AL-52", 420, 160, 5]] },
  { name: "Fipronil spot-on", strength: "1.34 ml", unit: "pipette", cat: "Antiparasitic", supplier: "AgroPharm", min: 20, reorder: 60, loc: "Shelf E2", barcode: "8900000010509", stock: [["FP-8", 450, 70, 145]] },
  { name: "Praziquantel Pyrantel", strength: "Combination", unit: "tablet", cat: "Antiparasitic", supplier: "AgroPharm", min: 40, reorder: 120, loc: "Shelf E2", stock: [["PP-44", 410, 150, 12]] },
  { name: "Gauze swabs", strength: "10 cm", unit: "pack", cat: "Consumables", supplier: "Surgical", min: 30, reorder: 100, loc: "Store room", stock: [["GZ-100", 900, 120, 35]] },
  { name: "Syringe", strength: "5 ml", unit: "box", cat: "Consumables", supplier: "Surgical", min: 10, reorder: 30, loc: "Store room", barcode: "8900000010608", stock: [["SY5-12", 700, 25, 180]] },
  { name: "Syringe", strength: "10 ml", unit: "box", cat: "Consumables", supplier: "Surgical", min: 8, reorder: 24, loc: "Store room", stock: [["SY10-12", 700, 20, 210]] },
  { name: "IV cannula", strength: "22G", unit: "box", cat: "Consumables", supplier: "Surgical", min: 6, reorder: 20, loc: "Store room", stock: [["IC22-9", 800, 14, 520]] },
  { name: "Surgical gloves", strength: "Medium", unit: "box", cat: "Consumables", supplier: "Surgical", min: 10, reorder: 40, loc: "Store room", stock: [["GL-M-5", 640, 30, 310]] },
  { name: "Suture Vicryl", strength: "2-0", unit: "box", cat: "Consumables", supplier: "Surgical", min: 4, reorder: 12, loc: "Theatre", stock: [["VC20-3", 760, 9, 1450]] },
  { name: "Povidone iodine", strength: "5% 500 ml", unit: "bottle", cat: "Consumables", supplier: "Surgical", min: 6, reorder: 20, loc: "Store room", stock: [["PI-27", 540, 16, 190]] },
  { name: "Chlorhexidine", strength: "2% 500 ml", unit: "bottle", cat: "Consumables", supplier: "Surgical", min: 6, reorder: 20, loc: "Store room", stock: [["CH-30", 560, 14, 175]] },
  { name: "Elizabethan collar", strength: "Medium", unit: "each", cat: "Consumables", supplier: "Surgical", min: 8, reorder: 24, loc: "Store room", stock: [["EC-M-1", 1000, 22, 130]] },
  { name: "Conforming bandage", strength: "10 cm", unit: "roll", cat: "Consumables", supplier: "Surgical", min: 20, reorder: 60, loc: "Store room", stock: [["BD-10", 900, 70, 28]] },
];

export type SeedOptions = { adminUrl: string; appUrl: string; caCert?: string; log?: (msg: string) => void };

export async function seedDemo(opts: SeedOptions) {
  const log = opts.log ?? (() => {});
  const admin = new pg.Pool({ ...poolConfig(opts.adminUrl, opts.caCert), max: 2 });
  const app = new pg.Pool({ ...poolConfig(opts.appUrl, opts.caCert), max: 6 });
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const existing = await admin.query("select count(*)::int n from tenants");
    if (existing.rows[0].n > 0) throw new Error("This database already has a tenant. The demo seed only runs on an empty database.");

    // 1. Tenant, branches, stores, users: direct inserts as the owner role.
    const t = (await admin.query("insert into tenants (name) values ($1) returning id", [DEMO_CLINIC])).rows[0].id as string;
    await admin.query("insert into tenant_settings (tenant_id) values ($1)", [t]);
    await admin.query("insert into subscriptions (tenant_id, plan, billing_period, next_invoice_date) values ($1,'standard','quarterly',$2)", [t, istDate(60)]);
    const branch = async (name: string) => (await admin.query("insert into branches (tenant_id, name) values ($1,$2) returning id", [t, name])).rows[0].id as string;
    const main = await branch("Greenfield Main");
    const river = await branch("Riverside Clinic");
    await admin.query("insert into stores (tenant_id, branch_id, kind, name) values ($1,null,'central','Central store'), ($1,$2,'branch','Main pharmacy'), ($1,$3,'branch','Riverside pharmacy')", [t, main, river]);
    const hash = await hashPassword(DEMO_PASSWORD);
    for (const u of DEMO_USERS) {
      const id = (await admin.query("insert into users (tenant_id, email, name, password_hash, role) values ($1,$2,$3,$4,$5) returning id", [t, u.email, u.name, hash, u.role])).rows[0].id;
      // Admins see every branch. Others work at their own branch.
      if (u.role !== "admin") await admin.query("insert into user_branches (tenant_id, user_id, branch_id) values ($1,$2,$3)", [t, id, u.email.startsWith("dr.rao") ? river : main]);
      if (u.role === "inventory_manager") await admin.query("insert into user_branches (tenant_id, user_id, branch_id) values ($1,$2,$3)", [t, id, river]);
    }
    log("Created the clinic, two branches and six users");

    // 2. Everything else goes through the real API.
    server = createServer(createApp(app));
    await new Promise<void>(r => server!.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const as = async (email: string): Promise<Api> => { const c = apiClient(base); await c.login(email); return c; };
    const adminApi = await as("admin@greenfield.demo");
    const mgr = await as("stores@greenfield.demo");
    const pharm = await as("pharmacy@greenfield.demo");
    const vet = await as("dr.sharma@greenfield.demo");
    const vet2 = await as("dr.rao@greenfield.demo");

    const stores = (await mgr.call("GET", "/api/stores")) as Array<{ id: string; name: string }>;
    const storeId = (n: string) => stores.find(s => s.name === n)!.id;
    const central = storeId("Central store"), mainRx = storeId("Main pharmacy"), riverRx = storeId("Riverside pharmacy");
    await adminApi.call("POST", "/api/departments", { branchId: main, name: "Surgery" });
    await adminApi.call("POST", "/api/departments", { branchId: main, name: "Wards" });

    const cats = new Map<string, string>();
    for (const c of [...new Set(ITEMS.map(i => i.cat))]) cats.set(c, (await mgr.call("POST", "/api/categories", { name: c })).id);
    const sup = new Map<string, string>();
    sup.set("Medivet", (await mgr.call("POST", "/api/suppliers", { name: "Medivet Distributors", contactName: "Ritu Bansal", phone: "+91 90000 10001", email: "orders@medivet.demo", gstin: "07AAAAA0000A1Z5", paymentTerms: "30 days" })).id);
    sup.set("AgroPharm", (await mgr.call("POST", "/api/suppliers", { name: "AgroPharm Supplies", contactName: "Vikram Joshi", phone: "+91 90000 10002", email: "sales@agropharm.demo", gstin: "27BBBBB1111B1Z6", paymentTerms: "15 days" })).id);
    sup.set("Surgical", (await mgr.call("POST", "/api/suppliers", { name: "Surgical Source Pvt Ltd", contactName: "Neha Kapoor", phone: "+91 90000 10003", email: "care@surgicalsource.demo", paymentTerms: "Advance" })).id);

    const itemId = new Map<string, string>();
    const key = (i: ItemDef) => `${i.name}|${i.strength ?? ""}`;
    for (const i of ITEMS) {
      const r = await mgr.call("POST", "/api/items", {
        genericName: i.name, strength: i.strength, unit: i.unit, categoryId: cats.get(i.cat), defaultSupplierId: sup.get(i.supplier), minQty: i.min, reorderQty: i.reorder,
        controlled: !!i.controlled, multiDose: !!i.vol, doseVolumeMl: i.vol, beyondUseDays: i.bud, storageLocation: i.loc, barcode: i.barcode, confirmSimilar: true,
      });
      itemId.set(key(i), r.id);
    }
    log(`Added ${ITEMS.length} catalogue items`);

    // Opening stock arrives as one confirmed receipt per supplier.
    for (const [sk, sid] of sup) {
      const lines = ITEMS.filter(i => i.supplier === sk).flatMap(i => (i.stock ?? []).map(([batchNo, days, quantity, cost]) =>
        ({ itemId: itemId.get(key(i)), batchNo, expiryDate: istDate(days), quantity, unitCostPaise: Math.round(cost * 100) })));
      const rc = await mgr.call("POST", "/api/receipts", { supplierId: sid, storeId: central, invoiceNo: `OPEN-${sk.toUpperCase()}-1`, invoiceDate: istDate(-20), lines });
      await mgr.call("POST", `/api/receipts/${rc.id}/confirm`);
    }
    log("Received opening stock into the central store");

    // Branch stock: transfers out of the central store. One is received in full, one is short, one is still on its way.
    const move = async (to: string, lines: Array<[string, string, number]>) => {
      const tr = await mgr.call("POST", "/api/transfers", { fromStoreId: central, toStoreId: to, lines: lines.map(([n, s, q]) => ({ itemId: itemId.get(`${n}|${s}`), quantity: q })) });
      const sent = await mgr.call("POST", `/api/transfers/${tr.id}/dispatch`);
      return { tr, sent };
    };
    const first = await move(mainRx, [["Carprofen", "50 mg", 120], ["Metronidazole", "200 mg", 200], ["Amoxicillin Clavulanate", "500 mg", 120], ["Meloxicam", "1.5 mg/ml", 200], ["Ondansetron", "4 mg", 6],
      ["Ketamine", "50 mg/ml", 3], ["Dexamethasone", "4 mg/ml", 4], ["Normal Saline 0.9%", "500 ml", 40], ["Syringe", "5 ml", 10], ["Rabies vaccine", "1 ml", 20],
      ["Famotidine", "20 mg", 30], ["Albendazole", "400 mg", 30], ["Doxycycline", "100 mg", 40]]);
    await mgr.call("POST", `/api/transfers/${first.tr.id}/receive`, { lines: first.sent.lines.map((l: { id: string; sentQty: number }) => ({ lineId: l.id, receivedQty: l.sentQty })) });
    const second = await move(riverRx, [["Metronidazole", "200 mg", 100], ["Carprofen", "50 mg", 60]]);
    await mgr.call("POST", `/api/transfers/${second.tr.id}/receive`, { lines: second.sent.lines.map((l: { id: string; sentQty: number }, i: number) =>
      i === 0 ? { lineId: l.id, receivedQty: l.sentQty - 8, reason: "One strip arrived damaged" } : { lineId: l.id, receivedQty: l.sentQty }) });
    await move(riverRx, [["Amoxicillin Clavulanate", "500 mg", 40], ["Fipronil spot-on", "1.34 ml", 20]]);   // left in transit
    log("Moved stock to the branch pharmacies (one transfer left in transit)");

    // A count with a variance, a damaged item, and an order that is part received.
    const count = await mgr.call("POST", "/api/counts", { storeId: mainRx });
    const line = count.lines.find((l: { itemName: string }) => l.itemName === "Carprofen");
    await mgr.call("PUT", `/api/counts/${count.id}/lines`, { lines: [{ lineId: line.id, countedQty: line.systemQty - 2, reason: "Two tablets found loose and discarded" }] });
    await mgr.call("POST", `/api/counts/${count.id}/post`);
    const stock = await mgr.call("GET", `/api/stock?storeId=${central}&itemId=${itemId.get("Gauze swabs|10 cm")}`);
    await mgr.call("POST", "/api/stock/adjust", { type: "damage", itemId: itemId.get("Gauze swabs|10 cm"), batchId: stock[0].batchId, storeId: central, quantity: 3, reason: "Packs wet in a leak" });
    const po = await mgr.call("POST", "/api/purchase-orders", { supplierId: sup.get("Medivet"), storeId: central, expectedDate: istDate(5), notes: "Monthly antibiotics top-up",
      lines: [{ itemId: itemId.get("Ondansetron|4 mg"), quantity: 120, unitCostPaise: 1500 }, { itemId: itemId.get("Tramadol|50 mg"), quantity: 60, unitCostPaise: 700 }] });
    await mgr.call("POST", `/api/purchase-orders/${po.id}/send`);
    const part = await mgr.call("POST", `/api/purchase-orders/${po.id}/receive`, { invoiceNo: "MED-5521", lines: [{ poLineId: po.lines.find((l: { itemName: string }) => l.itemName === "Ondansetron").id, quantity: 60, batchNo: "ON-4", expiryDate: istDate(400) }] });
    await mgr.call("POST", `/api/receipts/${part.receiptId}/confirm`);
    await mgr.call("POST", "/api/purchase-orders/from-low-stock", { storeId: central });
    log("Posted a stock count, a damage entry and purchase orders");

    // Clinical records.
    const mk = async (api: Api, a: { name: string; species: string; breed?: string; sex?: string; dob?: string; weightKg?: number; allergies?: string; owner: { name: string; phone: string }; microchip?: string }) =>
      api.call("POST", "/api/animals", { ...a, branchId: main });
    const bruno = await mk(vet, { name: "Bruno", species: "Dog", breed: "Labrador Retriever", sex: "Male", dob: "2022-03-14", weightKg: 28, owner: { name: "Rahul Sharma", phone: "+91 90000 00101" }, microchip: "900000000000101" });
    const max = await mk(vet, { name: "Max", species: "Dog", breed: "Golden Retriever", sex: "Male", dob: "2021-08-02", weightKg: 31, allergies: "Penicillin", owner: { name: "Priya Patel", phone: "+91 90000 00102" } });
    const bella = await mk(vet, { name: "Bella", species: "Cat", breed: "Persian", sex: "Female", dob: "2023-01-20", weightKg: 4.1, owner: { name: "Amit Verma", phone: "+91 90000 00103" } });
    const coco = await mk(vet2, { name: "Coco", species: "Dog", breed: "Beagle", sex: "Female", dob: "2020-11-09", weightKg: 11.5, owner: { name: "Neha Singh", phone: "+91 90000 00104" } });
    await mk(vet2, { name: "Oreo", species: "Dog", breed: "Indian Spitz", sex: "Male", dob: "2024-02-01", weightKg: 7.2, owner: { name: "Rohan Mehta", phone: "+91 90000 00105" } });
    await mk(vet, { name: "Simba", species: "Cat", breed: "Domestic Shorthair", sex: "Male", dob: "2022-06-30", weightKg: 4.8, owner: { name: "Ayesha Khan", phone: "+91 90000 00106" } });
    await mk(vet2, { name: "Ganga", species: "Cow", breed: "Gir", sex: "Female", dob: "2019-04-10", weightKg: 380, owner: { name: "Mohan Lal", phone: "+91 90000 00107" } });
    await mk(vet2, { name: "Chetak", species: "Horse", breed: "Marwari", sex: "Male", dob: "2018-09-23", weightKg: 420, owner: { name: "Thakur Estates", phone: "+91 90000 00108" } });

    const item = (n: string, s: string) => itemId.get(`${n}|${s}`)!;
    // 1. Bruno: completed visit, approved and dispensed.
    const c1 = await vet.call("POST", "/api/consultations", { animalId: bruno.id, complaint: "Vomiting and loss of appetite", durationText: "About one day", temperatureF: 102, examination: "Mild dehydration. Abdomen soft.", diagnosis: "Acute gastritis", treatmentPlan: "Small meals for 48 hours. Fluids by mouth.", followUpNote: "Review in 5 days" });
    const rx1 = await vet.call("POST", "/api/prescriptions", { consultationId: c1.id, lines: [
      { itemId: item("Ondansetron", "4 mg"), drugText: "Ondansetron 4 mg", dose: "1 tablet", frequency: "twice daily", duration: "3 days", quantity: 6, route: "oral", instructions: "Give before food" },
      { itemId: item("Famotidine", "20 mg"), drugText: "Famotidine 20 mg", dose: "1 tablet", frequency: "once daily", duration: "5 days", quantity: 5, route: "oral" }] });
    await vet.call("POST", `/api/prescriptions/${rx1.id}/approve`);
    await vet.call("POST", `/api/consultations/${c1.id}/complete`);
    const d1 = await pharm.call("POST", "/api/dispenses", { storeId: mainRx, prescriptionId: rx1.id, lines: [{ itemId: item("Ondansetron", "4 mg"), quantity: 6 }, { itemId: item("Famotidine", "20 mg"), quantity: 5 }] });
    await pharm.call("POST", `/api/dispenses/${d1.id}/confirm`, {});

    // 2. Max: approved, waiting at the pharmacy counter.
    const c2 = await vet.call("POST", "/api/consultations", { animalId: max.id, complaint: "Limping on the right hind leg", durationText: "Three days", examination: "Pain on flexing the stifle", diagnosis: "Suspected cruciate strain", treatmentPlan: "Rest. Short lead walks only.", followUpNote: "Review in 10 days" });
    const rx2 = await vet.call("POST", "/api/prescriptions", { consultationId: c2.id, lines: [
      { itemId: item("Carprofen", "50 mg"), drugText: "Carprofen 50 mg", dose: "1 tablet", frequency: "twice daily", duration: "7 days", quantity: 14, route: "oral", instructions: "Give with food" }] });
    await vet.call("POST", `/api/prescriptions/${rx2.id}/approve`);
    await vet.call("POST", `/api/consultations/${c2.id}/complete`);

    // 3. Bella: a voice dictation with one drug the catalogue does not hold. A draft that still needs the vet.
    const c3 = await vet.call("POST", "/api/consultations", { animalId: bella.id, source: "voice", complaint: "Sneezing and runny eyes", durationText: "Four days", examination: "Mild nasal discharge" });
    await vet.call("POST", `/api/consultations/${c3.id}/transcripts`, { language: "en", provider: "demo-data", text: "Bella has been sneezing for four days with runny eyes. Mild nasal discharge. Start doxycycline 100 mg one tablet daily for seven days and lysine supplement twice daily." });
    await vet.call("POST", "/api/prescriptions", { consultationId: c3.id, source: "voice", lines: [
      { itemId: item("Doxycycline", "100 mg"), drugText: "doxycycline", dose: "1 tablet", frequency: "once daily", duration: "7 days", quantity: 7 },
      { drugText: "lysine supplement", frequency: "twice daily" }] });

    // 4. Coco: vaccination visit by the second vet, dispensed from the vial and the fridge.
    const c4 = await vet2.call("POST", "/api/consultations", { animalId: coco.id, complaint: "Annual vaccination and deworming", examination: "Healthy. Weight steady.", diagnosis: "No illness found" });
    const rx4 = await vet2.call("POST", "/api/prescriptions", { consultationId: c4.id, lines: [
      { itemId: item("Rabies vaccine", "1 ml"), drugText: "Rabies vaccine", dose: "1 ml", quantity: 1 },
      { itemId: item("Albendazole", "400 mg"), drugText: "Albendazole 400 mg", dose: "1 tablet", duration: "1 day", quantity: 1 }] });
    await vet2.call("POST", `/api/prescriptions/${rx4.id}/approve`);
    await vet2.call("POST", `/api/consultations/${c4.id}/complete`);
    const d4 = await pharm.call("POST", "/api/dispenses", { storeId: mainRx, prescriptionId: rx4.id, lines: [{ itemId: item("Rabies vaccine", "1 ml"), quantity: 1 }, { itemId: item("Albendazole", "400 mg"), quantity: 1 }] });
    await pharm.call("POST", `/api/dispenses/${d4.id}/confirm`, {});

    // An open ketamine vial with doses drawn for a patient, and a surgery issue.
    const vial = await pharm.call("POST", "/api/vials/open", { itemId: item("Ketamine", "50 mg/ml"), storeId: mainRx });
    await pharm.call("POST", `/api/vials/${vial.id}/draw`, { ml: 1.5, animalId: bruno.id });
    const surgery = (await mgr.call("GET", "/api/departments") as Array<{ id: string; name: string }>).find(d => d.name === "Surgery")!;
    await pharm.call("POST", "/api/stock/issue", { itemId: item("Normal Saline 0.9%", "500 ml"), storeId: mainRx, quantity: 6, departmentId: surgery.id, reason: "Surgery list" });
    log("Added patients, consultations, prescriptions, dispenses and an open vial");

    // Raise alerts the way the nightly job does.
    const checks = await runTenantChecks(app, t);
    log(`Ran the nightly checks: ${checks.expiryAlerts} expiry and ${checks.lowStockAlerts} low-stock alerts`);
    return { tenantId: t, items: ITEMS.length, users: DEMO_USERS.length, ...checks };
  } finally {
    await new Promise<void>(r => (server ? server.close(() => r()) : r()));
    await app.end();
    await admin.end();
  }
}
