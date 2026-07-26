import { expect, test } from "@playwright/test";

test("seeds the fixture replay workspace", { tag: ["@harness", "@shell"] }, async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Know the blast radius before you ship." }),
  ).toBeVisible();
  await expect(page.locator(".mode-badge")).toHaveText("Fixture replay");
  await expect(page.getByRole("button", { name: "Analyze change" })).toBeEnabled();
});
