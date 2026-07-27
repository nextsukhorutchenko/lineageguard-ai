import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { assertTrustedRunsRoot } from "../artifacts/run-envelope-files.js";
import { loadWebConfig } from "../config/web-config.js";

const PRIVATE_ROOT_MODE = 0o700;
const PORT_PATTERN = /^\d+$/u;
const CHILD_ENVIRONMENT_ALLOWLIST = [
  "APPDATA",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "USERPROFILE",
  "WINDIR",
] as const;

interface RootStats {
  readonly dev: number;
  readonly ino: number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

interface DirectoryHandle {
  stat(): Promise<RootStats>;
  chmod(mode: number): Promise<void>;
  close(): Promise<void>;
}

export interface PublicReplayBootstrapDependencies {
  readonly mkdir: (path: string, options: { readonly mode: number }) => Promise<void>;
  readonly lstat: (path: string) => Promise<RootStats>;
  readonly realpath: (path: string) => Promise<string>;
  readonly access: (path: string, mode?: number) => Promise<void>;
  readonly openDirectory: (path: string, flags: number) => Promise<DirectoryHandle>;
  readonly isAbsolute: (path: string) => boolean;
  readonly resolvePath: (path: string) => string;
  readonly relativePath: (from: string, to: string) => string;
  readonly platform: NodeJS.Platform;
  readonly directoryOpenFlags: number;
  readonly writableAccessMode: number;
  readonly assertRunsRoot: (runsRoot: string) => Promise<string>;
}

export interface PublicReplayPreparedEnvironment {
  readonly port: number;
  readonly runsRoot: string;
  readonly childEnvironment: NodeJS.ProcessEnv;
}

type PublicReplayShutdownSignal = "SIGINT" | "SIGTERM";

export interface PublicReplayProcessBoundary {
  readonly execPath: string;
  cwd(): string;
  on(signal: PublicReplayShutdownSignal, listener: () => void): unknown;
  off(signal: PublicReplayShutdownSignal, listener: () => void): unknown;
}

export interface PublicReplaySpawnOptions {
  readonly cwd: string;
  readonly detached: false;
  readonly env: NodeJS.ProcessEnv;
  readonly shell: false;
  readonly stdio: "ignore";
  readonly windowsHide: true;
}

export interface PublicReplayServerDependencies extends PublicReplayBootstrapDependencies {
  readonly processBoundary: PublicReplayProcessBoundary;
  readonly resolveModule: (specifier: string) => string;
  readonly spawnChild: (
    command: string,
    args: readonly string[],
    options: PublicReplaySpawnOptions,
  ) => ChildProcess;
}

function optionalOpenFlag(name: string): number {
  const value = (constants as unknown as Readonly<Record<string, unknown>>)[name];
  return typeof value === "number" ? value : 0;
}

const defaultBootstrapDependencies: PublicReplayBootstrapDependencies = {
  mkdir: async (path, options) => {
    await mkdir(path, options);
  },
  lstat,
  realpath,
  access,
  openDirectory: async (path, flags) => {
    const handle = await open(path, flags);
    return {
      stat: async () => await handle.stat(),
      chmod: async (mode) => await handle.chmod(mode),
      close: async () => await handle.close(),
    };
  },
  isAbsolute,
  resolvePath: resolve,
  relativePath: relative,
  platform: process.platform,
  directoryOpenFlags:
    constants.O_RDONLY | optionalOpenFlag("O_NOFOLLOW") | optionalOpenFlag("O_DIRECTORY"),
  writableAccessMode: constants.W_OK,
  assertRunsRoot: assertTrustedRunsRoot,
};

const defaultProcessBoundary: PublicReplayProcessBoundary = {
  execPath: process.execPath,
  cwd: () => process.cwd(),
  on: (signal, listener) => process.on(signal, listener),
  off: (signal, listener) => process.off(signal, listener),
};

const defaultServerDependencies: PublicReplayServerDependencies = {
  ...defaultBootstrapDependencies,
  processBoundary: defaultProcessBoundary,
  resolveModule: (specifier) => createRequire(import.meta.url).resolve(specifier),
  spawnChild: (command, args, options) => spawn(command, args, options),
};

function invalidEnvironment(): Error {
  return new Error("Public replay environment is invalid.");
}

function serverStartupFailure(): Error {
  return new Error("Public replay server failed to start.");
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === code
  );
}

function parsePort(value: string | undefined): number {
  if (value === undefined || !PORT_PATTERN.test(value)) throw invalidEnvironment();
  const port = Number.parseInt(value, 10);
  if (port < 1 || port > 65_535) throw invalidEnvironment();
  return port;
}

function buildChildEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>,
  port: number,
  runsRoot: string,
): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const key of CHILD_ENVIRONMENT_ALLOWLIST) {
    const value = environment[key];
    if (value !== undefined) childEnvironment[key] = value;
  }
  childEnvironment.PORT = String(port);
  childEnvironment.LINEAGEGUARD_DEMO_MODE = "REPLAY";
  childEnvironment.LINEAGEGUARD_DEPLOYMENT_PROFILE = "PUBLIC_REPLAY";
  childEnvironment.LINEAGEGUARD_RUNS_DIR = runsRoot;
  childEnvironment.NEXT_TELEMETRY_DISABLED = "1";
  return childEnvironment;
}

function assertRealDirectory(stats: RootStats): void {
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw invalidEnvironment();
}

function assertSameIdentity(expected: RootStats, actual: RootStats): void {
  assertRealDirectory(actual);
  if (expected.dev !== actual.dev || expected.ino !== actual.ino) {
    throw invalidEnvironment();
  }
}

async function validateRootPath(
  configuredRoot: string,
  expectedIdentity: RootStats,
  operations: PublicReplayBootstrapDependencies,
): Promise<string> {
  assertSameIdentity(expectedIdentity, await operations.lstat(configuredRoot));
  const canonicalRoot = await operations.realpath(configuredRoot);
  if (operations.relativePath(configuredRoot, canonicalRoot) !== "") {
    throw invalidEnvironment();
  }
  await operations.access(canonicalRoot, operations.writableAccessMode);
  const trustedRoot = await operations.assertRunsRoot(configuredRoot);
  if (operations.relativePath(canonicalRoot, trustedRoot) !== "") {
    throw invalidEnvironment();
  }
  assertSameIdentity(expectedIdentity, await operations.lstat(configuredRoot));
  return trustedRoot;
}

export async function preparePublicReplayEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>,
  dependencies: Partial<PublicReplayBootstrapDependencies> = {},
): Promise<PublicReplayPreparedEnvironment> {
  const operations = { ...defaultBootstrapDependencies, ...dependencies };
  try {
    const port = parsePort(environment.PORT);
    const config = loadWebConfig(environment);
    if (config.mode !== "REPLAY" || config.deploymentProfile !== "PUBLIC_REPLAY") {
      throw invalidEnvironment();
    }
    if (!operations.isAbsolute(config.runsRoot)) throw invalidEnvironment();

    try {
      await operations.mkdir(config.runsRoot, { mode: PRIVATE_ROOT_MODE });
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
    }

    const configuredRoot = operations.resolvePath(config.runsRoot);
    const configuredStats = await operations.lstat(configuredRoot);
    assertRealDirectory(configuredStats);
    const initialCanonicalRoot = await operations.realpath(configuredRoot);
    if (operations.relativePath(configuredRoot, initialCanonicalRoot) !== "") {
      throw invalidEnvironment();
    }

    let trustedRoot: string;
    if (operations.platform === "win32") {
      trustedRoot = await validateRootPath(configuredRoot, configuredStats, operations);
    } else {
      const handle = await operations.openDirectory(configuredRoot, operations.directoryOpenFlags);
      try {
        const openedStats = await handle.stat();
        assertSameIdentity(configuredStats, openedStats);
        await handle.chmod(PRIVATE_ROOT_MODE);
        trustedRoot = await validateRootPath(configuredRoot, openedStats, operations);
      } finally {
        await handle.close();
      }
    }

    return {
      port,
      runsRoot: trustedRoot,
      childEnvironment: buildChildEnvironment(environment, port, trustedRoot),
    };
  } catch {
    throw invalidEnvironment();
  }
}

function closeExitCode(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return 1;
}

function waitForChildClose(
  child: ChildProcess,
  processBoundary: PublicReplayProcessBoundary,
): Promise<number> {
  return new Promise<number>((resolveClose, rejectClose) => {
    let settled = false;
    let shutdownForwarded = false;
    let spawned = false;
    let startupFailed = false;

    const onSigint = (): void => {
      forwardShutdown("SIGINT");
    };
    const onSigterm = (): void => {
      forwardShutdown("SIGTERM");
    };
    const cleanup = (): void => {
      child.off("spawn", onSpawn);
      child.off("error", onError);
      child.off("close", onClose);
      processBoundary.off("SIGINT", onSigint);
      processBoundary.off("SIGTERM", onSigterm);
    };
    const forwardShutdown = (signal: PublicReplayShutdownSignal): void => {
      if (settled || shutdownForwarded) return;
      shutdownForwarded = true;
      try {
        child.kill(signal);
      } catch {
        // Child close or error remains the only lifecycle authority.
      }
    };
    const onSpawn = (): void => {
      spawned = true;
    };
    const onError = (): void => {
      if (settled || startupFailed || spawned) return;
      startupFailed = true;
      forwardShutdown("SIGTERM");
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (startupFailed) {
        rejectClose(serverStartupFailure());
      } else {
        resolveClose(closeExitCode(code, signal));
      }
    };

    child.once("spawn", onSpawn);
    child.on("error", onError);
    child.once("close", onClose);
    processBoundary.on("SIGINT", onSigint);
    processBoundary.on("SIGTERM", onSigterm);
  });
}

export async function runPublicReplayServer(
  environment: Readonly<NodeJS.ProcessEnv>,
  dependencies: Partial<PublicReplayServerDependencies> = {},
): Promise<number> {
  const operations = { ...defaultServerDependencies, ...dependencies };
  const prepared = await preparePublicReplayEnvironment(environment, dependencies);

  let child: ChildProcess;
  try {
    const nextCli = operations.resolveModule("next/dist/bin/next");
    child = operations.spawnChild(
      operations.processBoundary.execPath,
      [nextCli, "start", "-H", "0.0.0.0", "-p", String(prepared.port)],
      {
        cwd: operations.processBoundary.cwd(),
        detached: false,
        env: prepared.childEnvironment,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      },
    );
  } catch {
    throw serverStartupFailure();
  }

  return await waitForChildClose(child, operations.processBoundary);
}
