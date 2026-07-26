import { spawn } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const SECRET_SCAN_USAGE = "Usage: tsx scripts/scan-repository-secrets.ts [--history]";
export const SECRET_SCAN_SUCCESS = "Repository secret scan passed.";
export const SECRET_SCAN_OPERATION_ERROR = "Repository secret scan failed.";

type SecretRule =
  | "openai-token"
  | "github-token"
  | "datahub-jwt"
  | "bearer-credential"
  | "private-key"
  | "literal-secret-assignment";

type LineDetector = Readonly<{
  code: Exclude<SecretRule, "private-key" | "literal-secret-assignment">;
  pattern: RegExp;
}>;

const lineDetectors: readonly LineDetector[] = [
  {
    code: "openai-token",
    pattern: /(?<![A-Za-z0-9_-])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/u,
  },
  {
    code: "github-token",
    pattern:
      /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})(?![A-Za-z0-9_])/u,
  },
  {
    code: "datahub-jwt",
    pattern:
      /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}(?![A-Za-z0-9_-])/u,
  },
  {
    code: "bearer-credential",
    pattern: /(?<![A-Za-z])Bearer[ \t]+[A-Za-z0-9._~+/=-]{32,}(?![A-Za-z0-9._~+/=-])/iu,
  },
];

const secretVariableNames = [
  "OPENAI_API_KEY",
  "DATAHUB_GMS_TOKEN",
  "DATAHUB_TOKEN",
  "DATAHUB_PAT",
  "DATAHUB_ACCESS_TOKEN",
  "DATAHUB_API_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
] as const;

const assignmentPattern = new RegExp(
  String.raw`^[ \t]*(?:export[ \t]+)?(?:\$env:)?(?:${secretVariableNames.join(
    "|",
  )})[ \t]*=[ \t]*(.*?)[ \t]*$`,
  "iu",
);

const examplePlaceholders = new Set([
  "your-openai-api-key",
  "<your-openai-api-key>",
  "your-datahub-gms-token",
  "<your-datahub-gms-token>",
  "your-datahub-personal-access-token",
  "<your-datahub-personal-access-token>",
  "your-github-token",
  "<your-github-token>",
]);

const documentationSentinel =
  /^(?:\.\+|\.\*|\\[sSdDwW]\+|<[- A-Za-z0-9_]{2,80}>|\[[^\]\r\n]{1,80}\](?:[+*?]|\{\d+(?:,\d*)?\})?)$/u;

function privateKeyBlockPattern(): RegExp {
  return /-----BEGIN ((?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY)-----\r?\n[A-Za-z0-9+/]{16,76}={0,2}\r?\n(?:[A-Za-z0-9+/]{1,76}={0,2}\r?\n)*-----END \1-----/gu;
}

function unwrapQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value.at(-1);
  return (first === `"` && last === `"`) || (first === `'` && last === `'`)
    ? value.slice(1, -1)
    : value;
}

function containsCredentialShape(value: string): boolean {
  return lineDetectors.some(({ pattern }) => pattern.test(value));
}

function isSuspiciousAssignment(line: string, gitPath: string | undefined): boolean {
  const match = assignmentPattern.exec(line);
  if (match === null) return false;

  const rightHandSide = (match[1] ?? "").trim();
  const unquoted = unwrapQuotes(rightHandSide).trim();
  if (unquoted === "") return false;
  if (documentationSentinel.test(unquoted)) return false;
  if (gitPath === ".env.example" && examplePlaceholders.has(unquoted)) return false;
  if (rightHandSide.startsWith("& ") && !containsCredentialShape(rightHandSide)) return false;
  return true;
}

function scanLine(line: string, gitPath: string | undefined): readonly SecretRule[] {
  const findings: SecretRule[] = [];
  for (const detector of lineDetectors) {
    if (detector.pattern.test(line)) findings.push(detector.code);
  }
  if (isSuspiciousAssignment(line, gitPath)) findings.push("literal-secret-assignment");
  return findings;
}

function privateKeyStartLines(text: string): readonly number[] {
  const lines: number[] = [];
  for (const match of text.matchAll(privateKeyBlockPattern())) {
    lines.push(text.slice(0, match.index).split(/\r\n|\n|\r/u).length);
  }
  return lines;
}

function hasPrivateKeyBlock(text: string): boolean {
  return privateKeyBlockPattern().test(text);
}

function decodeGitText(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(SECRET_SCAN_OPERATION_ERROR);
  }
}

function decodeRepositoryText(buffer: Buffer): string | undefined {
  if (buffer.includes(0)) return undefined;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded;
  } catch {
    return undefined;
  }
}

function runGit(root: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", ["-C", root, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let settled = false;

    const rejectFixed = (): void => {
      if (settled) return;
      settled = true;
      rejectPromise(new Error(SECRET_SCAN_OPERATION_ERROR));
    };

    child.stdout.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    child.stderr.resume();
    child.once("error", rejectFixed);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolvePromise(Buffer.concat(chunks));
      else rejectPromise(new Error(SECRET_SCAN_OPERATION_ERROR));
    });
  });
}

function selectedAbsolutePath(root: string, gitPath: string): string {
  const absolutePath = resolve(root, gitPath);
  const pathFromRoot = relative(root, absolutePath);
  if (
    pathFromRoot === "" ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(SECRET_SCAN_OPERATION_ERROR);
  }
  return absolutePath;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function readSelectedText(root: string, gitPath: string): Promise<string | undefined> {
  const absolutePath = selectedAbsolutePath(root, gitPath);
  try {
    const status = await lstat(absolutePath);
    if (status.isSymbolicLink()) {
      return decodeRepositoryText(Buffer.from(await readlink(absolutePath), "utf8"));
    }
    if (!status.isFile()) return undefined;
    return decodeRepositoryText(await readFile(absolutePath));
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw new Error(SECRET_SCAN_OPERATION_ERROR);
  }
}

function printablePath(gitPath: string): string {
  const normalized = gitPath
    .normalize("NFC")
    .replace(/\\/gu, "/")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/gu, "?");
  if (normalized.length > 240 || scanLine(normalized, undefined).length > 0) {
    return "[redacted-path]";
  }
  return normalized;
}

function scanWorkingDocument(gitPath: string, text: string): readonly string[] {
  const outputPath = printablePath(gitPath);
  const findings: string[] = [];
  const lines = text.split(/\r\n|\n|\r/u);
  lines.forEach((line, index) => {
    for (const code of scanLine(line, gitPath)) {
      findings.push(`working-tree:${outputPath}:${index + 1}:${code}`);
    }
  });
  for (const line of privateKeyStartLines(text)) {
    findings.push(`working-tree:${outputPath}:${line}:private-key`);
  }
  return findings;
}

async function scanWorkingTree(root: string): Promise<readonly string[]> {
  const output = await runGit(root, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  const paths = [...new Set(decodeGitText(output).split("\0").filter(Boolean))].sort();
  const findings: string[] = [];
  for (const gitPath of paths) {
    const text = await readSelectedText(root, gitPath);
    if (text !== undefined) findings.push(...scanWorkingDocument(gitPath, text));
  }
  return findings;
}

type HistoryRecord = Readonly<{
  text: string;
  gitPath: string | undefined;
  group: string;
}>;

function parseDiffPath(line: string, marker: string): string | undefined {
  if (line === `${marker}/dev/null`) return undefined;
  return line.startsWith(marker) ? line.slice(marker.length) : undefined;
}

function scanHistory(log: string): readonly string[] {
  const findings: string[] = [];
  let commit: string | undefined;
  let inPatch = false;
  let oldPath: string | undefined;
  let newPath: string | undefined;
  let records: HistoryRecord[] = [];

  const flush = (): void => {
    if (commit === undefined) return;
    const privateKeyGroups = new Map<string, string[]>();
    for (const record of records) {
      for (const code of scanLine(record.text, record.gitPath)) {
        findings.push(`history:${commit}:${code}`);
      }
      const group = privateKeyGroups.get(record.group) ?? [];
      group.push(record.text);
      privateKeyGroups.set(record.group, group);
    }
    for (const lines of privateKeyGroups.values()) {
      if (hasPrivateKeyBlock(lines.join("\n"))) findings.push(`history:${commit}:private-key`);
    }
  };

  for (const line of log.split(/\r\n|\n|\r/u)) {
    const commitMatch = /^commit ([0-9a-f]{40,64})$/u.exec(line);
    if (commitMatch !== null) {
      flush();
      commit = commitMatch[1];
      inPatch = false;
      oldPath = undefined;
      newPath = undefined;
      records = [];
      continue;
    }
    if (commit === undefined) continue;
    if (line.startsWith("diff --git ")) {
      inPatch = true;
      oldPath = undefined;
      newPath = undefined;
      continue;
    }
    if (!inPatch) {
      records.push({ text: line, gitPath: undefined, group: "message" });
      continue;
    }
    if (line.startsWith("--- a/") || line === "--- /dev/null") {
      oldPath = parseDiffPath(line, "--- a/");
      continue;
    }
    if (line.startsWith("+++ b/") || line === "+++ /dev/null") {
      newPath = parseDiffPath(line, "+++ b/");
      continue;
    }
    if (line.startsWith("+")) {
      records.push({
        text: line.slice(1),
        gitPath: newPath,
        group: `added:${newPath ?? "[unknown]"}`,
      });
    } else if (line.startsWith("-")) {
      records.push({
        text: line.slice(1),
        gitPath: oldPath,
        group: `removed:${oldPath ?? "[unknown]"}`,
      });
    }
  }

  flush();
  return findings;
}

export type SecretScanOptions = Readonly<{ history?: boolean }>;

export async function scanRepositorySecrets(
  repositoryRoot: string,
  options: SecretScanOptions = {},
): Promise<readonly string[]> {
  try {
    const root = resolve(repositoryRoot);
    const findings = [...(await scanWorkingTree(root))];
    if (options.history === true) {
      const history = decodeGitText(
        await runGit(root, ["log", "-p", "--all", "--no-ext-diff", "--text"]),
      );
      findings.push(...scanHistory(history));
    }
    return [...new Set(findings)].sort();
  } catch {
    throw new Error(SECRET_SCAN_OPERATION_ERROR);
  }
}

export async function runRepositorySecretScanCli(
  args: readonly string[],
  repositoryRoot = process.cwd(),
): Promise<number> {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--history")) {
    console.error(SECRET_SCAN_USAGE);
    return 2;
  }
  try {
    const findings = await scanRepositorySecrets(repositoryRoot, {
      history: args[0] === "--history",
    });
    if (findings.length > 0) {
      findings.forEach((finding) => console.error(finding));
      return 1;
    }
    console.log(SECRET_SCAN_SUCCESS);
    return 0;
  } catch {
    console.error(SECRET_SCAN_OPERATION_ERROR);
    return 2;
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void runRepositorySecretScanCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
