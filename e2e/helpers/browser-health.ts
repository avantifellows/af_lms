import { expect, type Page } from "@playwright/test";

type BrowserHealth = {
  consoleErrors: string[];
  pageErrors: string[];
  networkErrors: string[];
};

// Console errors, uncaught errors, and failed or 5xx Holistic Mentorship API
// requests. Aborted requests (navigation, superseded fetches) are not failures.
export function collectBrowserHealth(page: Page): BrowserHealth {
  const health: BrowserHealth = { consoleErrors: [], pageErrors: [], networkErrors: [] };
  page.on("console", (message) => {
    if (message.type() === "error") health.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => health.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (!request.url().includes("/api/holistic-mentorship/")) return;
    const failure = request.failure()?.errorText ?? "request failed";
    if (failure.includes("ERR_ABORTED")) return;
    health.networkErrors.push(`${request.method()} ${request.url()} - ${failure}`);
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/holistic-mentorship/") && response.status() >= 500) {
      health.networkErrors.push(`${response.request().method()} ${response.url()} - HTTP ${response.status()}`);
    }
  });
  return health;
}

export function expectBrowserHealth(health: BrowserHealth) {
  expect(health.consoleErrors, "browser console errors").toEqual([]);
  expect(health.pageErrors, "uncaught browser errors").toEqual([]);
  expect(health.networkErrors, "Holistic Mentorship network errors").toEqual([]);
}
