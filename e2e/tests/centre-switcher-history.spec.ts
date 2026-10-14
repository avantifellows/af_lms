import type { Browser, Page } from "@playwright/test";
import { test, expect, signInAs } from "../fixtures/auth";
import {
  CENTRE_SWITCHER_USERS,
  getTestPool,
  removeCentreSwitcherFixture,
  seedCentreSwitcherFixture,
  type CentreSwitcherFixture,
} from "../helpers/db";

// Switching Centres keeps the outer tab and nothing else, adds exactly one
// history entry, and Back/Forward undo and redo it. The router, URL and
// history are the real app's; the analytics API is stubbed with fixed answers
// (as in performance-history.spec.ts) so Performance is deterministic.

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

const OVERVIEW = {
  summary: { tests_conducted: 1, avg_participation: 0 },
  tests: [
    {
      session_id: "e2e-full",
      test_name: "E2E Full Test",
      start_date: "2026-07-02",
      student_count: 9,
      stream_student_count: 9,
      test_format: "full_test",
      test_stream: null,
      test_grade: 12,
      subjects: [],
    },
  ],
  totalEnrolled: 10,
  enrolledByStream: {},
  streams: ["pcm", "pcb"],
};

const DEEP_DIVE = {
  summary: {
    test_name: "E2E Full Test",
    start_date: "2026-07-02",
    students_appeared: 8,
    students_submitted: 8,
    avg_score: 50,
    min_score: 20,
    max_score: 80,
    avg_marks: 50,
    min_marks: 20,
    max_marks: 80,
    total_marks: 100,
    avg_accuracy: 60,
    avg_attempt_rate: 70,
  },
  subjects: [],
  chapters: [],
  students: [],
};

async function stubAnalytics(page: Page) {
  await page.route("**/api/quiz-analytics/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/grades")) {
      // Whatever Program the Centre locks to is the only one offered.
      await route.fulfill({ json: { grades: [11, 12], programs: [url.searchParams.get("program") ?? "JNV CoE"] } });
    } else if (url.pathname.endsWith("/batch-overview")) {
      await route.fulfill({ json: OVERVIEW });
    } else if (url.pathname.endsWith("/test-deep-dive")) {
      await route.fulfill({ json: DEEP_DIVE });
    } else if (url.pathname.endsWith("/combined-reports")) {
      await route.fulfill({ json: { jobs: [], can_generate: false } });
    } else {
      await route.fulfill({ status: 404, json: {} });
    }
  });
}

// Every history write, in order — Next's own push/replace included, because
// this wrapper is installed before the app patches the history API.
async function recordHistoryWrites(page: Page) {
  await page.addInitScript(() => {
    const writes: Array<{ kind: string; url: string }> = [];
    (window as unknown as { __historyWrites: typeof writes }).__historyWrites = writes;
    for (const kind of ["pushState", "replaceState"] as const) {
      const original = window.history[kind].bind(window.history);
      window.history[kind] = (data: unknown, unused: string, url?: string | URL | null) => {
        if (url != null) {
          const next = new URL(String(url), window.location.href);
          writes.push({ kind, url: next.pathname + next.search });
        }
        return original(data, unused, url);
      };
    }
  });
}

async function historyWritesSince(page: Page, start: number) {
  return page.evaluate(
    (from) => (window as unknown as { __historyWrites: Array<{ kind: string; url: string }> }).__historyWrites.slice(from),
    start
  );
}

async function historyWriteCount(page: Page) {
  return page.evaluate(() => (window as unknown as { __historyWrites: unknown[] }).__historyWrites.length);
}

async function expectQuery(page: Page, expected: string) {
  await expect.poll(() => new URL(page.url()).searchParams.toString()).toBe(expected);
}

async function expectPath(page: Page, expected: string) {
  await expect.poll(() => new URL(page.url()).pathname).toBe(expected);
}

function gradeButton(page: Page, name: string) {
  return page.getByRole("group", { name: "Grade", exact: true }).getByRole("button", { name, exact: true });
}

function streamButton(page: Page, name: string) {
  return page.getByRole("group", { name: "Stream", exact: true }).getByRole("button", { name, exact: true });
}

function switcher(page: Page) {
  return page.getByRole("heading", { level: 1 }).getByRole("button");
}

async function switchTo(page: Page, context: string) {
  await switcher(page).click();
  await page.getByRole("listbox", { name: "Centres" }).getByRole("option").filter({ hasText: context }).click();
}

async function pageAs(browser: Browser, user: { name: string; email: string }): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, user);
  return page;
}

test.describe("Centre switcher: tab carry and history", () => {
  test("from Performance, carries only the tab; Back restores A's report, Forward B's own state", async ({
    adminPage: page,
  }) => {
    await stubAnalytics(page);
    await recordHistoryWrites(page);
    const alpha = `/centre/${fixture.centres.alpha}`;
    const nodal = `/centre/${fixture.centres.alphaNodal}`;

    await page.goto(`${alpha}?tab=performance`);
    await expectQuery(page, "tab=performance&grade=12");
    await gradeButton(page, "11").click();
    await expectQuery(page, "tab=performance&grade=11");
    await streamButton(page, "PCM").click();
    await expectQuery(page, "tab=performance&grade=11&stream=pcm");
    await page.getByText("E2E Full Test", { exact: true }).click();
    await expectQuery(page, "tab=performance&grade=11&stream=pcm&session=e2e-full");
    await expect(page.getByRole("heading", { level: 2, name: "E2E Full Test", exact: true })).toBeVisible();

    const historyBefore = await page.evaluate(() => window.history.length);
    const writesBefore = await historyWriteCount(page);
    await switchTo(page, "JNV Nodal · JNV Surguja (19269)");

    await expectPath(page, nodal);
    await expect(page.getByRole("tab", { name: "Performance" })).toHaveAttribute("aria-selected", "true");
    // Centre B adds its own default Grade, by replace.
    await expectQuery(page, "tab=performance&grade=12");
    await expect(gradeButton(page, "12")).toHaveAttribute("aria-pressed", "true");
    await expect(streamButton(page, "All")).toHaveAttribute("aria-pressed", "true");
    const writes = await historyWritesSince(page, writesBefore);
    expect(writes[0]).toEqual({ kind: "pushState", url: `${nodal}?tab=performance` });
    expect(writes.filter((write) => write.kind === "pushState")).toHaveLength(1);
    for (const write of writes) {
      expect(write.url).not.toMatch(/grade=11|stream=|session=/);
    }
    expect(await page.evaluate(() => window.history.length)).toBe(historyBefore + 1);

    await page.goBack();
    await expectPath(page, alpha);
    await expectQuery(page, "tab=performance&grade=11&stream=pcm&session=e2e-full");
    await expect(page.getByRole("heading", { level: 2, name: "E2E Full Test", exact: true })).toBeVisible();

    await page.goForward();
    await expectPath(page, nodal);
    await expectQuery(page, "tab=performance&grade=12");
    await expect(page.getByRole("tab", { name: "Performance" })).toHaveAttribute("aria-selected", "true");
    await expect(gradeButton(page, "12")).toHaveAttribute("aria-pressed", "true");
  });

  test("a Program-less Centre keeps Performance selected and says it has no Program", async ({
    adminPage: page,
  }) => {
    await stubAnalytics(page);
    await page.goto(`/centre/${fixture.centres.alpha}?tab=performance`);
    await expectQuery(page, "tab=performance&grade=12");

    await switchTo(page, "No Program · JNV Durg (19006)");

    await expectPath(page, `/centre/${fixture.centres.charlie}`);
    await expectQuery(page, "tab=performance");
    await expect(page.getByRole("tab", { name: "Performance" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("No Program is assigned to this Centre.")).toBeVisible();
  });

  test("a hidden raw tab is never carried along a chain of switches", async ({ browser }) => {
    const page = await pageAs(browser, CENTRE_SWITCHER_USERS.schoolScoped);
    // Holistic Mentorship is a CoE (Program 1) surface: hidden on the Nodal Centre.
    await page.goto(`/centre/${fixture.centres.alphaNodal}?tab=holistic_mentorship`);
    await expect(page.getByRole("tab", { name: "Holistic Mentorship" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Enrollment" })).toHaveAttribute("aria-selected", "true");

    await switchTo(page, "No Program · JNV Durg (19006)");
    await expectPath(page, `/centre/${fixture.centres.charlie}`);
    await expectQuery(page, "");
    await expect(page.getByRole("tab", { name: "Enrollment" })).toHaveAttribute("aria-selected", "true");

    await switchTo(page, "JNV CoE · JNV Durg (19006)");
    await expectPath(page, `/centre/${fixture.centres.delta}`);
    await expectQuery(page, "");
    await expect(page.getByRole("tab", { name: "Enrollment" })).toHaveAttribute("aria-selected", "true");
    await page.context().close();
  });

  test("while a switch is pending, it shows progress and ignores another choice", async ({ adminPage: page }) => {
    await recordHistoryWrites(page);
    const alpha = `/centre/${fixture.centres.alpha}`;
    const nodal = `/centre/${fixture.centres.alphaNodal}`;
    const charlie = `/centre/${fixture.centres.charlie}`;
    // Hold Centre B's navigation (its RSC payload) so the switch stays pending.
    let releaseNodal!: () => void;
    const nodalHeld = new Promise<void>((resolve) => (releaseNodal = resolve));
    const rscRequests: string[] = [];
    await page.route(
      (url) => url.pathname === nodal || url.pathname === charlie,
      async (route) => {
        const request = route.request();
        if (request.headers()["rsc"]) {
          rscRequests.push(new URL(request.url()).pathname);
          if (new URL(request.url()).pathname === nodal) await nodalHeld;
        }
        await route.continue();
      }
    );

    await page.goto(alpha);
    await expect(page.getByRole("tab", { name: "Enrollment" })).toHaveAttribute("aria-selected", "true");
    const historyBefore = await page.evaluate(() => window.history.length);
    const writesBefore = await historyWriteCount(page);

    await switchTo(page, "JNV Nodal · JNV Surguja (19269)");
    await expect(page.getByRole("status").filter({ hasText: "Switching Centre…" })).toBeVisible();
    await switchTo(page, "No Program · JNV Durg (19006)");
    await expect(page.getByRole("status").filter({ hasText: "Switching Centre…" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(alpha);

    releaseNodal();
    await expectPath(page, nodal);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Switcher E2E Alpha");
    await expect(page.getByText("JNV Nodal | JNV Surguja", { exact: false })).toBeVisible();
    await expect(page.getByText("Switching Centre…")).toHaveCount(0);
    expect(rscRequests.filter((path) => path === charlie)).toHaveLength(0);
    const pushes = (await historyWritesSince(page, writesBefore)).filter((write) => write.kind === "pushState");
    expect(pushes).toEqual([{ kind: "pushState", url: nodal }]);
    expect(await page.evaluate(() => window.history.length)).toBe(historyBefore + 1);
  });

  test("a School removed from the user's scope after the list loaded leads to Access Denied", async ({
    browser,
  }) => {
    const pool = getTestPool();
    const page = await pageAs(browser, CENTRE_SWITCHER_USERS.schoolScoped);
    try {
      await page.goto(`/centre/${fixture.centres.alpha}`);
      await switcher(page).click();
      const delta = page.getByRole("option").filter({ hasText: "JNV CoE · JNV Durg (19006)" });
      await expect(delta).toBeVisible();

      await pool.query(`UPDATE user_permission SET school_codes = ARRAY['19269'] WHERE email = $1`, [
        CENTRE_SWITCHER_USERS.schoolScoped.email,
      ]);
      await delta.click();

      await expectPath(page, `/centre/${fixture.centres.delta}`);
      await expect(page.getByRole("heading", { name: "Access Denied" })).toBeVisible();
    } finally {
      await pool.query(`UPDATE user_permission SET school_codes = ARRAY['19269', '19006'] WHERE email = $1`, [
        CENTRE_SWITCHER_USERS.schoolScoped.email,
      ]);
      await pool.end();
      await page.context().close();
    }
  });
});
