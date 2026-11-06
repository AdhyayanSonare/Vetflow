import { expect, test as setup } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { DEMO_PASSWORD, DEMO_USERS } from "../shared/demo";

/**
 * Signs in once per role through the real form and saves the session. Every other test reuses it,
 * so the suite makes a handful of sign-ins instead of hundreds. (The server limits sign-in attempts,
 * on purpose, and the suite must not trip it.)
 */
mkdirSync("e2e/.auth", { recursive: true });
const roles = [...new Map(DEMO_USERS.map(u => [u.role, u])).values()];

for (const u of roles) {
  setup(`sign in as ${u.role}`, async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill(u.email);
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
    await page.context().storageState({ path: `e2e/.auth/${u.role}.json` });
  });
}
