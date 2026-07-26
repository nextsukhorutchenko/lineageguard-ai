import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config.js";

describe("toolchain", () => {
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
      "start:web": "next start",
      "summary:pr-impact": "tsx scripts/append-pr-impact-summary.ts",
      test: 'vitest run --exclude "tests/integration/**" --exclude "tests/e2e/**" --exclude "tests/exploratory/**" --exclude ".worktrees/**"',
      "test:e2e": "playwright test",
      "test:exploratory": "tsx scripts/run-midscene-exploratory.ts",
      "test:runtime-mode": "vitest run tests/integration/runtime-mode-page.integration.test.ts",
    });
    expect(packageJson.scripts["verify:offline"]).toBe(
      "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:runtime-mode && pnpm test:e2e --project=chromium",
    );
    expect(packageJson.scripts["verify:offline"]).not.toContain("exploratory");
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
