import type { Browser, Page } from "@playwright/test";
import { test, expect, signInAs } from "../fixtures/auth";
import {
  CENTRE_SWITCHER_USERS,
  getTestPool,
  removeCentreSwitcherFixture,
  seedCentreSwitcherFixture,
  type CentreSwitcherFixture,
} from "../helpers/db";

// The Centre page title lists the Centres the viewer may browse and switches
// on click. The list is the real server query over seeded Centres, so these
// journeys prove what the SQL excludes (inactive, School-less, unseated,
// out-of-scope), not just what a mocked list contains.

let fixture: CentreSwitcherFixture;

test.beforeAll(async () => {
  const pool = getTestPool();
  try {
    fixture = await seedCentreSwitcherFixture(pool);
  } finally {
    await pool.end();
  }
});

test.afterAll(async () => {
  const pool = getTestPool();
  try {
    await removeCentreSwitcherFixture(pool);
  } finally {
    await pool.end();
  }
});

async function pageAs(browser: Browser, user: { name: string; email: string }): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, user);
  return page;
}

function switcher(page: Page) {
  return page.getByRole("heading", { level: 1 }).getByRole("button");
}

async function openSwitcher(page: Page) {
  await switcher(page).click();
  return page.getByRole("listbox", { name: "Centres" }).getByRole("option");
}

test.describe("Centre switcher", () => {
  test("a seated user is offered only their seat Centres", async ({ browser }) => {
    const page = await pageAs(browser, CENTRE_SWITCHER_USERS.seated);
    await page.goto(`/centre/${fixture.centres.alpha}`);

    await expect(await openSwitcher(page)).toHaveText([
      "Switcher E2E AlphaCurrentJNV CoE · JNV Surguja (19269)",
      "Switcher E2E CharlieNo Program · JNV Durg (19006)",
    ]);
    await page.context().close();
  });

  test("a seatless School-scoped user is offered every active Centre at their Schools", async ({ browser }) => {
    const page = await pageAs(browser, CENTRE_SWITCHER_USERS.schoolScoped);
    await page.goto(`/centre/${fixture.centres.alpha}`);

    await expect(await openSwitcher(page)).toHaveText([
      "Switcher E2E AlphaCurrentJNV CoE · JNV Surguja (19269)",
      "Switcher E2E AlphaJNV Nodal · JNV Surguja (19269)",
      "Switcher E2E CharlieNo Program · JNV Durg (19006)",
      "Switcher E2E DeltaJNV CoE · JNV Durg (19006)",
    ]);
    await page.context().close();
  });

  test("an admin switches from Centre A to Centre B in one history step", async ({ adminPage: page }) => {
    await page.goto(`/centre/${fixture.centres.alpha}`);
    await expect(page.getByRole("tab", { name: "Enrollment" })).toHaveAttribute("aria-selected", "true");
    const historyBefore = await page.evaluate(() => window.history.length);

    const options = await openSwitcher(page);
    await options.filter({ hasText: "JNV Nodal · JNV Surguja (19269)" }).click();

    await page.waitForURL(new RegExp(`/centre/${fixture.centres.alphaNodal}$`));
    await expect(page.getByRole("tab", { name: "Enrollment" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("JNV Nodal | JNV Surguja", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => window.history.length)).toBe(historyBefore + 1);
  });
});
