import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readRepositoryFile = async (path: string): Promise<string> =>
  await readFile(resolve(process.cwd(), path), "utf8");

describe("Midscene exploratory isolation", () => {
  it("uses a separate bounded single-worker Playwright configuration", async () => {
    const config = await readRepositoryFile("playwright.midscene.config.ts");

    expect(config).toContain('testDir: "./tests/exploratory"');
    expect(config).toContain("workers: 1");
    expect(config).toContain("retries: 0");
    expect(config).toContain("timeout: 90_000");
    expect(config).toContain("globalTimeout: 120_000");
    expect(await readRepositoryFile(".gitignore")).toContain(".tmp/");
  });

  it("stays outside mandatory CI and offline validation", async () => {
    const workflow = await readRepositoryFile(".github/workflows/ci.yml");
    const packageJson = JSON.parse(await readRepositoryFile("package.json")) as {
      readonly scripts: Readonly<Record<string, string>>;
    };

    expect(workflow).not.toContain("test:exploratory");
    expect(workflow).not.toContain("MIDSCENE_MODEL_API_KEY");
    expect(packageJson.scripts["verify:offline"]).not.toContain("exploratory");
  });
});
