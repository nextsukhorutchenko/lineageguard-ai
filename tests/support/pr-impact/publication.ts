import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  ImpactContextSchema,
  MAX_REPORT_JSON_BYTES,
  MAX_REPORT_MARKDOWN_BYTES,
  type ImpactContext,
} from "./contracts.js";

export const IMPACT_CONTEXT_PATH = ".tmp/pr-impact/context.json";
export const IMPACT_REPORT_JSON_PATH = "test-results/pr-impact/report.json";
export const IMPACT_REPORT_MARKDOWN_PATH = "test-results/pr-impact/report.md";

const unavailable = (): Error => new Error("PR impact publication is unavailable.");
const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

const ensureDirectory = async (cwd: string, repositoryRelativePath: string): Promise<string> => {
  const canonicalCwd = await realpath(cwd);
  const target = resolve(canonicalCwd, repositoryRelativePath);
  const targetRelative = relative(canonicalCwd, target);
  if (
    targetRelative.length === 0 ||
    isAbsolute(targetRelative) ||
    targetRelative === ".." ||
    targetRelative.startsWith(`..${sep}`)
  ) {
    throw unavailable();
  }

  let current = canonicalCwd;
  for (const segment of targetRelative.split(sep)) {
    current = join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw unavailable();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current);
    }
  }
  const canonicalTarget = await realpath(target);
  if (canonicalTarget !== target) throw unavailable();
  return target;
};

const assertStoredBytes = async (path: string, expected: number): Promise<void> => {
  const stored = await readFile(path);
  if (stored.length !== expected) throw unavailable();
};

export async function publishImpactContext(context: ImpactContext, cwd: string): Promise<void> {
  let temporaryPath: string | undefined;
  try {
    const validated = ImpactContextSchema.parse(context);
    const content = `${JSON.stringify(validated, null, 2)}\n`;
    if (byteLength(content) > MAX_REPORT_JSON_BYTES) throw unavailable();
    const parent = await ensureDirectory(cwd, dirname(IMPACT_CONTEXT_PATH));
    temporaryPath = join(parent, `.context-${randomUUID()}.tmp`);
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    await assertStoredBytes(temporaryPath, byteLength(content));
    await rename(temporaryPath, join(parent, "context.json"));
    temporaryPath = undefined;
  } catch {
    if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw unavailable();
  }
}

export async function prepareImpactReportPublication(cwd: string): Promise<void> {
  try {
    const reportParent = await ensureDirectory(cwd, "test-results");
    const finalDirectory = join(reportParent, "pr-impact");
    try {
      const stat = await lstat(finalDirectory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw unavailable();
      if ((await realpath(finalDirectory)) !== finalDirectory) throw unavailable();
      await rm(finalDirectory, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  } catch {
    throw unavailable();
  }
}

export async function publishImpactReport(
  json: string,
  markdown: string,
  cwd: string,
): Promise<void> {
  let stagingDirectory: string | undefined;
  try {
    if (
      byteLength(json) > MAX_REPORT_JSON_BYTES ||
      byteLength(markdown) > MAX_REPORT_MARKDOWN_BYTES
    ) {
      throw unavailable();
    }
    const reportParent = await ensureDirectory(cwd, "test-results");
    const finalDirectory = join(reportParent, "pr-impact");
    try {
      await lstat(finalDirectory);
      throw unavailable();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    stagingDirectory = join(reportParent, `.pr-impact-${randomUUID()}.tmp`);
    await mkdir(stagingDirectory);
    const jsonPath = join(stagingDirectory, "report.json");
    const markdownPath = join(stagingDirectory, "report.md");
    await writeFile(jsonPath, json, { encoding: "utf8", flag: "wx" });
    await writeFile(markdownPath, markdown, { encoding: "utf8", flag: "wx" });
    await assertStoredBytes(jsonPath, byteLength(json));
    await assertStoredBytes(markdownPath, byteLength(markdown));
    await rename(stagingDirectory, finalDirectory);
    stagingDirectory = undefined;
  } catch {
    if (stagingDirectory) {
      await rm(stagingDirectory, { force: true, recursive: true }).catch(() => undefined);
    }
    throw unavailable();
  }
}
