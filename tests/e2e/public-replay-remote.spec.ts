import {
  expect,
  test,
  type APIResponse,
  type Download,
  type Page,
  type Response,
} from "@playwright/test";
import { SafeRunIdSchema } from "../../src/runs/run-envelope.js";

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
const MAX_DOWNLOAD_BYTES = 524_288;

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

async function readDownloadedUtf8(download: Download): Promise<string> {
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of stream!) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_DOWNLOAD_BYTES) {
      stream!.destroy();
      throw new Error("The downloaded artifact exceeds its test boundary.");
    }
    chunks.push(bytes);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

async function expectDownloadResponse(response: APIResponse, filename: string): Promise<void> {
  expect(response.status()).toBe(200);
  const headers = response.headers();
  for (const [name, value] of Object.entries(REQUIRED_HEADERS)) {
    expect(headers[name]).toBe(value);
  }
  expect(headers["content-disposition"]).toBe(`attachment; filename="${filename}"`);
  expect(headers["content-type"]).toBe(
    filename.endsWith(".sql") ? "text/sql; charset=utf-8" : "text/markdown; charset=utf-8",
  );
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

async function expectGoldenResult(page: Page): Promise<void> {
  await expect(page.getByText("Critical risk", { exact: true })).toBeVisible();
  await expect(page.getByText("90", { exact: true })).toBeVisible();
  await expect(page.getByText("24 downstream", { exact: true })).toBeVisible();
  await expect(page.getByText("11 column-confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText("BLOCK DIRECT RENAME", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(4);
  await page.getByRole("tab", { name: "rollout-plan.md" }).click();
  await expect(page.getByRole("tabpanel")).toContainText(
    "**Classification:** NON_EXECUTABLE_TEMPLATE",
  );
  await expect(page.getByRole("tabpanel")).toContainText("**Decision:** BLOCK_DIRECT_RENAME");
}

test("proves the opt-in public Render deployment", async ({ baseURL, page }) => {
  if (baseURL === undefined) throw new Error("The public deployment URL is unavailable.");
  const expectedOrigin = new URL(baseURL).origin;
  const expectedHost = new URL(baseURL).host;
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
    (response) => response.url() === new URL(faviconHref!, expectedOrigin).href,
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

  await expect.poll(() => artifactResponses.length).toBe(4);
  for (const response of artifactResponses) {
    expect(response.status()).toBe(200);
    await expectRequiredHeaders(response);
  }

  const runId = SafeRunIdSchema.parse(
    await page.locator("[data-run-id]").getAttribute("data-run-id"),
  );
  for (const filename of ARTIFACTS) {
    await page.getByRole("tab", { name: filename }).click();
    const panel = page.locator('[role="tabpanel"]:not([hidden])');
    await expect(panel).not.toHaveText("Loading artifact…");
    const preview = await panel.textContent();
    expect(preview).not.toBeNull();
    const expectedPath = `/api/runs/${runId}/artifacts/${filename}`;
    const matchingResponse = await page.request.get(expectedPath);
    const matchingUrl = new URL(matchingResponse.url());
    expect(matchingUrl.origin).toBe(expectedOrigin);
    expect(matchingUrl.pathname).toBe(expectedPath);
    await expectDownloadResponse(matchingResponse, filename);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download" }).click();
    const download = await downloadPromise;
    const downloadUrl = new URL(download.url());
    expect(downloadUrl.origin).toBe(expectedOrigin);
    expect(downloadUrl.pathname).toBe(expectedPath);
    expect(download.suggestedFilename()).toBe(filename);
    const content = await readDownloadedUtf8(download);
    expect(content).toBe(preview);
    expect(content).not.toMatch(/[A-Za-z]:\\/u);
  }

  expect(safety.consoleErrors).toEqual([]);
  expect(safety.consoleWarnings).toEqual([]);
  expect(safety.pageErrors).toEqual([]);
  expect(safety.requests.length).toBeGreaterThan(0);
  for (const requestUrl of safety.requests) {
    const request = new URL(requestUrl);
    expect(request.host).toBe(expectedHost);
    expect(request.origin).toBe(expectedOrigin);
  }
});
