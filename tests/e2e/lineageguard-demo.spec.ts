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
  const regeneration = page.waitForRequest((request) =>
    request.url().includes("/regenerate") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Regenerate" }).click();
  await regeneration;
  await expect(page.getByText("Critical risk", { exact: true })).toBeVisible();
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
