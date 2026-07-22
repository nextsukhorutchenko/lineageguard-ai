import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { AppError } from "../errors/app-error.js";

export async function writeRunArtifact(options: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly filename: "impact-report.md";
  readonly content: string;
}): Promise<string> {
  const root = resolve(options.runsRoot);
  const output = resolve(root, options.runId, options.filename);
  const fromRoot = relative(root, output);

  if (
    isAbsolute(fromRoot) ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new AppError("ARTIFACT_WRITE_FAILED", "The artifact path escapes the runs directory.");
  }

  try {
    await mkdir(resolve(root, options.runId), { recursive: true });
    await writeFile(output, options.content, { encoding: "utf8", flag: "wx" });
    return output;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("ARTIFACT_WRITE_FAILED", `Unable to write ${output}.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
