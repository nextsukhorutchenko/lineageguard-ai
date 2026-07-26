import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXPECTED_RENDER_BLUEPRINT,
  validateRenderBlueprint,
  validateRenderBlueprintText,
} from "./validate-render-blueprint.js";

const CANONICAL_RENDER_BLUEPRINT = `services:
  - type: web
    name: lineageguard-ai-replay
    runtime: node
    plan: free
    numInstances: 1
    buildCommand: corepack enable && pnpm install --frozen-lockfile && pnpm build
    startCommand: pnpm start:public-replay
    healthCheckPath: /api/health
    autoDeployTrigger: off
    renderSubdomainPolicy: enabled
    maxShutdownDelaySeconds: 30
    envVars:
      - key: NODE_VERSION
        value: 22.23.1
      - key: NODE_ENV
        value: production
      - key: LINEAGEGUARD_DEMO_MODE
        value: REPLAY
      - key: LINEAGEGUARD_DEPLOYMENT_PROFILE
        value: PUBLIC_REPLAY
      - key: LINEAGEGUARD_RUNS_DIR
        value: /tmp/lineageguard-runs
      - key: NEXT_TELEMETRY_DISABLED
        value: "1"
`;

const temporaryRoots: string[] = [];

async function createRoot(blueprint?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lineageguard-render-blueprint-"));
  temporaryRoots.push(root);

  if (blueprint !== undefined) {
    await writeFile(join(root, "render.yaml"), blueprint, "utf8");
  }

  return root;
}

async function runValidator(root: string): Promise<{
  readonly exitCode: number | null;
  readonly standardError: string;
  readonly standardOutput: string;
}> {
  const child = spawn(
    process.execPath,
    [
      join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
      join(process.cwd(), "scripts", "validate-render-blueprint.ts"),
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let standardError = "";
  let standardOutput = "";

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    standardError += chunk;
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    standardOutput += chunk;
  });

  return new Promise((resolveResult, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolveResult({ exitCode, standardError, standardOutput });
    });
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("validateRenderBlueprintText", () => {
  it("accepts only the approved newline-terminated Render Blueprint", () => {
    expect(EXPECTED_RENDER_BLUEPRINT).toBe(CANONICAL_RENDER_BLUEPRINT);
    expect(validateRenderBlueprintText(CANONICAL_RENDER_BLUEPRINT)).toEqual([]);
  });

  it.each([
    ["free plan", "plan: free", "plan: starter", "Render Blueprint must use the free plan."],
    [
      "Node runtime",
      "runtime: node",
      "runtime: docker",
      "Render Blueprint must use the Node runtime.",
    ],
    [
      "single instance",
      "numInstances: 1",
      "numInstances: 2",
      "Render Blueprint must use exactly one instance.",
    ],
    [
      "health check",
      "healthCheckPath: /api/health",
      "healthCheckPath: /health",
      "Render Blueprint must use /api/health as its health check.",
    ],
    [
      "automatic deploy disablement",
      "autoDeployTrigger: off",
      "autoDeployTrigger: on",
      "Render Blueprint must disable automatic deploys.",
    ],
    [
      "frozen lockfile build",
      "pnpm install --frozen-lockfile",
      "pnpm install",
      "Render Blueprint must install dependencies with the frozen lockfile.",
    ],
    [
      "public replay start command",
      "startCommand: pnpm start:public-replay",
      "startCommand: pnpm start:web",
      "Render Blueprint must use the approved public replay start command.",
    ],
    [
      "pinned Node version",
      "value: 22.23.1",
      "value: 22",
      "Render Blueprint must pin NODE_VERSION to 22.23.1.",
    ],
    [
      "REPLAY mode",
      "value: REPLAY",
      "value: LIVE",
      "Render Blueprint must set the demo mode to REPLAY.",
    ],
    [
      "PUBLIC_REPLAY profile",
      "value: PUBLIC_REPLAY",
      "value: LIVE",
      "Render Blueprint must set the deployment profile to PUBLIC_REPLAY.",
    ],
    [
      "ephemeral runs directory",
      "value: /tmp/lineageguard-runs",
      "value: /var/runs",
      "Render Blueprint must use the approved ephemeral runs directory.",
    ],
  ])("rejects a changed %s marker", (_name, from, to, finding) => {
    const actual = validateRenderBlueprintText(CANONICAL_RENDER_BLUEPRINT.replace(from, to));

    expect(actual).toEqual([finding, "Render Blueprint differs from the approved contract."]);
  });

  it.each([
    [
      "a disk",
      "\n    disk:\n      name: persistent-data\n",
      "Render Blueprint must declare exactly one web service.",
    ],
    [
      "a database",
      "\ndatabases:\n  - name: replay-db\n",
      "Render Blueprint must declare exactly one web service.",
    ],
    [
      "a worker service",
      "\n  - type: worker\n    name: background\n",
      "Render Blueprint must declare exactly one web service.",
    ],
    [
      "a cron service",
      "\n  - type: cron\n    name: scheduled-job\n",
      "Render Blueprint must declare exactly one web service.",
    ],
    [
      "a private service",
      "\n  - type: pserv\n    name: private-service\n",
      "Render Blueprint must declare exactly one web service.",
    ],
    [
      "a second web service",
      "\n  - type: web\n    name: duplicate-service\n",
      "Render Blueprint must declare exactly one web service.",
    ],
    [
      "sync false",
      "\nsync: false\n",
      "Render Blueprint must not disable automatic deploys through sync.",
    ],
    [
      "a generated value",
      "\n      - key: GENERATED\n        generateValue: true\n",
      "Render Blueprint must not use generated values.",
    ],
    [
      "a secret-shaped key",
      "\n      - key: INTERNAL_SECRET\n        value: attacker-secret-value\n",
      "Render Blueprint must not declare secret-like environment variables.",
    ],
    [
      "a provider credential",
      "\n      - key: OPENAI_API_KEY\n        value: attacker-secret-value\n",
      "Render Blueprint must not declare provider credential environment variables.",
    ],
  ])("rejects %s without exposing its value", (_name, addition, finding) => {
    const actual = validateRenderBlueprintText(`${CANONICAL_RENDER_BLUEPRINT}${addition}`);

    expect(actual).toEqual([finding, "Render Blueprint differs from the approved contract."]);
    expect(actual.join(" ")).not.toContain("attacker-secret-value");
  });

  it("reports an otherwise unclassified byte difference", () => {
    expect(
      validateRenderBlueprintText(
        CANONICAL_RENDER_BLUEPRINT.replace(
          "name: lineageguard-ai-replay",
          "name: lineageguard-ai-replay ",
        ),
      ),
    ).toEqual(["Render Blueprint differs from the approved contract."]);
  });
});

describe("validateRenderBlueprint", () => {
  it("reads the canonical Blueprint from only the supplied root", async () => {
    const root = await createRoot(CANONICAL_RENDER_BLUEPRINT);

    await expect(validateRenderBlueprint(root)).resolves.toBeUndefined();
  });

  it("reports a missing Blueprint with a fixed safe error", async () => {
    const root = await createRoot();

    await expect(validateRenderBlueprint(root)).rejects.toThrow(
      "Render Blueprint could not be read.",
    );
  });

  it("reports an unreadable Blueprint path with a fixed safe error", async () => {
    const root = await createRoot();
    await mkdir(join(root, "render.yaml"));

    await expect(validateRenderBlueprint(root)).rejects.toThrow(
      "Render Blueprint could not be read.",
    );
  });

  it("rejects an oversized Blueprint before validating its contents", async () => {
    const root = await createRoot("x".repeat(16 * 1024 + 1));

    await expect(validateRenderBlueprint(root)).rejects.toThrow(
      "Render Blueprint exceeds the 16 KiB limit.",
    );
  });

  it("exits successfully when the executable reads a canonical Blueprint", async () => {
    const root = await createRoot(CANONICAL_RENDER_BLUEPRINT);

    await expect(runValidator(root)).resolves.toEqual({
      exitCode: 0,
      standardError: "",
      standardOutput: "",
    });
  });

  it("exits with fixed findings without exposing malformed Blueprint values", async () => {
    const root = await createRoot(
      `${CANONICAL_RENDER_BLUEPRINT}\n      - key: OPENAI_API_KEY\n        value: attacker-secret-value\n`,
    );

    const result = await runValidator(root);

    expect(result.exitCode).toBe(1);
    expect(result.standardOutput).toBe("");
    expect(result.standardError).toBe(
      "Render Blueprint must not declare provider credential environment variables.\nRender Blueprint differs from the approved contract.\n",
    );
    expect(result.standardError).not.toContain("attacker-secret-value");
  });
});
