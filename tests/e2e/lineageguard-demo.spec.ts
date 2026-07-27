import { expect, test, type Page } from "@playwright/test";
import {
  failedSnapshot,
  incompleteEvidenceSnapshot,
  ndjson,
  sanitizedFailedSnapshot,
} from "./fixtures/workflow-responses.js";

const START_NEW_ANALYSIS_GUIDANCE =
  "No preserved analysis is available. Start a new analysis to continue.";

async function expectStableArtifactRelationships(page: Page): Promise<void> {
  const relationships = await page.getByRole("tab").evaluateAll((tabs) =>
    tabs.map((tab) => {
      const controls = tab.getAttribute("aria-controls");
      const panel = controls === null ? null : document.getElementById(controls);
      return {
        controls,
        panelRole: panel?.getAttribute("role"),
        labelledBy: panel?.getAttribute("aria-labelledby"),
        tabId: tab.id,
      };
    }),
  );
  expect(relationships).toHaveLength(4);
  expect(new Set(relationships.map(({ controls }) => controls)).size).toBe(4);
  for (const relationship of relationships) {
    expect(relationship.controls).not.toBeNull();
    expect(relationship.panelRole).toBe("tabpanel");
    expect(relationship.labelledBy).toBe(relationship.tabId);
  }
}

test.beforeEach(async ({ request }) => {
  const response = await request.fetch("/api/runs", { method: "OPTIONS" });
  expect(response.status()).toBe(204);
});

test("serves the repository-owned browser icon", { tag: "@shell" }, async ({ page, request }) => {
  await page.goto("/");

  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveCount(1);
  const href = await icon.getAttribute("href");
  expect(href).not.toBeNull();
  expect(href).toBe("/icon.svg");

  const response = await request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
});

test(
  "completes the golden grounded replay flow",
  { tag: ["@golden-flow", "@runtime-proof"] },
  async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Know the blast radius before you ship." }),
    ).toBeVisible();
    await expect(page.locator(".mode-badge")).toHaveText("Fixture replay");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.getByText("Critical risk", { exact: true })).toBeVisible();
    await expect(page.getByText("90", { exact: true })).toBeVisible();
    await expect(page.getByText("24 downstream", { exact: true })).toBeVisible();
    await expect(page.getByText("11 column-confirmed", { exact: true })).toBeVisible();
    await expect(page.getByText("BLOCK DIRECT RENAME", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evidence completeness" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Context coverage" })).toBeVisible();
    await expect(page.getByText("Evidence complete", { exact: true })).toBeVisible();
    await expect(page.getByText(/assets inspected/u)).toBeVisible();
    await expect(page.getByText(/Quality indicators:/u)).toBeVisible();
    await expect(
      page.getByText("Usage indicators not collected in the four-tool read-only slice."),
    ).toBeVisible();
    const runtimeProof = page.getByRole("region", { name: "Runtime proof" });
    await expect(runtimeProof).toBeVisible();
    await expect(runtimeProof.getByText("Fixture replay", { exact: true })).toBeVisible();
    await expect(runtimeProof.getByText("mcp-server-datahub@0.6.0", { exact: true })).toBeVisible();
    await expect(runtimeProof.getByText("analyze_rename_change", { exact: true })).toBeVisible();
    await expect(
      runtimeProof.getByText("generate_migration_package", { exact: true }),
    ).toBeVisible();
    await expect(
      runtimeProof.getByText("Replay has no mutation capability.", { exact: true }),
    ).toBeVisible();
    await expect(runtimeProof.getByText("save_document", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Evidence ID: datahub:source-column:customer_id")).toBeVisible();
    await expect(page.getByText("Field: customer_id")).toBeVisible();
    await expect(page.getByRole("tab", { name: "migration-up.sql" })).toBeVisible();
    await expect(page.getByRole("tabpanel")).toContainText("NON-EXECUTABLE TEMPLATE");
    const goldenPanel = await page
      .getByRole("tabpanel")
      .evaluate((panel) => ({ clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth }));
    expect(goldenPanel.scrollWidth).toBeLessThanOrEqual(goldenPanel.clientWidth);
  },
);

test(
  "asks the user to choose an ambiguous dataset",
  { tag: "@workflow-terminal" },
  async ({ page }) => {
    await page.route("**/api/runs", (route) =>
      route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson({
          ...failedSnapshot("NEEDS_USER_CLARIFICATION", "Several datasets match exactly."),
          failure: {
            code: "NEEDS_USER_CLARIFICATION",
            message: "Several datasets match exactly.",
            candidates: ["urn:li:dataset:(one)", "urn:li:dataset:(two)"],
          },
        }),
      }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.locator(".error-panel")).toContainText("NEEDS USER CLARIFICATION");
    await page.getByRole("button", { name: /Use urn:li:dataset:\(one\)/ }).click();
    await expect(page.getByLabel("DataHub dataset")).toHaveValue("urn:li:dataset:(one)");
  },
);

for (const [status, text, recovery] of [
  [
    "DATAHUB_UNAVAILABLE",
    "DataHub is unavailable",
    "Verify the local DataHub service and GMS endpoint before starting a new analysis.",
  ],
  ["GENERATION_FAILED", "OpenAI generation failed", START_NEW_ANALYSIS_GUIDANCE],
  ["VALIDATION_FAILED", "Artifact validation failed", START_NEW_ANALYSIS_GUIDANCE],
] as const) {
  test(`shows actionable ${status}`, { tag: "@workflow-terminal" }, async ({ page }) => {
    await page.route("**/api/runs", (route) =>
      route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson(failedSnapshot(status, text)),
      }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.locator(".error-panel")).toContainText(text);
    await expect(page.locator(".error-panel")).toContainText(recovery);
    await expect(page.getByRole("tab")).toHaveCount(0);
  });
}

test(
  "publishes only bounded redacted workflow output to the browser",
  { tag: "@workflow-terminal" },
  async ({ page }) => {
    const rawSecret = ["sentinel", "route", "secret"].join("-");
    const unsafeMessage = `Validation rejected ${rawSecret} ${"x".repeat(700)}`;
    let publishedBody = "";
    await page.route("**/api/runs", (route) => {
      publishedBody = ndjson(
        sanitizedFailedSnapshot("VALIDATION_FAILED", unsafeMessage, [rawSecret]),
      );
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: publishedBody,
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.locator(".error-panel > p").first()).toContainText("[REDACTED]");
    const renderedFailure = await page.locator(".error-panel > p").first().innerText();
    expect(renderedFailure.length).toBeLessThanOrEqual(500);
    expect(publishedBody).toContain("[REDACTED]");
    expect(publishedBody).not.toContain(rawSecret);
    expect(await page.locator("body").innerText()).not.toContain(rawSecret);
    expect(await page.content()).not.toContain(rawSecret);
  },
);

test(
  "shows incomplete evidence as lower bounds with advisory-only output",
  { tag: "@workflow-terminal" },
  async ({ page }) => {
    await page.route("**/api/runs", (route) =>
      route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson(incompleteEvidenceSnapshot()),
      }),
    );
    await page.route("**/api/runs/fixture-incomplete-evidence/artifacts/*", (route) => {
      const contentType = route.request().url().endsWith(".sql")
        ? "text/sql; charset=utf-8"
        : "text/markdown; charset=utf-8";
      return route.fulfill({
        contentType,
        body: "-- ADVISORY ONLY — HUMAN APPROVAL REQUIRED\n-- Incomplete lineage evidence.\n",
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.getByText("Incomplete evidence", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Collected counts are lower bounds.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("ITEM LIMIT REACHED", { exact: true })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(4);
    await expect(
      page.getByRole("tabpanel").getByText(/ADVISORY ONLY — HUMAN APPROVAL REQUIRED/u),
    ).toBeVisible();
    await expect(page.getByText("EXECUTABLE WITH REVIEW", { exact: true })).toHaveCount(0);
  },
);

test(
  "cancels a pending request without leaving the form disabled",
  { tag: "@workflow-terminal" },
  async ({ page }) => {
    await page.route("**/api/runs", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Analyze change" })).toBeEnabled();
  },
);

test(
  "cancels a pending run without showing completion",
  { tag: "@workflow-terminal" },
  async ({ page }) => {
    await page.route("**/api/runs", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      if (!route.request().isNavigationRequest()) await route.abort();
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Critical risk", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(0);
  },
);

test(
  "regenerates the completed package through its bounded route",
  { tag: "@workflow-terminal" },
  async ({ page }) => {
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
    await expect(page.getByRole("tab", { name: "migration-up.sql" })).toBeVisible({
      timeout: 15_000,
    });
    await expect
      .poll(() => page.locator(".artifact-panel").getAttribute("data-run-id"), { timeout: 5_000 })
      .not.toBe(previousRunId);
    await expect(page.getByRole("button", { name: "Regenerate" })).toBeDisabled();
  },
);

test(
  "regenerates through the child endpoint only",
  { tag: "@workflow-terminal" },
  async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.getByRole("tab", { name: "migration-up.sql" })).toBeVisible();
    const requests: Array<{ readonly url: string; readonly body: string | null }> = [];
    await page.route("**/api/runs/*/regenerate", async (route) => {
      requests.push({ url: route.request().url(), body: route.request().postData() });
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson(failedSnapshot("GENERATION_FAILED", "Regeneration test stopped.")),
      });
    });
    await page.getByRole("button", { name: "Regenerate" }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(new URL(requests[0]!.url).pathname).toMatch(/^\/api\/runs\/[^/]+\/regenerate$/u);
    expect(requests[0]!.body).toBeNull();
  },
);

test(
  "retries a preserved generation failure without a new analysis request",
  { tag: "@workflow-terminal" },
  async ({ page }) => {
    let rootRequests = 0;
    let childRequests = 0;
    await page.route("**/api/runs", (route) => {
      rootRequests += 1;
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson({
          ...failedSnapshot("GENERATION_FAILED", "OpenAI generation failed."),
          runId: "retry-parent",
          contextHash: "a".repeat(64),
          impact: {
            score: 90,
            level: "critical",
            confidence: "high",
            advisoryDecision: "BLOCK_DIRECT_RENAME",
            downstreamAssets: 24,
            columnAffectedAssets: 11,
            evidenceLevel: "column",
            factors: [],
          },
        }),
      });
    });
    await page.route("**/api/runs/retry-parent/regenerate", (route) => {
      childRequests += 1;
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson(failedSnapshot("GENERATION_FAILED", "Retry stopped safely.")),
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.getByText("Critical risk", { exact: true })).toBeVisible();
    await expect(page.locator(".error-panel")).toContainText(
      "Retry generation from the preserved analysis without another DataHub read.",
    );
    await page.getByRole("button", { name: "Retry generation" }).click();
    await expect.poll(() => childRequests).toBe(1);
    expect(rootRequests).toBe(1);
  },
);

test(
  "starts only one retry for a same-render double activation",
  { tag: "@workflow-terminal" },
  async ({ page }) => {
    let childRequests = 0;
    await page.route("**/api/runs", (route) =>
      route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson({
          ...failedSnapshot("GENERATION_FAILED", "OpenAI generation failed."),
          runId: "retry-double-parent",
          contextHash: "c".repeat(64),
        }),
      }),
    );
    await page.route("**/api/runs/retry-double-parent/regenerate", async (route) => {
      childRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson({
          ...failedSnapshot("GENERATION_FAILED", "Retry stopped safely."),
          runId: "retry-double-child",
          parentRunId: "retry-double-parent",
        }),
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent === "Retry generation",
      );
      if (button === undefined) throw new Error("Retry generation control is unavailable.");
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect.poll(() => childRequests).toBe(1);
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  },
);

test(
  "treats a rejected child generation as terminal",
  { tag: "@workflow-terminal" },
  async ({ page }) => {
    await page.route("**/api/runs", (route) =>
      route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson({
          ...failedSnapshot("GENERATION_FAILED", "OpenAI generation failed."),
          runId: "retry-terminal-parent",
          contextHash: "d".repeat(64),
        }),
      }),
    );
    await page.route("**/api/runs/retry-terminal-parent/regenerate", (route) =>
      route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson({
          ...failedSnapshot("GENERATION_FAILED", "Retry stopped safely."),
          runId: "retry-terminal-child",
          contextHash: "d".repeat(64),
          parentRunId: "retry-terminal-parent",
        }),
      }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await page.getByRole("button", { name: "Retry generation" }).click();
    await expect(page.locator(".error-panel")).toContainText(
      "This workflow lineage has used its one generation retry. Start a new analysis to continue.",
    );
    await expect(page.getByRole("button", { name: "Retry generation" })).toHaveCount(0);
  },
);

test(
  "shows bounded validation findings without artifact tabs",
  { tag: "@workflow-terminal" },
  async ({ page }) => {
    await page.route("**/api/runs", (route) =>
      route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson({
          ...failedSnapshot("VALIDATION_FAILED", "Artifact validation failed."),
          contextHash: "b".repeat(64),
          artifacts: [
            { filename: "migration-up.sql", sha256: "a".repeat(64), validated: false },
            { filename: "migration-down.sql", sha256: "b".repeat(64), validated: false },
            { filename: "validation.sql", sha256: "c".repeat(64), validated: false },
            { filename: "rollout-plan.md", sha256: "d".repeat(64), validated: false },
          ],
        }),
      }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.getByText("2 validation findings (unvalidated draft).")).toBeVisible();
    await expect(page.getByText("PROHIBITED SQL", { exact: true })).toBeVisible();
    await expect(page.locator(".error-panel")).toContainText(
      "Review the bounded validation findings before retrying generation from the preserved analysis.",
    );
    await expect(page.getByRole("button", { name: "Retry generation" })).toBeEnabled();
    await expect(page.getByRole("tab")).toHaveCount(0);
  },
);

test(
  "starts only one regeneration for a same-render double activation",
  { tag: "@workflow-terminal" },
  async ({ page }) => {
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
  },
);

test(
  "uses keyboard tabs to change the visible artifact",
  { tag: "@artifact-safety" },
  async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    const first = page.getByRole("tab", { name: "migration-up.sql" });
    const second = page.getByRole("tab", { name: "migration-down.sql" });
    await expect(first).toBeVisible();
    await expectStableArtifactRelationships(page);
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
    await expectStableArtifactRelationships(page);
  },
);

test(
  "rejects a wrong artifact content type without a page error",
  { tag: "@artifact-safety" },
  async ({ page }) => {
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    await page.route("**/artifacts/migration-up.sql", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"error":"nope"}',
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.getByRole("status")).toHaveText("Artifact preview is unavailable.");
    await expect(page.getByRole("button", { name: "Copy" })).toBeDisabled();
    expect(errors).toEqual([]);
  },
);

for (const [name, status, contentType] of [
  ["non-success response", 503, "text/sql; charset=utf-8"],
  ["wrong content type", 200, "application/json"],
] as const) {
  test(
    `cancels ${name} bodies and pending sibling artifact loads`,
    { tag: "@artifact-safety" },
    async ({ page }) => {
      await page.addInitScript(
        ({ rejectedStatus, rejectedContentType }) => {
          const nativeFetch = window.fetch.bind(window);
          const counters = { rejectedBody: 0, siblingAborts: 0 };
          Object.defineProperty(window, "__artifactCancellationCounters", {
            configurable: true,
            value: counters,
          });
          window.fetch = async (input, init) => {
            const url =
              typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (!url.includes("/artifacts/")) return await nativeFetch(input, init);
            if (url.endsWith("/migration-up.sql")) {
              return new Response(
                new ReadableStream<Uint8Array>({
                  pull() {
                    // Keep the rejected response body pending until the client cancels it.
                  },
                  cancel() {
                    counters.rejectedBody += 1;
                  },
                }),
                {
                  status: rejectedStatus,
                  headers: { "content-type": rejectedContentType },
                },
              );
            }
            return await new Promise<Response>((_resolve, reject) => {
              const abort = () => {
                counters.siblingAborts += 1;
                reject(new DOMException("Artifact load aborted.", "AbortError"));
              };
              if (init?.signal?.aborted === true) abort();
              else init?.signal?.addEventListener("abort", abort, { once: true });
            });
          };
        },
        { rejectedStatus: status, rejectedContentType: contentType },
      );

      await page.goto("/");
      await page.getByRole("button", { name: "Analyze change" }).click();
      await expect(page.getByRole("status")).toHaveText("Artifact preview is unavailable.");
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  __artifactCancellationCounters: {
                    readonly rejectedBody: number;
                    readonly siblingAborts: number;
                  };
                }
              ).__artifactCancellationCounters,
          ),
        )
        .toEqual({ rejectedBody: 1, siblingAborts: 3 });
    },
  );
}

test(
  "rejects a missing artifact response without a page error",
  { tag: "@artifact-safety" },
  async ({ page }) => {
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
  },
);

test(
  "aborts stale never-ending artifact loads when the snapshot is replaced",
  { tag: "@artifact-safety" },
  async ({ page }) => {
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      let aborted = 0;
      Object.defineProperty(window, "__staleArtifactAbortCount", {
        configurable: true,
        get: () => aborted,
      });
      window.fetch = async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes("/artifacts/")) return await nativeFetch(input, init);
        return await new Promise<Response>((_resolve, reject) => {
          const abort = () => {
            aborted += 1;
            reject(new DOMException("Stale artifact load aborted.", "AbortError"));
          };
          if (init?.signal?.aborted === true) abort();
          else init?.signal?.addEventListener("abort", abort, { once: true });
        });
      };
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.getByRole("tab", { name: "migration-up.sql" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyze change" })).toBeEnabled();
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                readonly __staleArtifactAbortCount: number;
              }
            ).__staleArtifactAbortCount,
        ),
      )
      .toBeGreaterThanOrEqual(4);
  },
);

test(
  "reports a fixed artifact network failure without a page error",
  { tag: "@artifact-safety" },
  async ({ page }) => {
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
  },
);

test(
  "artifact reader accepts exactly 524,288 raw bytes",
  { tag: "@artifact-safety" },
  async ({ page }) => {
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    await page.route("**/artifacts/migration-up.sql", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/sql; charset=utf-8" },
        body: Buffer.alloc(524_288, 0x61),
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.getByRole("button", { name: "Copy" })).toBeEnabled();
    await expect
      .poll(() =>
        page
          .getByRole("tabpanel")
          .locator("code")
          .evaluate((node) => new TextEncoder().encode(node.textContent ?? "").byteLength),
      )
      .toBe(524_288);
    await expect(page.getByRole("status")).toHaveText("");
    expect(errors).toEqual([]);
  },
);

test(
  "artifact reader rejects 524,289 raw bytes without committing content",
  { tag: "@artifact-safety" },
  async ({ page }) => {
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    await page.route("**/artifacts/migration-up.sql", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/sql; charset=utf-8" },
        body: Buffer.alloc(524_289, 0x61),
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.getByRole("status")).toHaveText("Artifact preview is unavailable.");
    await expect(page.getByRole("button", { name: "Copy" })).toBeDisabled();
    await expect(page.getByRole("tabpanel")).toHaveText("Loading artifact…");
    expect(errors).toEqual([]);
  },
);

test(
  "artifact reader rejects invalid UTF-8 without committing content",
  { tag: "@artifact-safety" },
  async ({ page }) => {
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    await page.route("**/artifacts/migration-up.sql", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/sql; charset=utf-8" },
        body: Buffer.from([0xc3, 0x28]),
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.getByRole("status")).toHaveText("Artifact preview is unavailable.");
    await expect(page.getByRole("button", { name: "Copy" })).toBeDisabled();
    await expect(page.getByRole("tabpanel")).toHaveText("Loading artifact…");
    expect(errors).toEqual([]);
  },
);

test(
  "failed workflow request announces a fixed status without committing artifacts",
  { tag: "@workflow-terminal" },
  async ({ page }) => {
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    await page.route("**/api/runs", async (route) => {
      await route.abort("failed");
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.locator(".error-panel")).toContainText(
      "The workflow stream ended unexpectedly.",
    );
    await expect(page.locator(".error-panel")).toContainText(START_NEW_ANALYSIS_GUIDANCE);
    await expect(page.locator(".error-panel")).not.toContainText(
      "Retry generation from the preserved analysis",
    );
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(0);
    await expect(page.getByText("Validated artifacts will appear here.")).toBeVisible();
    expect(errors).toEqual([]);
  },
);

test(
  "invalid NDJSON announces a fixed status without committing artifacts",
  { tag: "@workflow-terminal" },
  async ({ page }) => {
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    await page.route("**/api/runs", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
        body: '{"type":"activity","entry":{"native":"detail"}}\n',
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.locator(".error-panel")).toContainText(
      "The workflow stream ended unexpectedly.",
    );
    await expect(page.locator(".error-panel")).toContainText(START_NEW_ANALYSIS_GUIDANCE);
    await expect(page.locator(".error-panel")).not.toContainText(
      "Retry generation from the preserved analysis",
    );
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(0);
    await expect(page.getByText("Validated artifacts will appear here.")).toBeVisible();
    expect(errors).toEqual([]);
  },
);

test(
  "reports a rejected clipboard write without a page error",
  { tag: "@artifact-safety" },
  async ({ page }) => {
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
  },
);

test(
  "reports an unavailable clipboard API without a page error",
  { tag: "@artifact-safety" },
  async ({ page }) => {
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
  },
);

test(
  "copies the active validated artifact",
  { tag: "@artifact-safety" },
  async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.getByRole("tab", { name: "migration-up.sql" })).toBeVisible();
    await page.getByRole("button", { name: "Copy" }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("NON-EXECUTABLE TEMPLATE");
  },
);

for (const filename of [
  "migration-up.sql",
  "migration-down.sql",
  "validation.sql",
  "rollout-plan.md",
] as const) {
  test(`downloads ${filename}`, { tag: "@artifact-safety" }, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await page.getByRole("tab", { name: filename }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download" }).click();
    await expect((await download).suggestedFilename()).toBe(filename);
  });
}

test(
  "keeps the request controls usable on a phone viewport",
  { tag: "@responsive" },
  async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "DataHub dataset" }).focus();
    await expect(page.getByRole("textbox", { name: "DataHub dataset" })).toBeFocused();
    const form = page.locator(".change-form");
    const box = await form.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(300);
  },
);

test(
  "keeps the golden decision usable on a phone viewport",
  { tag: "@responsive" },
  async ({ page }) => {
    const viewport = { width: 390, height: 844 };
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    const decision = page.getByText("BLOCK DIRECT RENAME", { exact: true });
    const workspace = page.locator(".artifact-panel");
    const rollout = page.getByRole("tab", { name: "rollout-plan.md" });
    await expect(decision).toBeVisible();
    await expect(workspace).toBeVisible();
    expect(
      await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    ).toEqual({ clientWidth: viewport.width, scrollWidth: viewport.width });
    for (const locator of [decision, workspace]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    }
    await rollout.click();
    await expect(rollout).toHaveAttribute("aria-selected", "true");
    const rolloutBox = await rollout.boundingBox();
    expect(rolloutBox).not.toBeNull();
    expect(rolloutBox!.x).toBeGreaterThanOrEqual(0);
    expect(rolloutBox!.x + rolloutBox!.width).toBeLessThanOrEqual(viewport.width);
    await rollout.press("Home");
    const firstTab = page.getByRole("tab", { name: "migration-down.sql" });
    await expect(firstTab).toBeFocused();
    await firstTab.press("End");
    const lastTab = page.getByRole("tab", { name: "validation.sql" });
    await expect(lastTab).toBeFocused();
    for (const locator of [lastTab, page.getByRole("link", { name: "Download" })]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    }
  },
);

test(
  "wraps a long unbroken artifact without horizontal preview overflow",
  { tag: "@responsive" },
  async ({ page }) => {
    await page.route("**/artifacts/migration-up.sql", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/sql; charset=utf-8" },
        body: "x".repeat(10_000),
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Analyze change" }).click();
    await expect(page.getByRole("button", { name: "Copy" })).toBeEnabled();
    const preview = await page
      .getByRole("tabpanel")
      .evaluate((panel) => ({ clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth }));
    expect(preview.scrollWidth).toBeLessThanOrEqual(preview.clientWidth);
  },
);
