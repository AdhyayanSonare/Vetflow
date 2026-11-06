import { expect, type Page, type TestInfo } from "@playwright/test";
import { DEMO_PASSWORD, demoUser, type DemoRole } from "../shared/demo";

/** Signs in through the real form as a seeded demo account. */
export async function signIn(page: Page, role: DemoRole = "vet") {
  await page.goto("/");
  await page.getByLabel("Email").fill(demoUser(role).email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
}

/** The page must never scroll sideways. This is the most common phone layout bug. */
export async function expectNoHorizontalScroll(page: Page, label = "page") {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `${label} scrolls sideways (${scrollWidth}px content in a ${innerWidth}px window)`).toBeLessThanOrEqual(innerWidth + 1);
}

/** Visible controls smaller than 44 px in either direction. Text links inside a sentence and skip links are exempt. */
export async function smallTouchTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab]")) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === "hidden" || style.display === "none") continue;
      if (el.closest("[data-touch-ok]") || el.classList.contains("sr-only")) continue;
      // A link that sits inside running text may be smaller.
      if (el.tagName === "A" && el.closest("p, li") && style.display === "inline") continue;
      if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
}

/** Collects console errors and failed API calls for the whole test. */
export function watchProblems(page: Page) {
  const problems: string[] = [];
  // Chrome logs every non-2xx response as "Failed to load resource". Expected 401s (the signed-out session probe) are not bugs;
  // real API failures are caught by the response handler below.
  page.on("console", m => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) problems.push(`console: ${m.text()}`); });
  page.on("pageerror", e => problems.push(`exception: ${e.message}`));
  page.on("response", r => { if (r.url().includes("/api/") && r.status() >= 500) problems.push(`server error ${r.status()}: ${r.url()}`); });
  return problems;
}

/** Saves a screenshot under docs/qa, named by device and page. */
export async function snap(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: `docs/qa/${info.project.name}-${name}.png`, fullPage: false });
}
