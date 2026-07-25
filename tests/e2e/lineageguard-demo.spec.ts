import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  const response = await request.fetch("/api/runs", { method: "OPTIONS" });
  expect(response.status()).toBe(204);
});

test("completes the golden grounded replay flow", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Know the blast radius before you ship." }),
  ).toBeVisible();
  await expect(page.getByText("Fixture replay", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Analyze change" }).click();
  await expect(page.getByText("Critical risk", { exact: true })).toBeVisible();
  await expect(page.getByText("90", { exact: true })).toBeVisible();
  await expect(page.getByText("24 downstream", { exact: true })).toBeVisible();
  await expect(page.getByText("11 column-confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText("BLOCK DIRECT RENAME", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "migration-up.sql" })).toBeVisible();
  await expect(page.getByText("NON-EXECUTABLE TEMPLATE")).toBeVisible();
});

test("cancels a pending request without leaving the form disabled", async ({ page }) => {
  await page.route("**/api/runs", async () => {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze change" }).click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Analyze change" })).toBeEnabled();
});

test("regenerates the completed package through its bounded route", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze change" }).click();
  await expect(page.getByRole("tab", { name: "migration-up.sql" })).toBeVisible();
  const previousRunId = await page.locator(".artifact-panel").getAttribute("data-run-id");
  const regeneration = page.waitForRequest(
    (request) => request.url().includes("/regenerate") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Regenerate" }).click();
  await expect(page.getByRole("tab", { name: "migration-up.sql" })).toBeHidden();
  await regeneration;
  await expect(page.getByRole("tab", { name: "migration-up.sql" })).toBeVisible({ timeout: 5_000 });
  await expect
    .poll(() => page.locator(".artifact-panel").getAttribute("data-run-id"), { timeout: 5_000 })
    .not.toBe(previousRunId);
  await expect(page.getByRole("button", { name: "Regenerate" })).toBeEnabled();
});

test("starts only one regeneration for a same-render double activation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze change" }).click();
  await expect(page.getByRole("tab", { name: "migration-up.sql" })).toBeVisible();
  let regenerationRequests = 0;
  await page.route("**/regenerate", async (route) => {
    regenerationRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });

  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Regenerate",
    );
    if (button === undefined) throw new Error("Regenerate control is unavailable.");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  await expect.poll(() => regenerationRequests).toBe(1);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
});

test("uses keyboard tabs to change the visible artifact", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze change" }).click();
  const first = page.getByRole("tab", { name: "migration-up.sql" });
  const second = page.getByRole("tab", { name: "migration-down.sql" });
  await first.focus();
  await expect(first).toBeFocused();
  await first.press("ArrowLeft");
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText(
    "Keep customer_id available during rollback.",
  );
  const last = page.getByRole("tab", { name: "validation.sql" });
  await second.press("End");
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute("aria-selected", "true");
});

test("rejects a wrong artifact content type without a page error", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.route("**/artifacts/migration-up.sql", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"error":"nope"}' });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze change" }).click();
  await expect(page.getByRole("status")).toHaveText("Artifact preview is unavailable.");
  await expect(page.getByRole("button", { name: "Copy" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("rejects a missing artifact response without a page error", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.route("**/artifacts/migration-up.sql", async (route) => {
    await route.fulfill({ status: 404, contentType: "text/sql", body: "native route detail" });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze change" }).click();
  await expect(page.getByRole("status")).toHaveText("Artifact preview is unavailable.");
  await expect(page.getByRole("button", { name: "Copy" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("reports a fixed artifact network failure without a page error", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.route("**/artifacts/migration-up.sql", async (route) => {
    await route.abort("failed");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze change" }).click();
  await expect(page.getByRole("status")).toHaveText("Artifact preview is unavailable.");
  await expect(page.getByRole("button", { name: "Copy" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("reports a rejected clipboard write without a page error", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("native clipboard detail")) },
    });
  });
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze change" }).click();
  const copy = page.getByRole("button", { name: "Copy" });
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(page.getByRole("status")).toHaveText("Artifact copy is unavailable.");
  expect(errors).toEqual([]);
});

test("reports an unavailable clipboard API without a page error", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.goto("/");
  await page.getByRole("button", { name: "Analyze change" }).click();
  const copy = page.getByRole("button", { name: "Copy" });
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(page.getByRole("status")).toHaveText("Artifact copy is unavailable.");
  expect(errors).toEqual([]);
});

test("keeps the request controls usable on a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await page.getByRole("textbox", { name: "DataHub dataset" }).focus();
  await expect(page.getByRole("textbox", { name: "DataHub dataset" })).toBeFocused();
  const form = page.locator(".change-form");
  const box = await form.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(300);
});
