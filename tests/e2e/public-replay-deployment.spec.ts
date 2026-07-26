import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";
import {
  RunEnvelopeSchema,
  SafeRunIdSchema,
  type RunEnvelope,
} from "../../src/runs/run-envelope.js";

const LOCAL_ORIGIN = "http://127.0.0.1:3110";
const ARTIFACTS = [
  "migration-up.sql",
  "migration-down.sql",
  "validation.sql",
  "rollout-plan.md",
] as const;
const REQUIRED_HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;
type CompletedRunEnvelope = Extract<RunEnvelope, { readonly kind: "completed" }>;

function captureBrowserSafety(page: Page): {
  readonly consoleErrors: string[];
  readonly consoleWarnings: string[];
  readonly pageErrors: string[];
  readonly requests: string[];
} {
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const pageErrors: string[] = [];
  const requests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push("error");
    if (message.type() === "warning") consoleWarnings.push("warning");
  });
  page.on("pageerror", () => pageErrors.push("pageerror"));
  page.on("request", (request) => requests.push(request.url()));
  return { consoleErrors, consoleWarnings, pageErrors, requests };
}

async function expectRequiredHeaders(response: Response): Promise<void> {
  const headers = await response.allHeaders();
  for (const [name, value] of Object.entries(REQUIRED_HEADERS)) {
    expect(headers[name]).toBe(value);
  }
}

async function expectPublicShell(page: Page): Promise<void> {
  await expect(page.locator(".mode-badge")).toHaveText("Public fixture replay");
  const fields = [
    page.getByRole("textbox", { name: "DataHub dataset" }),
    page.getByRole("textbox", { name: "Current column" }),
    page.getByRole("textbox", { name: "New column" }),
  ];
  for (const field of fields) {
    await expect(field).toHaveAttribute("readonly", "");
    await expect(field).toHaveAttribute("aria-readonly", "true");
  }
}

async function readCompletedEnvelope(rawRunId: string | null): Promise<CompletedRunEnvelope> {
  const runsRoot = process.env.LINEAGEGUARD_PUBLIC_REPLAY_E2E_RUNS_DIR;
  if (runsRoot === undefined) throw new Error("The public replay test root is unavailable.");
  const runId = SafeRunIdSchema.parse(rawRunId);
  const envelope = RunEnvelopeSchema.parse(
    JSON.parse(await readFile(join(runsRoot, `run-${runId}.json`), "utf8")),
  );
  if (envelope.kind !== "completed") {
    throw new Error("The completed public replay envelope is missing.");
  }
  return envelope;
}

async function expectGoldenResult(page: Page): Promise<void> {
  await expect(page.getByText("Critical risk", { exact: true })).toBeVisible();
  await expect(page.getByText("90", { exact: true })).toBeVisible();
  await expect(page.getByText("24 downstream", { exact: true })).toBeVisible();
  await expect(page.getByText("11 column-confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText("BLOCK DIRECT RENAME", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(4);
  await expect(page.getByRole("tabpanel")).toContainText(/NON[-_]EXECUTABLE[-_ ]TEMPLATE/u);
}

test("proves the local public replay production deployment", async ({ page }) => {
  const safety = captureBrowserSafety(page);
  const artifactResponses: Response[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.includes("/artifacts/")) {
      artifactResponses.push(response);
    }
  });

  const pageResponse = await page.goto("/");
  expect(pageResponse).not.toBeNull();
  await expectRequiredHeaders(pageResponse!);
  await expectPublicShell(page);

  const healthResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/health",
  );
  const health = await page.evaluate(async () => {
    const response = await fetch("/api/health", { cache: "no-store" });
    return { status: response.status, body: (await response.json()) as unknown };
  });
  const healthResponse = await healthResponsePromise;
  expect(health).toEqual({
    status: 200,
    body: { status: "ok", mode: "PUBLIC_REPLAY" },
  });
  expect((await healthResponse.allHeaders())["content-type"]).toContain("application/json");
  await expectRequiredHeaders(healthResponse);

  const favicon = page.locator('link[rel="icon"]');
  await expect(favicon).toHaveCount(1);
  const faviconHref = await favicon.getAttribute("href");
  expect(faviconHref).not.toBeNull();
  const faviconResponsePromise = page.waitForResponse(
    (response) => response.url() === new URL(faviconHref!, LOCAL_ORIGIN).href,
  );
  const faviconResult = await page.evaluate(async (href) => {
    const response = await fetch(href, { cache: "no-store" });
    return { status: response.status, contentType: response.headers.get("content-type") };
  }, faviconHref!);
  const faviconResponse = await faviconResponsePromise;
  expect(faviconResult.status).toBe(200);
  expect(faviconResult.contentType).toContain("image/svg+xml");
  expect(faviconResponse.status()).toBe(200);

  const runResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/runs" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Analyze change" }).click();
  const runResponse = await runResponsePromise;
  await expectGoldenResult(page);
  await expectRequiredHeaders(runResponse);
  const runEnvelope = await readCompletedEnvelope(
    await page.locator("[data-run-id]").getAttribute("data-run-id"),
  );
  const runSnapshot = runEnvelope.snapshot;
  expect(runSnapshot.impact).toMatchObject({
    downstreamAssets: 24,
    columnAffectedAssets: 11,
    score: 90,
    advisoryDecision: "BLOCK_DIRECT_RENAME",
  });
  expect(runSnapshot.executionClassification).toBe("NON_EXECUTABLE_TEMPLATE");
  expect(runSnapshot.artifacts).toHaveLength(4);

  await expect.poll(() => artifactResponses.length).toBe(4);
  for (const response of artifactResponses) {
    expect(response.status()).toBe(200);
    await expectRequiredHeaders(response);
  }

  const downloaded: string[] = [];
  for (const filename of ARTIFACTS) {
    await page.getByRole("tab", { name: filename }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download" }).click();
    downloaded.push((await downloadPromise).suggestedFilename());
  }
  expect(downloaded).toEqual([...ARTIFACTS]);

  const regenerationResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/regenerate") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Regenerate" }).click();
  const regenerationResponse = await regenerationResponsePromise;
  await expectGoldenResult(page);
  await expectRequiredHeaders(regenerationResponse);
  const regenerationEnvelope = await readCompletedEnvelope(
    await page.locator("[data-run-id]").getAttribute("data-run-id"),
  );
  expect(regenerationEnvelope.parentRunId).toBe(runSnapshot.runId);

  expect(safety.consoleErrors).toEqual([]);
  expect(safety.consoleWarnings).toEqual([]);
  expect(safety.pageErrors).toEqual([]);
  expect(safety.requests.length).toBeGreaterThan(0);
  for (const requestUrl of safety.requests) {
    expect(new URL(requestUrl).origin).toBe(LOCAL_ORIGIN);
  }
});

test("shows truthful recovery copy when an artifact expires", async ({ page }) => {
  const runsRoot = process.env.LINEAGEGUARD_PUBLIC_REPLAY_E2E_RUNS_DIR;
  if (runsRoot === undefined) throw new Error("The public replay test root is unavailable.");

  let releaseArtifacts: (() => void) | undefined;
  const artifactBarrier = new Promise<void>((resolveBarrier) => {
    releaseArtifacts = resolveBarrier;
  });
  await page.route("**/api/runs/*/artifacts/*", async (route) => {
    await artifactBarrier;
    await route.continue();
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Analyze change" }).click();
  await expect(page.locator("[data-run-id]")).toBeVisible();
  const rawRunId = await page.locator("[data-run-id]").getAttribute("data-run-id");
  const runId = SafeRunIdSchema.parse(rawRunId);
  await unlink(join(runsRoot, `run-${runId}.json`));
  releaseArtifacts?.();

  await expect(page.getByRole("status")).toHaveText("Run expired; analyze again.");
});
