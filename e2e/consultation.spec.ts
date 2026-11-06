import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, signIn, smallTouchTargets, snap, watchProblems } from "./helpers";

/**
 * The core story, end to end on the real app: a vet takes a patient through dictation, review,
 * prescription and approval. No transcription service is set up in the test environment, so the
 * dictation is typed. The drafting rules and catalogue matching are the same ones used after speech.
 */
test("a vet completes a consultation from dictation to an approved prescription", async ({ page }, info) => {
  const problems = watchProblems(page);
  await signIn(page, "vet");

  await page.goto("/patients");
  await expect(page.getByRole("heading", { name: "Patients" })).toBeVisible();
  await page.getByPlaceholder("Search patients").fill("oreo");
  await page.getByRole("link", { name: /Oreo/ }).first().click();
  await expect(page.getByRole("heading", { name: /Oreo/ })).toBeVisible();
  await expectNoHorizontalScroll(page, "patient profile");
  await snap(page, info, "patient-profile");

  // 1. Dictation
  await page.getByRole("link", { name: /Start consultation/ }).click();
  await expect(page.getByRole("heading", { name: "Record" })).toBeVisible();
  await expect(page.getByText("not set up on this server")).toBeVisible();
  await page.getByLabel("What was said").fill("Give doxycycline 100 mg one tablet twice daily for seven days and metronidazole 200 mg one tablet three times a day for five days. Also vetmedin 5 mg once daily.");
  if (info.project.name === "phone") expect(await smallTouchTargets(page), "small targets on the record step").toEqual([]);
  await snap(page, info, "consult-record");
  await page.getByRole("button", { name: "Draft from text" }).click();

  // 2. Draft is ready, then the notes
  await expect(page.getByRole("heading", { name: "Your draft is ready" })).toBeVisible();
  await expect(page.getByText("medicines drafted").locator("..")).toContainText("3");
  await page.getByRole("button", { name: /Review notes/ }).click();
  await expect(page.getByRole("heading", { name: "Review notes" })).toBeVisible();
  await page.getByLabel("Chief complaint").fill("Itchy skin for two weeks");
  await page.getByLabel("Diagnosis").fill("Bacterial skin infection");
  await expectNoHorizontalScroll(page, "notes");
  await snap(page, info, "consult-notes");
  await page.getByRole("button", { name: /Next: prescription/ }).click();

  // 3. Prescription: two medicines matched, one the catalogue does not hold
  await expect(page.getByRole("heading", { name: "Prescription" })).toBeVisible();
  await expect(page.getByText("Doxycycline 100 mg")).toBeVisible();
  await expect(page.getByText("Metronidazole 200 mg")).toBeVisible();
  await expect(page.getByText("Choose the matching catalogue item").first()).toBeVisible();
  await snap(page, info, "consult-prescription");

  // Approval is blocked until the unmatched medicine is fixed or removed.
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(/needs? attention/).first()).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();

  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Approve this prescription?");
  await expect(page.getByRole("alertdialog")).toContainText("Doxycycline 100 mg");
  await page.getByRole("alertdialog").getByRole("button", { name: "Approve" }).click();

  // 4. Done
  await expect(page.getByRole("heading", { name: "Prescription approved" })).toBeVisible();
  await expect(page.getByText("Doxycycline 100 mg")).toBeVisible();
  await expectNoHorizontalScroll(page, "done");
  await snap(page, info, "consult-done");
  expect(problems).toEqual([]);
});

test("a half-finished consultation reopens where it was left", async ({ page }) => {
  await signIn(page, "vet");
  await page.goto("/patients");
  await page.getByPlaceholder("Search patients").fill("simba");
  await page.getByRole("link", { name: /Simba/ }).first().click();
  await page.getByRole("link", { name: /Start consultation/ }).click();
  await page.getByRole("button", { name: "Write notes by hand" }).click();
  await page.getByLabel("Chief complaint").fill("Reduced appetite");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Notes saved.")).toBeVisible();

  const url = page.url();
  await page.goto("/");
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Review notes" })).toBeVisible();
  await expect(page.getByLabel("Chief complaint")).toHaveValue("Reduced appetite");
});

test("a pharmacist cannot open the consultation screens", async ({ page }) => {
  await signIn(page, "pharmacist");
  await page.goto("/consult/new");
  await expect(page.getByText("You don't have access to this page")).toBeVisible();
});
