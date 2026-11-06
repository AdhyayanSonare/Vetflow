import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, signIn, smallTouchTargets, snap, watchProblems } from "./helpers";
import type { DemoRole } from "../shared/demo";

/**
 * Every page, as the role that uses it most, at the three screen sizes. The checks are the same
 * everywhere: no sideways scroll, no console errors, no failed API calls, and on phones every control
 * is at least 44 px. Screenshots land in docs/qa/ for a visual review.
 */
const PAGES: Array<{ name: string; path: string; role: DemoRole; heading: string | RegExp }> = [
  { name: "today", path: "/", role: "vet", heading: /Good (morning|afternoon|evening)/ },
  { name: "patients", path: "/patients", role: "vet", heading: "Patients" },
  { name: "prescriptions", path: "/prescriptions", role: "vet", heading: "Prescriptions" },
  { name: "dispensing", path: "/dispensing", role: "pharmacist", heading: "Dispensing" },
  { name: "items", path: "/inventory", role: "inventory_manager", heading: "Items" },
  { name: "receipts", path: "/inventory/receipts", role: "inventory_manager", heading: "Receipts" },
  { name: "receipt-new", path: "/inventory/receipts/new", role: "inventory_manager", heading: "New receipt" },
  { name: "orders", path: "/inventory/orders", role: "inventory_manager", heading: "Purchase orders" },
  { name: "suppliers", path: "/inventory/suppliers", role: "inventory_manager", heading: "Suppliers" },
  { name: "transfers", path: "/inventory/transfers", role: "inventory_manager", heading: "Transfers" },
  { name: "counts", path: "/inventory/counts", role: "inventory_manager", heading: "Stock counts" },
  { name: "vials", path: "/inventory/vials", role: "inventory_manager", heading: "Open vials" },
  { name: "alerts", path: "/inventory/alerts", role: "inventory_manager", heading: "Alerts" },
  { name: "import", path: "/inventory/import", role: "inventory_manager", heading: "Import" },
  { name: "reports", path: "/reports", role: "inventory_manager", heading: "Reports" },
  { name: "users", path: "/settings", role: "admin", heading: "Users" },
  { name: "branches", path: "/settings/branches", role: "admin", heading: "Branches" },
  { name: "features", path: "/settings/features", role: "admin", heading: "Features" },
  { name: "subscription", path: "/settings/subscription", role: "admin", heading: "Subscription" },
  { name: "audit", path: "/settings/audit", role: "admin", heading: "Audit log" },
  { name: "licences", path: "/licences", role: "viewer", heading: "Licences" },
];

test("sign-in page fits the screen", async ({ page }, info) => {
  const problems = watchProblems(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expectNoHorizontalScroll(page, "sign-in");
  if (info.project.name === "phone") expect(await smallTouchTargets(page)).toEqual([]);
  await snap(page, info, "signin");
  expect(problems).toEqual([]);
});

test("wrong password shows a clear message and stays signed out", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("dr.sharma@greenfield.demo");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("email or password is not correct");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

for (const p of PAGES) {
  test(`${p.name} page works at this size`, async ({ page }, info) => {
    const problems = watchProblems(page);
    await signIn(page, p.role);
    if (p.path !== "/") await page.goto(p.path);
    await expect(page.getByRole("heading", { name: p.heading, level: 1 }).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoHorizontalScroll(page, p.name);
    if (info.project.name === "phone") expect(await smallTouchTargets(page), `small touch targets on ${p.name}`).toEqual([]);
    await snap(page, info, p.name);
    expect(problems).toEqual([]);
  });
}

test("navigation matches the screen size", async ({ page }, info) => {
  await signIn(page, "vet");
  const nav = page.getByRole("navigation", { name: "Main" }).first();
  const box = await nav.boundingBox();
  if (info.project.name === "phone") {
    expect(box!.y, "tab bar sits at the bottom").toBeGreaterThan(600);
    await expect(page.getByRole("link", { name: "Record" })).toBeVisible();
  } else if (info.project.name === "tablet") {
    expect(box!.width, "icon rail").toBeLessThan(100);
  } else {
    expect(box!.width, "full sidebar").toBeGreaterThan(200);
  }
});

test("detail pages open from their lists and fit the screen", async ({ page }, info) => {
  const problems = watchProblems(page);
  await signIn(page, "inventory_manager");

  await page.goto("/inventory");
  await page.getByRole("link", { name: /Carprofen/ }).first().click();
  await expect(page.getByRole("heading", { name: /Carprofen/, level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stock by batch" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoHorizontalScroll(page, "item detail");
  if (info.project.name === "phone") expect(await smallTouchTargets(page), "small targets on item detail").toEqual([]);
  await snap(page, info, "item-detail");

  await page.goto("/inventory/orders");
  await page.getByRole("link", { name: /PO-/ }).first().click();
  await expect(page.getByRole("heading", { name: /PO-/, level: 1 })).toBeVisible();
  await expectNoHorizontalScroll(page, "order detail");
  await snap(page, info, "order-detail");

  await page.goto("/inventory/transfers");
  await page.getByRole("link", { name: /Central store/ }).first().click();
  await expect(page.getByText("Batch").first()).toBeVisible();
  await expectNoHorizontalScroll(page, "transfer detail");

  await page.goto("/inventory/counts");
  await page.getByRole("link", { name: /Main pharmacy/ }).first().click();
  await expect(page.getByRole("heading", { name: /Count of/, level: 1 })).toBeVisible();
  await expectNoHorizontalScroll(page, "count");
  expect(problems).toEqual([]);
});

test("a prescription document prints cleanly and fits the screen", async ({ page }, info) => {
  await signIn(page, "vet");
  await page.goto("/prescriptions");
  await page.getByRole("link", { name: /Bruno/ }).first().click();
  await expect(page.getByRole("heading", { name: /Prescription for Bruno/, level: 1 })).toBeVisible();
  await expect(page.getByText("Approved by").first()).toBeVisible();
  await expectNoHorizontalScroll(page, "prescription document");
  await snap(page, info, "prescription-document");
});
