import { expect } from "@playwright/test";
import { test } from "./fixtures.js";

test("visually explores the completed replay workspace", async ({ aiAssert, page }) => {
  await page.goto("/");
  await expect(page.locator(".mode-badge")).toHaveText("Fixture replay");

  await page.getByRole("button", { name: "Analyze change" }).click();

  await expect(page.getByText("BLOCK DIRECT RENAME", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence completeness" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Context coverage" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "migration-up.sql" })).toBeVisible();

  await aiAssert(
    "The risk decision, evidence completeness, context coverage, runtime proof, and artifact workspace are visually readable, clearly separated, and free of overlapping or clipped text.",
  );
});
