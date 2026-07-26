import { execFile } from "node:child_process";
import { ImpactContextSchema, type ImpactContext } from "./contracts.js";
import { classifyChangedPaths } from "./impact-map.js";
import { SCENARIO_TAGS } from "./scenario-tags.js";

const GIT_OUTPUT_CAP = 256 * 1_024;
const FULL_SHA = /^[0-9a-f]{40}$/u;

export interface GitDiffExecutor {
  (cwd: string, baseSha: string, headSha: string): Promise<Buffer>;
}

export interface PrepareImpactContextOptions {
  readonly cwd: string;
  readonly eventName: string | undefined;
  readonly baseSha: string | undefined;
  readonly headSha: string | undefined;
  readonly executeGit?: GitDiffExecutor;
}

const unavailableContext = (
  source: ImpactContext["source"],
  reason: "GIT_COMPARISON_UNAVAILABLE" | "NON_PULL_REQUEST",
): ImpactContext =>
  ImpactContextSchema.parse({
    schemaVersion: "1",
    source,
    disposition: "FULL_SUITE_REQUIRED",
    changedPaths: [],
    impactedAreas: [],
    expectedTags: [...SCENARIO_TAGS],
    reasonCodes: [reason],
  });

export const executeGitDiff: GitDiffExecutor = async (cwd, baseSha, headSha) =>
  await new Promise<Buffer>((resolve, reject) => {
    execFile(
      "git",
      ["diff", "--name-only", "-z", "--diff-filter=ACMR", `${baseSha}...${headSha}`, "--"],
      {
        cwd,
        encoding: "buffer",
        maxBuffer: GIT_OUTPUT_CAP,
        shell: false,
        timeout: 10_000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });

export async function prepareImpactContext(
  options: PrepareImpactContextOptions,
): Promise<ImpactContext> {
  if (options.eventName !== "pull_request") {
    return unavailableContext("IMPACT_CONTEXT_UNAVAILABLE", "NON_PULL_REQUEST");
  }
  if (
    options.baseSha === undefined ||
    options.headSha === undefined ||
    !FULL_SHA.test(options.baseSha) ||
    !FULL_SHA.test(options.headSha)
  ) {
    return unavailableContext("PULL_REQUEST", "GIT_COMPARISON_UNAVAILABLE");
  }

  try {
    const output = await (options.executeGit ?? executeGitDiff)(
      options.cwd,
      options.baseSha,
      options.headSha,
    );
    if (output.length === 0 || output.length > GIT_OUTPUT_CAP || output.at(-1) !== 0) {
      return unavailableContext("PULL_REQUEST", "GIT_COMPARISON_UNAVAILABLE");
    }
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(output);
    const segments = decoded.split("\0");
    if (segments.pop() !== "") {
      return unavailableContext("PULL_REQUEST", "GIT_COMPARISON_UNAVAILABLE");
    }
    const classification = classifyChangedPaths(segments);
    return ImpactContextSchema.parse({
      schemaVersion: "1",
      source: "PULL_REQUEST",
      ...classification,
    });
  } catch {
    return unavailableContext("PULL_REQUEST", "GIT_COMPARISON_UNAVAILABLE");
  }
}
