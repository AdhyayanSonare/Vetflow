import { expect, test } from "@playwright/test";
import { Api, approvedPrescription, onHand, stockedItem } from "./api";
import { expectNoHorizontalScroll, signIn, snap, watchProblems } from "./helpers";

/**
 * The working days of a pharmacy and a store, driven through the real screens at each screen size,
 * with the results checked independently through the API: the screen saying "done" is not proof.
 */

test("a pharmacist dispenses an approved prescription and the stock goes down", async ({ page, baseURL }, info) => {
  const problems = watchProblems(page);
  const vet = await Api.as("vet", baseURL!);
  const pharmacist = await Api.as("pharmacist", baseURL!);
  try {
    const item = await stockedItem(pharmacist, "Metronidazole");
    const before = await onHand(pharmacist, item.id);
    const { animalName, prescriptionId } = await approvedPrescription(vet, item.id, `${item.genericName} ${item.strength ?? ""}`.trim(), 4);
    // Approving changed nothing.
    expect(await onHand(pharmacist, item.id)).toBe(before);

    await signIn(page, "pharmacist");
    await page.goto("/dispensing");
    await expect(page.getByRole("heading", { name: "Dispensing" })).toBeVisible();
    await expectNoHorizontalScroll(page, "dispensing");
    await page.getByText(animalName).locator("visible=true").first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`Dispense for ${animalName}`);
    await snap(page, info, "dispense-dialog");
    await dialog.getByRole("button", { name: "Confirm dispense" }).click();
    await expect(page.getByText("Dispensed. Stock has been updated.")).toBeVisible();

    // The screen said so. Now check what actually happened.
    expect(await onHand(pharmacist, item.id)).toBe(before - 4);
    const rx = await pharmacist.get<{ lines: Array<{ dispensed: number }> }>(`/api/prescriptions/${prescriptionId}`);
    expect(rx.lines[0].dispensed).toBe(4);
    await expect(page.getByText(animalName)).toHaveCount(0); // gone from "Ready to dispense"
    expect(problems).toEqual([]);
  } finally {
    await vet.dispose();
    await pharmacist.dispose();
  }
});

test("an inventory manager enters a receipt, stock waits for confirmation, then rises", async ({ page, baseURL }, info) => {
  const problems = watchProblems(page);
  const manager = await Api.as("inventory_manager", baseURL!);
  try {
    const item = await stockedItem(manager, "Doxycycline");
    const before = await onHand(manager, item.id);
    const expiry = new Date(Date.now() + 500 * 86400000).toISOString().slice(0, 10);
    const batch = `E2E-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    await signIn(page, "inventory_manager");
    await page.goto("/inventory/receipts/new");
    await expect(page.getByRole("heading", { name: "New receipt" })).toBeVisible();
    await page.getByLabel("Supplier").selectOption({ index: 1 });
    await page.getByLabel("Invoice number").fill(`INV-${batch}`);
    await page.getByRole("button", { name: "Add an item" }).click();
    await page.getByPlaceholder("Search medicines and supplies").fill(item.genericName);
    await page.getByRole("dialog").getByText(item.genericName).first().click();

    await page.getByLabel("Batch number").fill(batch);
    await page.getByLabel("Expiry date").fill(expiry);
    await page.getByLabel(/^Quantity/).fill("25");
    await page.getByLabel(/^Cost per unit/).fill("12.50");
    await expectNoHorizontalScroll(page, "new receipt");
    await snap(page, info, "receipt-filled");
    await page.getByRole("button", { name: "Save draft" }).click();

    await expect(page.getByText("Draft. Stock has not changed yet.")).toBeVisible();
    expect(await onHand(manager, item.id), "a draft receipt must not change stock").toBe(before);

    await page.getByRole("button", { name: "Confirm receipt" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Confirm this receipt?");
    await page.getByRole("alertdialog").getByRole("button", { name: /^Confirm/ }).click();
    await expect(page.getByText("Receipt confirmed. Stock has been updated.")).toBeVisible();

    expect(await onHand(manager, item.id)).toBe(before + 25);
    expect(problems).toEqual([]);
  } finally {
    await manager.dispose();
  }
});

test("an admin switches voice off and the vet is offered typing only; switching it back restores it", async ({ page, baseURL }) => {
  const admin = await Api.as("admin", baseURL!);
  try {
    await signIn(page, "admin");
    await page.goto("/settings/features");
    await expect(page.getByRole("heading", { name: "Features" })).toBeVisible();
    const voice = page.getByLabel("Voice consultations");
    await expect(voice).toBeChecked();
    await voice.uncheck();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();

    // Now the vet's view of the same clinic (this replaces the admin's session in the browser).
    await signIn(page, "vet");
    const vet = await Api.as("vet", baseURL!);
    const [patient] = await vet.get<Array<{ id: string }>>("/api/animals?q=Oreo");
    await vet.dispose();
    await page.goto(`/consult/new?patient=${patient.id}`);
    await expect(page.getByRole("heading", { name: "Record" })).toBeVisible();
    await expect(page.getByText("Voice is switched off for this clinic")).toBeVisible();
    await expect(page.getByLabel("What was said")).toBeVisible(); // typing still works
  } finally {
    // Always leave the clinic as it was, whatever happened above.
    await admin.send("patch", "/api/settings", { voiceEnabled: true });
    await admin.dispose();
  }
  const check = await Api.as("admin", baseURL!);
  expect((await check.get<{ voiceEnabled: boolean }>("/api/settings")).voiceEnabled).toBe(true);
  await check.dispose();
});
