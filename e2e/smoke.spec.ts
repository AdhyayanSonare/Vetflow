import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, signIn, smallTouchTargets, snap, watchProblems } from "./helpers";
import type { DemoRole } from "../shared/demo";

/**
 * Every page, as the role that uses it most, at the three screen sizes. The checks are the same
 * everywhere: no sideways scroll, no console errors, no failed API calls, and on phones every control
 * is at least 44 px. Screenshots land in docs/qa/ for a visual review.
 */
const PAGES: Array<{ name: string; path: string; role: DemoRole; expect: string | RegExp }> = [
  { name: "today", path: "/", role: "vet", expect: /Good (morning|afternoon|evening)/ },
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
    await expect(page.getByText(p.expect).first()).toBeVisible();
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
