import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config.js";
import playwrightConfig from "../../playwright.config.js";

const REMOTE_CONFIGURATION_ERROR = "Public deployment acceptance configuration is invalid.";
const EXPECTED_NEXT_ENV_DECLARATION = [
  '/// <reference types="next" />',
  '/// <reference types="next/image-types/global" />',
  'import "./.next/types/routes.d.ts";',
  "",
  "// NOTE: This file should not be edited",
  "// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.",
  "",
].join("\n");
const TEST_RENDER_HOST = ["lineageguard-ai", "onrender", "com"].join(".");
const TEST_RENDER_ORIGIN = `https://${TEST_RENDER_HOST}`;
const VALID_REMOTE_ACCEPTANCE_ENVIRONMENT = {
  RUN_PUBLIC_REPLAY_ACCEPTANCE: "1",
  LINEAGEGUARD_PUBLIC_URL: TEST_RENDER_ORIGIN,
} as const;

function listRemoteTests(environment: Readonly<Record<string, string | undefined>>) {
  const playwrightCli = createRequire(import.meta.url).resolve("@playwright/test/cli");
  return spawnSync(
    process.execPath,
    [playwrightCli, "test", "--config", "playwright.public-remote.config.ts", "--list"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        APPDATA: process.env.APPDATA,
        COMSPEC: process.env.COMSPEC,
        HOME: process.env.HOME,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH,
        PATHEXT: process.env.PATHEXT,
        SYSTEMROOT: process.env.SYSTEMROOT,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        USERPROFILE: process.env.USERPROFILE,
        WINDIR: process.env.WINDIR,
        ...environment,
      },
      shell: false,
      timeout: 20_000,
      windowsHide: true,
    },
  );
}

describe("toolchain", () => {
  it("keeps the pinned Next.js declaration file canonical", async () => {
    const declaration = await readFile(resolve(process.cwd(), "next-env.d.ts"), "utf8");

    expect(declaration).toBe(EXPECTED_NEXT_ENV_DECLARATION);
  });

  it("runs on the pinned Node major version", () => {
    expect(Number.parseInt(process.versions.node, 10)).toBe(22);
  });

  it("pins the approved browser and agent toolchain", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };

    expect(packageJson.dependencies).toMatchObject({
      "@openai/agents": "0.13.5",
      next: "16.2.11",
      "node-sql-parser": "5.4.0",
      react: "19.2.8",
      "react-dom": "19.2.8",
    });
    expect(packageJson.devDependencies).toMatchObject({
      "@eslint/js": "9.39.5",
      "@midscene/web": "1.10.7",
      "@playwright/test": "1.61.1",
      "@types/react": "19.2.17",
      "@types/react-dom": "19.2.3",
      eslint: "9.39.5",
      "eslint-config-next": "16.2.11",
    });
    expect(packageJson.scripts).toMatchObject({
      "build:cli": "tsc -p tsconfig.build.json",
      "build:web": "next build --webpack",
      dev: "next dev --webpack",
      "prepare:pr-impact": "tsx scripts/prepare-pr-impact.ts",
      "render:check": "tsx scripts/validate-render-blueprint.ts",
      "start:public-replay": "node dist/hosting/start-public-replay.js",
      "start:web": "next start",
      "summary:pr-impact": "tsx scripts/append-pr-impact-summary.ts",
      test: 'vitest run --exclude "tests/integration/**" --exclude "tests/e2e/**" --exclude "tests/exploratory/**" --exclude ".worktrees/**"',
      "test:public-deployment": "playwright test --config playwright.public-remote.config.ts",
      "test:public-replay":
        "vitest run tests/api/run-routes.test.ts && playwright test --config playwright.public-replay.config.ts",
      "test:e2e": "playwright test",
      "test:exploratory": "tsx scripts/run-midscene-exploratory.ts",
      "test:runtime-mode": "vitest run tests/integration/runtime-mode-page.integration.test.ts",
    });
    expect(packageJson.scripts["verify:offline"]).toBe(
      "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm render:check && pnpm build && pnpm test:runtime-mode && pnpm test:public-replay && pnpm test:e2e --project=chromium",
    );
    expect(packageJson.scripts["verify:offline"]).not.toContain("exploratory");
  });

  it("keeps dedicated public specs out of the ordinary browser harness", () => {
    expect(playwrightConfig.testIgnore).toEqual([
      "public-replay-deployment.spec.ts",
      "public-replay-remote.spec.ts",
    ]);
  });

  it.each([
    [
      "missing opt-in",
      { LINEAGEGUARD_PUBLIC_URL: VALID_REMOTE_ACCEPTANCE_ENVIRONMENT.LINEAGEGUARD_PUBLIC_URL },
    ],
    [
      "wrong opt-in",
      { ...VALID_REMOTE_ACCEPTANCE_ENVIRONMENT, RUN_PUBLIC_REPLAY_ACCEPTANCE: "true" },
    ],
    ["missing URL", { RUN_PUBLIC_REPLAY_ACCEPTANCE: "1" }],
    [
      "HTTP URL",
      {
        ...VALID_REMOTE_ACCEPTANCE_ENVIRONMENT,
        LINEAGEGUARD_PUBLIC_URL: `http://${TEST_RENDER_HOST}`,
      },
    ],
    [
      "foreign host",
      {
        ...VALID_REMOTE_ACCEPTANCE_ENVIRONMENT,
        LINEAGEGUARD_PUBLIC_URL: "https://onrender.com.example.test",
      },
    ],
    [
      "Render apex",
      {
        ...VALID_REMOTE_ACCEPTANCE_ENVIRONMENT,
        LINEAGEGUARD_PUBLIC_URL: "https://onrender.com",
      },
    ],
    [
      "deep Render subdomain",
      {
        ...VALID_REMOTE_ACCEPTANCE_ENVIRONMENT,
        LINEAGEGUARD_PUBLIC_URL: `https://deep.${TEST_RENDER_HOST}`,
      },
    ],
    [
      "punycode service label",
      {
        ...VALID_REMOTE_ACCEPTANCE_ENVIRONMENT,
        LINEAGEGUARD_PUBLIC_URL: "https://xn--lineageguard-9db.onrender.com",
      },
    ],
    [
      "Unicode service label",
      {
        ...VALID_REMOTE_ACCEPTANCE_ENVIRONMENT,
        LINEAGEGUARD_PUBLIC_URL: "https://lïneageguard.onrender.com",
      },
    ],
    [
      "trailing dot",
      {
        ...VALID_REMOTE_ACCEPTANCE_ENVIRONMENT,
        LINEAGEGUARD_PUBLIC_URL: `${TEST_RENDER_ORIGIN}.`,
      },
    ],
    [
      "encoded hostname separator",
      {
        ...VALID_REMOTE_ACCEPTANCE_ENVIRONMENT,
        LINEAGEGUARD_PUBLIC_URL: "https://lineageguard-ai%2eonrender.com",
      },
    ],
    [
      "URL credentials",
      {
        ...VALID_REMOTE_ACCEPTANCE_ENVIRONMENT,
        LINEAGEGUARD_PUBLIC_URL: `https://private-user:private-password@${TEST_RENDER_HOST}`,
      },
    ],
    [
      "URL fragment",
      {
        ...VALID_REMOTE_ACCEPTANCE_ENVIRONMENT,
        LINEAGEGUARD_PUBLIC_URL: `${TEST_RENDER_ORIGIN}/#private`,
      },
    ],
    [
      "non-root path",
      {
        ...VALID_REMOTE_ACCEPTANCE_ENVIRONMENT,
        LINEAGEGUARD_PUBLIC_URL: `${TEST_RENDER_ORIGIN}/demo`,
      },
    ],
    [
      "URL query",
      {
        ...VALID_REMOTE_ACCEPTANCE_ENVIRONMENT,
        LINEAGEGUARD_PUBLIC_URL: `${TEST_RENDER_ORIGIN}/?mode=public`,
      },
    ],
    [
      "explicit port",
      {
        ...VALID_REMOTE_ACCEPTANCE_ENVIRONMENT,
        LINEAGEGUARD_PUBLIC_URL: `https://${TEST_RENDER_HOST}:444/`,
      },
    ],
    [
      "explicit default port",
      {
        ...VALID_REMOTE_ACCEPTANCE_ENVIRONMENT,
        LINEAGEGUARD_PUBLIC_URL: `https://${TEST_RENDER_HOST}:443/`,
      },
    ],
  ])("rejects remote acceptance configuration before discovery: %s", (_name, environment) => {
    const result = listRemoteTests(environment);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain(REMOTE_CONFIGURATION_ERROR);
    expect(output).not.toContain("private-user");
    expect(output).not.toContain("private-password");
  });

  it("lists the remote acceptance only after exact opt-in without contacting Render", () => {
    const result = listRemoteTests(VALID_REMOTE_ACCEPTANCE_ENVIRONMENT);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output).toContain("public-replay-remote.spec.ts");
    expect(output).toContain("Total: 1 test");
  });

  it("disables trace capture for remote acceptance", async () => {
    const remoteConfig = await readFile(
      resolve(process.cwd(), "playwright.public-remote.config.ts"),
      "utf8",
    );
    const traceSettings = [...remoteConfig.matchAll(/\btrace:\s*"([^"]+)"/gu)].map(
      (match) => match[1],
    );

    expect(traceSettings).toEqual(["off"]);
  });

  it("keeps the built output compatible with next start", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["start:web"]).toBe("next start");
    expect(nextConfig.output).toBeUndefined();
  });

  it("applies no-store browser-security headers to every public path", async () => {
    const headerRules = await nextConfig.headers?.();

    expect(headerRules).toEqual([
      {
        source: "/:path*",
        headers: expect.arrayContaining([
          { key: "cache-control", value: "no-store" },
          { key: "referrer-policy", value: "no-referrer" },
          { key: "x-content-type-options", value: "nosniff" },
          { key: "x-frame-options", value: "DENY" },
        ]),
      },
    ]);
  });

  it("keeps advisory PR impact reporting read-only and PR-gated", async () => {
    const workflow = await readFile(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");

    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("if: github.event_name == 'pull_request'");
    expect(workflow).toContain("if: always() && github.event_name == 'pull_request'");
    expect(workflow).toContain("actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f");
    expect(workflow).not.toMatch(
      /pull-requests:\s*write|checks:\s*write|issues:\s*write|api\.github\.com|actions\/github-script|\bgh\s/u,
    );
  });

  it("keeps the shared REPLAY browser harness single-worker", async () => {
    const playwrightConfig = await readFile(resolve(process.cwd(), "playwright.config.ts"), "utf8");

    expect(playwrightConfig).toContain("workers: 1");
  });

  it("excludes ignored worktrees from every Vitest invocation", async () => {
    const vitestConfig = await readFile(resolve(process.cwd(), "vitest.config.ts"), "utf8");

    expect(vitestConfig).toContain('exclude: [...configDefaults.exclude, ".worktrees/**"]');
  });
});
