import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import {
  SECRET_SCAN_OPERATION_ERROR,
  SECRET_SCAN_SUCCESS,
  SECRET_SCAN_USAGE,
  scanRepositorySecrets,
} from "./scan-repository-secrets.js";

const execFileAsync = promisify(execFile);
const scannerPath = fileURLToPath(new URL("./scan-repository-secrets.ts", import.meta.url));
const tsxCliPath = fileURLToPath(import.meta.resolve("tsx/cli"));
const temporaryRoots: string[] = [];
const GIT_HEAVY_TEST_TIMEOUT_MS = 30_000;

async function git(root: string, ...args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return stdout.toString().trim();
}

async function writeRepositoryFile(
  root: string,
  relativePath: string,
  content: string | Buffer,
): Promise<void> {
  const destination = join(root, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lineageguard-secret-scan-"));
  temporaryRoots.push(root);
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "LineageGuard Test");
  await git(root, "config", "user.email", "lineageguard@example.invalid");
  await writeRepositoryFile(root, "README.md", "safe repository\n");
  await git(root, "add", "--all");
  await git(root, "commit", "-m", "test: initialize repository");
  return root;
}

async function commitAll(root: string, message: string): Promise<string> {
  await git(root, "add", "--all");
  await git(root, "commit", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

function openAiToken(): string {
  return `${["s", "k"].join("")}-${["p", "r", "o", "j"].join("")}-${"A".repeat(48)}`;
}

function githubToken(): string {
  return `${["g", "h", "p"].join("")}_${"B".repeat(36)}`;
}

function dataHubJwt(): string {
  return [`${["e", "y", "J"].join("")}${"C".repeat(20)}`, "D".repeat(24), "E".repeat(24)].join(".");
}

function bearerCredential(): string {
  return `${["Bear", "er"].join("")} ${"F".repeat(40)}`;
}

function privateKeyBlock(bodyLines: readonly string[] = ["G".repeat(64), "H".repeat(64)]): string {
  return [
    ["-----BEGIN", "PRIVATE KEY-----"].join(" "),
    ...bodyLines,
    ["-----END", "PRIVATE KEY-----"].join(" "),
  ].join("\n");
}

function spawnScanner(root: string, args: readonly string[]) {
  const result = spawnSync(process.execPath, [tsxCliPath, scannerPath, ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  return result;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it(
  "detects every realistic credential class in tracked source without echoing values",
  async () => {
    const root = await createRepository();
    const values = [
      openAiToken(),
      githubToken(),
      dataHubJwt(),
      bearerCredential(),
      privateKeyBlock(),
    ];
    await writeRepositoryFile(root, "src/leaks.txt", values.join("\n"));
    await commitAll(root, "test: add detector fixture");

    const findings = await scanRepositorySecrets(root);
    expect(findings).toEqual([
      "working-tree:src/leaks.txt:1:openai-token",
      "working-tree:src/leaks.txt:2:github-token",
      "working-tree:src/leaks.txt:3:datahub-jwt",
      "working-tree:src/leaks.txt:4:bearer-credential",
      "working-tree:src/leaks.txt:5:private-key",
    ]);
    for (const value of values) expect(findings.join("\n")).not.toContain(value);
  },
  GIT_HEAVY_TEST_TIMEOUT_MS,
);

it.each([
  ["single-body-line", ["I".repeat(64)]],
  ["short-final-body-line", ["J".repeat(64), `${"K".repeat(6)}==`]],
] as const)("detects a complete private key with %s", async (_name, bodyLines) => {
  const root = await createRepository();
  await writeRepositoryFile(root, "src/edge-key.pem", privateKeyBlock(bodyLines));

  await expect(scanRepositorySecrets(root)).resolves.toContain(
    "working-tree:src/edge-key.pem:1:private-key",
  );
});

it(
  "detects a not-ignored untracked file without printing its value or native root",
  async () => {
    const root = await createRepository();
    const token = githubToken();
    await writeRepositoryFile(root, "scratch/leak.txt", token);

    await expect(scanRepositorySecrets(root)).resolves.toEqual([
      "working-tree:scratch/leak.txt:1:github-token",
    ]);
    const result = spawnScanner(root, []);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("working-tree:scratch/leak.txt:1:github-token\n");
    expect(result.stderr).not.toContain(token);
    expect(result.stderr).not.toContain(root);
  },
  GIT_HEAVY_TEST_TIMEOUT_MS,
);

it(
  "finds a removed credential in synthetic history and still scans the clean tree",
  async () => {
    const root = await createRepository();
    const token = dataHubJwt();
    await writeRepositoryFile(root, "src/history.txt", `${token}\n`);
    const secretCommit = await commitAll(root, "test: add historical fixture");
    await writeRepositoryFile(root, "src/history.txt", "removed\n");
    await commitAll(root, "test: remove historical fixture");

    await expect(scanRepositorySecrets(root)).resolves.toEqual([]);
    const findings = await scanRepositorySecrets(root, { history: true });
    expect(findings).toContain(`history:${secretCommit}:datahub-jwt`);
    expect(findings.join("\n")).not.toContain(token);

    const result = spawnScanner(root, ["--history"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`history:${secretCommit}:datahub-jwt`);
    expect(result.stderr).not.toContain(token);
    expect(result.stderr).not.toContain(root);
  },
  GIT_HEAVY_TEST_TIMEOUT_MS,
);

it(
  "scans root commits reachable only from alternate refs",
  async () => {
    const root = await createRepository();
    const alternateRoot = await mkdtemp(join(tmpdir(), "lineageguard-secret-root-"));
    temporaryRoots.push(alternateRoot);
    await git(alternateRoot, "init", "-b", "alternate");
    await git(alternateRoot, "config", "user.name", "LineageGuard Test");
    await git(alternateRoot, "config", "user.email", "lineageguard@example.invalid");
    const token = dataHubJwt();
    await writeRepositoryFile(alternateRoot, "root-secret.txt", `${token}\n`);
    await git(alternateRoot, "add", "--all");
    await git(alternateRoot, "commit", "-m", "test: add alternate root fixture");
    const secretCommit = await git(alternateRoot, "rev-parse", "HEAD");
    await git(root, "fetch", alternateRoot, "HEAD:refs/heads/alternate-secret");

    await expect(scanRepositorySecrets(root)).resolves.toEqual([]);
    const findings = await scanRepositorySecrets(root, { history: true });
    expect(findings).toContain(`history:${secretCommit}:datahub-jwt`);
    expect(findings.join("\n")).not.toContain(token);
  },
  GIT_HEAVY_TEST_TIMEOUT_MS,
);

it(
  "disables textconv filters while scanning history",
  async () => {
    const root = await createRepository();
    const textconvScript = join(root, ".git", "safe-textconv.mjs");
    await writeFile(textconvScript, 'process.stdout.write("safe textconv output\\n");\n', "utf8");
    const nodePath = process.execPath.replaceAll("\\", "/");
    const scriptPath = textconvScript.replaceAll("\\", "/");
    await git(root, "config", "diff.suppress.textconv", `"${nodePath}" "${scriptPath}"`);
    await writeRepositoryFile(root, ".gitattributes", "*.secret diff=suppress\n");
    await commitAll(root, "test: configure textconv fixture");

    const token = dataHubJwt();
    await writeRepositoryFile(root, "src/filtered.secret", `${token}\n`);
    const secretCommit = await commitAll(root, "test: add filtered historical fixture");
    await writeRepositoryFile(root, "src/filtered.secret", "removed\n");
    await commitAll(root, "test: remove filtered historical fixture");

    await expect(scanRepositorySecrets(root)).resolves.toEqual([]);
    const findings = await scanRepositorySecrets(root, { history: true });
    expect(findings).toContain(`history:${secretCommit}:datahub-jwt`);
    expect(findings.join("\n")).not.toContain(token);
  },
  GIT_HEAVY_TEST_TIMEOUT_MS,
);

it(
  "finds a removed credential when Git color is forced on",
  async () => {
    const root = await createRepository();
    await git(root, "config", "color.ui", "always");
    const token = dataHubJwt();
    await writeRepositoryFile(root, "src/colored-history.txt", `${token}\n`);
    const secretCommit = await commitAll(root, "test: add colored historical fixture");
    await writeRepositoryFile(root, "src/colored-history.txt", "removed\n");
    await commitAll(root, "test: remove colored historical fixture");

    await expect(scanRepositorySecrets(root)).resolves.toEqual([]);
    const findings = await scanRepositorySecrets(root, { history: true });
    expect(findings).toContain(`history:${secretCommit}:datahub-jwt`);
    expect(findings.join("\n")).not.toContain(token);

    const result = spawnScanner(root, ["--history"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`history:${secretCommit}:datahub-jwt`);
    expect(result.stderr).not.toContain(token);
    expect(result.stderr).not.toContain(root);
  },
  GIT_HEAVY_TEST_TIMEOUT_MS,
);

it("allows only empty values, placeholders, commands, and documentation sentinels", async () => {
  const root = await createRepository();
  await writeRepositoryFile(
    root,
    ".env.example",
    [
      ["OPENAI_API_KEY", ""].join("="),
      ["DATAHUB_GMS_TOKEN", "<your-datahub-personal-access-token>"].join("="),
    ].join("\n"),
  );
  await writeRepositoryFile(
    root,
    "docs/setup.md",
    [
      ["$env:DATAHUB_GMS_TOKEN", "& .\\.venv\\Scripts\\python.exe token.py"].join(" = "),
      ["DATAHUB_GMS_TOKEN", ".+"].join("="),
      ["$env:DATAHUB_GMS_TOKEN", `"<local token>"`].join(" = "),
    ].join("\n"),
  );

  await expect(scanRepositorySecrets(root)).resolves.toEqual([]);
  await writeRepositoryFile(
    root,
    "src/suspicious.env",
    ["OPENAI_API_KEY", "weak-but-nonempty"].join("="),
  );
  await expect(scanRepositorySecrets(root)).resolves.toContain(
    "working-tree:src/suspicious.env:1:literal-secret-assignment",
  );
});

it("does not let a command-derived assignment hide a realistic token", async () => {
  const root = await createRepository();
  const token = openAiToken();
  await writeRepositoryFile(
    root,
    "docs/unsafe-command.md",
    ["$env:OPENAI_API_KEY", `& Write-Output ${token}`].join(" = "),
  );

  const findings = await scanRepositorySecrets(root);
  expect(findings).toContain("working-tree:docs/unsafe-command.md:1:openai-token");
  expect(findings).toContain("working-tree:docs/unsafe-command.md:1:literal-secret-assignment");
  expect(findings.join("\n")).not.toContain(token);
});

it("skips binary content selected by git", async () => {
  const root = await createRepository();
  await writeRepositoryFile(
    root,
    "src/binary.dat",
    Buffer.concat([Buffer.from(openAiToken(), "utf8"), Buffer.from([0, 1, 2, 3])]),
  );
  await expect(scanRepositorySecrets(root)).resolves.toEqual([]);
});

it("rejects unsupported CLI arguments with fixed usage", () => {
  const result = spawnScanner(process.cwd(), ["--unexpected"]);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(`${SECRET_SCAN_USAGE}\n`);
  expect(result.stderr).not.toContain(process.cwd());
});

it("has no import side effect", () => {
  const expression = `import(${JSON.stringify(pathToFileURL(scannerPath).href)})`;
  const result = spawnSync(process.execPath, [tsxCliPath, "--eval", expression], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
});

it("collapses non-repository failures without a native path or stack", async () => {
  const root = await mkdtemp(join(tmpdir(), "lineageguard-not-a-repository-"));
  temporaryRoots.push(root);
  const result = spawnScanner(root, []);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(`${SECRET_SCAN_OPERATION_ERROR}\n`);
  expect(result.stderr).not.toContain(root);
  expect(result.stderr).not.toContain("Error:");
});

it("accepts the current repository and its existing history", async () => {
  await expect(scanRepositorySecrets(process.cwd(), { history: true })).resolves.toEqual([]);
  const result = spawnScanner(process.cwd(), []);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(`${SECRET_SCAN_SUCCESS}\n`);
  expect(result.stderr).toBe("");
});
