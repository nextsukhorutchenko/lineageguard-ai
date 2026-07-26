import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const MAX_BLUEPRINT_BYTES = 16 * 1024;
const GENERIC_DIFFERENCE = "Render Blueprint differs from the approved contract.";

export const EXPECTED_RENDER_BLUEPRINT = `services:
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

class RenderBlueprintValidationError extends Error {}

function hasForbiddenResource(value: string): boolean {
  const serviceDefinitions = value.match(/^\s*-\s+type:\s+\S+\s*$/gmu) ?? [];

  if (serviceDefinitions.length !== 1) {
    return true;
  }

  return [
    "\n  - type: worker",
    "\n  - type: cron",
    "\n  - type: pserv",
    "\n  - type: private",
    "\ndatabases:",
    "\ndisks:",
    "\n    disk:",
  ].some((marker) => value.includes(marker));
}

function hasProviderCredential(value: string): boolean {
  return /^\s*-\s+key:\s*(?:OPENAI|DATAHUB|MCP)[A-Z0-9_]*\s*$/imu.test(value);
}

function hasSecretLikeKey(value: string): boolean {
  return /^\s*-\s+key:\s*[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY)\s*$/imu.test(
    value,
  );
}

export function validateRenderBlueprintText(value: string): readonly string[] {
  if (value === EXPECTED_RENDER_BLUEPRINT) {
    return [];
  }

  const findings: string[] = [];

  if (!value.includes("runtime: node\n")) {
    findings.push("Render Blueprint must use the Node runtime.");
  } else if (!value.includes("plan: free\n")) {
    findings.push("Render Blueprint must use the free plan.");
  } else if (!value.includes("numInstances: 1\n")) {
    findings.push("Render Blueprint must use exactly one instance.");
  } else if (!value.includes("healthCheckPath: /api/health\n")) {
    findings.push("Render Blueprint must use /api/health as its health check.");
  } else if (!value.includes("autoDeployTrigger: off\n")) {
    findings.push("Render Blueprint must disable automatic deploys.");
  } else if (!value.includes("pnpm install --frozen-lockfile")) {
    findings.push("Render Blueprint must install dependencies with the frozen lockfile.");
  } else if (!value.includes("startCommand: pnpm start:public-replay\n")) {
    findings.push("Render Blueprint must use the approved public replay start command.");
  } else if (!value.includes("- key: NODE_VERSION\n        value: 22.23.1\n")) {
    findings.push("Render Blueprint must pin NODE_VERSION to 22.23.1.");
  } else if (!value.includes("- key: LINEAGEGUARD_DEMO_MODE\n        value: REPLAY\n")) {
    findings.push("Render Blueprint must set the demo mode to REPLAY.");
  } else if (
    !value.includes("- key: LINEAGEGUARD_DEPLOYMENT_PROFILE\n        value: PUBLIC_REPLAY\n")
  ) {
    findings.push("Render Blueprint must set the deployment profile to PUBLIC_REPLAY.");
  } else if (
    !value.includes("- key: LINEAGEGUARD_RUNS_DIR\n        value: /tmp/lineageguard-runs\n")
  ) {
    findings.push("Render Blueprint must use the approved ephemeral runs directory.");
  } else if (hasForbiddenResource(value)) {
    findings.push("Render Blueprint must declare exactly one web service.");
  } else if (value.includes("sync: false")) {
    findings.push("Render Blueprint must not disable automatic deploys through sync.");
  } else if (value.includes("generateValue")) {
    findings.push("Render Blueprint must not use generated values.");
  } else if (hasProviderCredential(value)) {
    findings.push("Render Blueprint must not declare provider credential environment variables.");
  } else if (hasSecretLikeKey(value)) {
    findings.push("Render Blueprint must not declare secret-like environment variables.");
  }

  return [...findings, GENERIC_DIFFERENCE];
}

export async function validateRenderBlueprint(root = process.cwd()): Promise<void> {
  let contents: Buffer;

  try {
    contents = await readFile(resolve(root, "render.yaml"));
  } catch {
    throw new RenderBlueprintValidationError("Render Blueprint could not be read.");
  }

  if (contents.byteLength > MAX_BLUEPRINT_BYTES) {
    throw new RenderBlueprintValidationError("Render Blueprint exceeds the 16 KiB limit.");
  }

  const findings = validateRenderBlueprintText(contents.toString("utf8"));

  if (findings.length > 0) {
    throw new RenderBlueprintValidationError(findings.join("\n"));
  }
}

async function main(): Promise<void> {
  try {
    await validateRenderBlueprint();
  } catch (error) {
    const message =
      error instanceof RenderBlueprintValidationError
        ? error.message
        : "Render Blueprint validation failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
