import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  completeWithin,
  observeChild,
  requestProcessTreeTermination,
  type ObservedChild,
} from "./managed-process.js";

const SETTINGS_ERROR = "Midscene exploratory configuration is unavailable.";
const SUCCESS_MESSAGE = "Midscene exploratory run completed.\n";
const FAILURE_MESSAGE = "Midscene exploratory run failed.\n";
const DEFAULT_TIMEOUT_MS = 180_000;
const TERMINATION_TIMEOUT_MS = 10_000;
const MAX_SETTING_BYTES = 2_048;
const OS_ENVIRONMENT_ALLOWLIST = [
  "APPDATA",
  "CI",
  "COMSPEC",
  "FORCE_COLOR",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NEXT_TELEMETRY_DISABLED",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "USERPROFILE",
  "WINDIR",
] as const;

export interface MidsceneSettings {
  readonly baseUrl: string;
  readonly modelName: string;
  readonly modelFamily: string;
  readonly apiKey?: string;
}

const configurationError = (): Error => new Error(SETTINGS_ERROR);
const hasUnsafeControl = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });

const boundedSetting = (value: string | undefined): string => {
  if (
    value === undefined ||
    value.trim().length === 0 ||
    Buffer.byteLength(value, "utf8") > MAX_SETTING_BYTES ||
    hasUnsafeControl(value)
  ) {
    throw configurationError();
  }
  return value;
};

export function validateMidsceneEnvironment(env: NodeJS.ProcessEnv): MidsceneSettings {
  if (env.LINEAGEGUARD_MIDSCENE_EXPLORATORY !== "1") throw configurationError();
  const baseUrl = boundedSetting(env.MIDSCENE_MODEL_BASE_URL);
  const modelName = boundedSetting(env.MIDSCENE_MODEL_NAME);
  const modelFamily = boundedSetting(env.MIDSCENE_MODEL_FAMILY);
  if (baseUrl === "codex://app-server") {
    return { baseUrl, modelName, modelFamily };
  }
  return {
    baseUrl,
    modelName,
    modelFamily,
    apiKey: boundedSetting(env.MIDSCENE_MODEL_API_KEY),
  };
}

export function buildMidsceneChildEnvironment(
  env: NodeJS.ProcessEnv,
  cwd: string,
): NodeJS.ProcessEnv {
  const settings = validateMidsceneEnvironment(env);
  const child: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of OS_ENVIRONMENT_ALLOWLIST) {
    const value = env[key];
    if (value !== undefined) child[key] = value;
  }
  child.LINEAGEGUARD_MIDSCENE_EXPLORATORY = "1";
  child.MIDSCENE_MODEL_BASE_URL = settings.baseUrl;
  child.MIDSCENE_MODEL_NAME = settings.modelName;
  child.MIDSCENE_MODEL_FAMILY = settings.modelFamily;
  if (settings.apiKey !== undefined) child.MIDSCENE_MODEL_API_KEY = settings.apiKey;
  child.MIDSCENE_MODEL_TIMEOUT = "60000";
  child.MIDSCENE_MODEL_RETRY_COUNT = "0";
  child.MIDSCENE_RUN_DIR = resolve(cwd, ".tmp", "midscene", "run");
  return child;
}

const ensureRunRoot = async (cwd: string): Promise<void> => {
  const canonicalCwd = await realpath(cwd);
  const target = resolve(canonicalCwd, ".tmp", "midscene", "run");
  const targetRelative = relative(canonicalCwd, target);
  if (
    isAbsolute(targetRelative) ||
    targetRelative === ".." ||
    targetRelative.startsWith(`..${sep}`)
  ) {
    throw configurationError();
  }
  let current = canonicalCwd;
  for (const segment of targetRelative.split(sep)) {
    current = join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw configurationError();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current);
    }
  }
};

type SpawnChild = (
  cli: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  cwd: string,
) => ChildProcess;

export interface RunMidsceneExploratoryOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly resolveCli?: () => string;
  readonly spawnChild?: SpawnChild;
  readonly terminate?: (observed: ObservedChild) => Promise<void>;
  readonly write?: (value: string) => void;
}

const defaultResolveCli = (): string =>
  createRequire(import.meta.url).resolve("@playwright/test/cli");

const defaultSpawnChild: SpawnChild = (cli, args, environment, cwd) =>
  spawn(process.execPath, [cli, ...args], {
    cwd,
    detached: process.platform !== "win32",
    env: environment,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

export async function runMidsceneExploratory(
  options: RunMidsceneExploratoryOptions,
): Promise<0 | 1> {
  const write = options.write ?? ((value: string) => process.stdout.write(value));
  try {
    const environment = buildMidsceneChildEnvironment(options.env, options.cwd);
    await ensureRunRoot(options.cwd);
    const cli = (options.resolveCli ?? defaultResolveCli)();
    const child = (options.spawnChild ?? defaultSpawnChild)(
      cli,
      ["test", "--config=playwright.midscene.config.ts"],
      environment,
      options.cwd,
    );
    child.stdout?.resume();
    child.stderr?.resume();
    const observed = observeChild(child);
    const outcome = await completeWithin(
      Promise.race([
        observed.close.then(() => "close" as const),
        observed.error.then(() => "error" as const),
      ]),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    if (!outcome.completed) {
      await (
        options.terminate ??
        (async (target: ObservedChild) =>
          await requestProcessTreeTermination(target, {
            platform: process.platform,
            timeoutMs: TERMINATION_TIMEOUT_MS,
          }))
      )(observed);
      write(FAILURE_MESSAGE);
      return 1;
    }
    if (outcome.value !== "close" || child.exitCode !== 0) {
      write(FAILURE_MESSAGE);
      return 1;
    }
    write(SUCCESS_MESSAGE);
    return 0;
  } catch {
    write(FAILURE_MESSAGE);
    return 1;
  }
}
