import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readRepositoryFile = async (path: string): Promise<string> =>
  await readFile(resolve(process.cwd(), path), "utf8");

const agents = [
  {
    path: ".codex/agents/playwright_test_planner.toml",
    name: "playwright_test_planner",
    sandboxMode: "read-only",
  },
  {
    path: ".codex/agents/playwright_test_generator.toml",
    name: "playwright_test_generator",
    sandboxMode: "read-only",
  },
  {
    path: ".codex/agents/playwright_test_healer.toml",
    name: "playwright_test_healer",
    sandboxMode: "workspace-write",
  },
] as const;

describe("Playwright Test Agents", () => {
  it("uses the exact installed Playwright CLI for regeneration", async () => {
    const packageJson = JSON.parse(await readRepositoryFile("package.json")) as {
      readonly devDependencies: Readonly<Record<string, string>>;
      readonly scripts: Readonly<Record<string, string>>;
    };

    expect(packageJson.devDependencies["@playwright/test"]).toBe("1.61.1");
    expect(packageJson.scripts["agents:init"]).toBe(
      "playwright init-agents --loop=codex --project=chromium",
    );
    expect(packageJson.scripts["verify:offline"]).not.toContain("agents:init");
  });

  it.each(agents)("keeps $name as a bounded local Codex definition", async (agent) => {
    const content = await readRepositoryFile(agent.path);

    expect(content).toContain(`name = "${agent.name}"`);
    expect(content).toContain(`sandbox_mode = "${agent.sandboxMode}"`);
    expect(content).toContain("[mcp_servers.playwright-test]");
    expect(content).toContain('"playwright", "run-test-mcp-server"');
    expect(content).not.toContain("@latest");
    expect(content).not.toContain("GITHUB_TOKEN");
    expect(content).not.toContain("GH_TOKEN");
  });

  it("uses a deterministic fixture-replay seed", async () => {
    const seed = await readRepositoryFile("tests/e2e/seed.spec.ts");
    const plansReadme = await readRepositoryFile("specs/README.md");

    expect(seed).toContain('test("seeds the fixture replay workspace"');
    expect(seed).toContain('page.goto("/")');
    expect(seed).toContain('"Fixture replay"');
    expect(seed).not.toContain("OPENAI_API_KEY");
    expect(seed).not.toContain("DATAHUB_GMS_TOKEN");
    expect(plansReadme).toContain("Playwright Agent Test Plans");
    expect(plansReadme).toContain("human review");
  });
});
