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
const MAX_BROWSER_OBSERVATIONS = 256;
type RequestAudit = {
  readonly sameOrigin: boolean;
  readonly hasUrlCredentials: boolean;
  readonly hasSecretQueryParameterName: boolean;
  readonly hasCredentialHeaderName: boolean;
};

type BrowserSafety = {
  consoleErrorCount: number;
  consoleWarningCount: number;
  pageErrorCount: number;
  requestCount: number;
  observationLimitExceeded: boolean;
  allRequestsSameOrigin: boolean;
  hasUrlCredentials: boolean;
  hasSecretQueryParameterName: boolean;
  hasCredentialHeaderName: boolean;
};

function normalizeCredentialName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");
}

function isSecretQueryParameterName(value: string): boolean {
  const normalized = normalizeCredentialName(value);
  return (
    new Set([
      "auth",
      "authorization",
      "credential",
      "credentials",
      "key",
      "password",
      "passwd",
      "pwd",
      "secret",
      "signature",
      "token",
    ]).has(normalized) ||
    /(?:apikey|accesskey|privatekey|secret|token|password|passwd|credential|authorization|signature)/u.test(
      normalized,
    )
  );
}

function isCredentialHeaderName(value: string): boolean {
  const normalized = normalizeCredentialName(value);
  return (
    new Set(["authorization", "cookie", "proxyauthorization"]).has(normalized) ||
    /(?:authorization|token|secret|credential|(?:api|access|auth|client|datahub)key)/u.test(
      normalized,
    )
  );
}

function classifyRequestMetadata(input: {
  readonly requestUrl: string;
  readonly headerNames: readonly string[];
  readonly expectedOrigin: string;
}): RequestAudit {
  try {
    const url = new URL(input.requestUrl);
    return {
      sameOrigin: url.origin === input.expectedOrigin,
      hasUrlCredentials: url.username !== "" || url.password !== "",
      hasSecretQueryParameterName: [...url.searchParams.keys()].some((name) =>
        isSecretQueryParameterName(name),
      ),
      hasCredentialHeaderName: input.headerNames.some((name) => isCredentialHeaderName(name)),
    };
  } catch {
    return {
      sameOrigin: false,
      hasUrlCredentials: false,
      hasSecretQueryParameterName: false,
      hasCredentialHeaderName: false,
    };
  }
}

function requireRequestAuditContract(condition: boolean): void {
  if (!condition) throw new Error("Remote request audit classifier contract failed.");
}

function assertRequestAuditClassifierContract(): void {
  const expectedOrigin = "https://public-replay.example.test";
  const safe = classifyRequestMetadata({
    requestUrl: `${expectedOrigin}/api/runs?_rsc=fixture`,
    headerNames: [
      "accept",
      "content-type",
      "access-control-request-method",
      "sec-fetch-site",
      "x-accessibility-mode",
      "x-authoritative-region",
      "x-client-version",
      "x-datahub-version",
    ],
    expectedOrigin,
  });
  requireRequestAuditContract(
    safe.sameOrigin &&
      !safe.hasUrlCredentials &&
      !safe.hasSecretQueryParameterName &&
      !safe.hasCredentialHeaderName,
  );

  const credentialUrl = new URL(expectedOrigin);
  credentialUrl.username = "user";
  credentialUrl.password = "value";
  requireRequestAuditContract(
    classifyRequestMetadata({
      requestUrl: credentialUrl.href,
      headerNames: [],
      expectedOrigin,
    }).hasUrlCredentials,
  );

  for (const queryName of ["api_key", "access-token", "client.secret"]) {
    const url = new URL(expectedOrigin);
    url.searchParams.set(queryName, "");
    requireRequestAuditContract(
      classifyRequestMetadata({
        requestUrl: url.href,
        headerNames: [],
        expectedOrigin,
      }).hasSecretQueryParameterName,
    );
  }

  for (const headerName of [
    "Authorization",
    "Cookie",
    "Proxy-Authorization",
    "X-API-Key",
    "X-Provider-Api-Key",
    "X-DataHub-Token",
    "X-Access-Token",
    "X-Auth-Token",
    "X-Client-Secret",
  ]) {
    requireRequestAuditContract(
      classifyRequestMetadata({
        requestUrl: expectedOrigin,
        headerNames: [headerName],
        expectedOrigin,
      }).hasCredentialHeaderName,
    );
  }

  requireRequestAuditContract(
    !classifyRequestMetadata({
      requestUrl: "https://foreign.example.test/",
      headerNames: [],
      expectedOrigin,
    }).sameOrigin,
  );
  requireRequestAuditContract(
    !classifyRequestMetadata({
      requestUrl: "not a URL",
      headerNames: [],
      expectedOrigin,
    }).sameOrigin,
  );
}

assertRequestAuditClassifierContract();

function captureBrowserSafety(page: Page, expectedOrigin: string): BrowserSafety {
  const safety: BrowserSafety = {
    consoleErrorCount: 0,
    consoleWarningCount: 0,
    pageErrorCount: 0,
    requestCount: 0,
    observationLimitExceeded: false,
    allRequestsSameOrigin: true,
    hasUrlCredentials: false,
    hasSecretQueryParameterName: false,
    hasCredentialHeaderName: false,
  };
  let observationCount = 0;
  const admitObservation = (): boolean => {
    if (observationCount >= MAX_BROWSER_OBSERVATIONS) {
      safety.observationLimitExceeded = true;
      return false;
    }
    observationCount += 1;
    return true;
  };
  page.on("console", (message) => {
    if (message.type() === "error" && admitObservation()) safety.consoleErrorCount += 1;
    if (message.type() === "warning" && admitObservation()) safety.consoleWarningCount += 1;
  });
  page.on("pageerror", () => {
    if (admitObservation()) safety.pageErrorCount += 1;
  });
  page.on("request", (request) => {
    if (!admitObservation()) return;
    safety.requestCount += 1;
    const audit = classifyRequestMetadata({
      requestUrl: request.url(),
      headerNames: Object.keys(request.headers()),
      expectedOrigin,
    });
    safety.allRequestsSameOrigin &&= audit.sameOrigin;
    safety.hasUrlCredentials ||= audit.hasUrlCredentials;
    safety.hasSecretQueryParameterName ||= audit.hasSecretQueryParameterName;
    safety.hasCredentialHeaderName ||= audit.hasCredentialHeaderName;
  });
  return safety;
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

test("proves the opt-in public Render deployment", async ({ baseURL, context, page }) => {
  if (baseURL === undefined) throw new Error("The public deployment URL is unavailable.");
  const expectedOrigin = new URL(baseURL).origin;
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: expectedOrigin,
  });
  const safety = captureBrowserSafety(page, expectedOrigin);
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
    await page.getByRole("button", { name: "Copy" }).click();
    await expect(page.getByRole("status")).toHaveText("Artifact copied.");
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const activePanel = document.querySelector<HTMLElement>(
              '[role="tabpanel"]:not([hidden])',
            );
            const expectedPreview = activePanel?.textContent;
            if (expectedPreview === undefined || expectedPreview === null) return false;
            return (await navigator.clipboard.readText()) === expectedPreview;
          }),
        { message: "Clipboard content must equal the active validated preview." },
      )
      .toBe(true);
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
    expect(content === preview).toBe(true);
    expect(/[A-Za-z]:\\/u.test(content)).toBe(false);
  }

  expect(safety.consoleErrorCount).toBe(0);
  expect(safety.consoleWarningCount).toBe(0);
  expect(safety.pageErrorCount).toBe(0);
  expect(safety.requestCount).toBeGreaterThan(0);
  expect(safety.observationLimitExceeded).toBe(false);
  expect(safety.allRequestsSameOrigin).toBe(true);
  expect(safety.hasUrlCredentials).toBe(false);
  expect(safety.hasSecretQueryParameterName).toBe(false);
  expect(safety.hasCredentialHeaderName).toBe(false);
});
