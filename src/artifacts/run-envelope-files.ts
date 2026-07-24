import { randomBytes } from "node:crypto";
import { access, constants, link, lstat, open, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { AppError } from "../errors/app-error.js";
import {
  MAX_RETRY_RESERVATION_BYTES,
  MAX_RUN_ENVELOPE_BYTES,
  SafeRunIdSchema,
  parseRetryReservation,
  parseRunEnvelope,
  type RetryReservationEnvelope,
  type RunEnvelope,
} from "../runs/run-envelope.js";

const MAX_TEMPORARY_FILE_ATTEMPTS = 3;

const runFilename = (runId: string): string => `run-${runId}.json`;
const reservationFilename = (parentRunId: string): string => `retry-${parentRunId}.json`;
const temporaryFilename = (kind: "run" | "retry", nonce: string): string =>
  `.tmp-${kind}-${nonce}.json`;

interface FileStats {
  readonly dev: number;
  readonly ino: number;
  readonly size?: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface EnvelopeFileHandle {
  stat(): Promise<FileStats>;
  write(
    buffer: string,
    offset: number,
    encoding: BufferEncoding,
  ): Promise<{ readonly bytesWritten: number }>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesRead: number }>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

interface FileOperations {
  access(path: string, mode?: number): Promise<void>;
  lstat(path: string): Promise<FileStats>;
  realpath(path: string): Promise<string>;
  open(path: string, flags: string, mode?: number): Promise<EnvelopeFileHandle>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

interface FileOperationOverrides {
  readonly access?: FileOperations["access"];
  readonly lstat?: FileOperations["lstat"];
  readonly realpath?: FileOperations["realpath"];
  readonly open?: FileOperations["open"];
  readonly link?: FileOperations["link"];
  readonly unlink?: FileOperations["unlink"];
}

interface BoundaryDependencies {
  readonly nonce?: () => string;
  readonly operations?: FileOperationOverrides;
}

export interface RunEnvelopePublicationHooks {
  readonly beforePublish?: () => void | Promise<void>;
  readonly afterPublish?: () => void | Promise<void>;
}

interface PublishCreateOnlyOptions {
  readonly root: string;
  readonly kind: "run" | "retry";
  readonly finalName: string;
  readonly serialized: string;
  readonly signal?: AbortSignal;
  readonly hooks?: RunEnvelopePublicationHooks;
}

interface TemporaryIdentity {
  readonly dev: number;
  readonly ino: number;
}

class FinalNameCollision extends Error {}

const cancellationErrors = new WeakSet<AppError>();

function writeFailure(): AppError {
  return new AppError("ARTIFACT_WRITE_FAILED", "Unable to persist the run.");
}

function runUnavailable(): AppError {
  return new AppError("ARTIFACT_WRITE_FAILED", "The stored run is unavailable.");
}

function reservationUnavailable(): AppError {
  return new AppError("ARTIFACT_WRITE_FAILED", "The stored retry reservation is unavailable.");
}

function runCollision(): AppError {
  return new AppError("ARTIFACT_WRITE_FAILED", "The run already exists.");
}

function reservationCollision(): AppError {
  return new AppError("INVALID_REQUEST", "The parent run cannot be regenerated.");
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const error = new AppError("CANCELLED", "The run was cancelled.");
  cancellationErrors.add(error);
  throw error;
}

const realFileOperations: FileOperations = {
  access,
  lstat,
  realpath,
  open,
  link,
  unlink,
};

function createRunEnvelopeFileBoundary(dependencies: BoundaryDependencies = {}) {
  const operations: FileOperations = {
    ...realFileOperations,
    ...dependencies.operations,
  };
  const nextNonce = dependencies.nonce ?? (() => randomBytes(16).toString("hex"));

  async function assertTrustedRunsRootBound(runsRoot: string): Promise<string> {
    try {
      if (!isAbsolute(runsRoot)) throw new Error("Runs root must be absolute.");
      const configured = resolve(runsRoot);
      const configuredStats = await operations.lstat(configured);
      if (configuredStats.isSymbolicLink() || !configuredStats.isDirectory()) {
        throw new Error("Runs root must be a real directory.");
      }
      const canonical = await operations.realpath(configured);
      if (relative(configured, canonical) !== "") {
        throw new Error("Runs root does not resolve to itself.");
      }
      await operations.access(canonical, constants.W_OK);
      return canonical;
    } catch {
      throw writeFailure();
    }
  }

  async function removeOwnTemporaryFileByIdentity(
    temporaryPath: string,
    identity: TemporaryIdentity,
  ): Promise<void> {
    const current = await operations.lstat(temporaryPath);
    if (
      current.isFile() &&
      !current.isSymbolicLink() &&
      current.dev === identity.dev &&
      current.ino === identity.ino
    ) {
      await operations.unlink(temporaryPath);
    }
  }

  async function openUniqueTemporary(
    root: string,
    kind: "run" | "retry",
  ): Promise<{ readonly handle: EnvelopeFileHandle; readonly path: string }> {
    for (let attempt = 0; attempt < MAX_TEMPORARY_FILE_ATTEMPTS; attempt += 1) {
      const temporaryPath = join(root, temporaryFilename(kind, nextNonce()));
      try {
        const handle = await operations.open(temporaryPath, "wx", 0o600);
        return { handle, path: temporaryPath };
      } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) throw error;
      }
    }
    throw new Error("Temporary file creation failed.");
  }

  async function publishCreateOnly(options: PublishCreateOnlyOptions): Promise<void> {
    const temporary = await openUniqueTemporary(options.root, options.kind);
    let temporaryIdentity: TemporaryIdentity | undefined;
    let published = false;
    try {
      const openedStats = await temporary.handle.stat();
      if (!openedStats.isFile() || openedStats.isSymbolicLink()) {
        throw new Error("Temporary entry is not a regular file.");
      }
      temporaryIdentity = { dev: openedStats.dev, ino: openedStats.ino };

      throwIfCancelled(options.signal);
      const result = await temporary.handle.write(options.serialized, 0, "utf8");
      if (result.bytesWritten !== Buffer.byteLength(options.serialized, "utf8")) {
        throw new Error("Short write.");
      }
      await temporary.handle.sync();
      throwIfCancelled(options.signal);
      await options.hooks?.beforePublish?.();
      throwIfCancelled(options.signal);
      try {
        await operations.link(temporary.path, join(options.root, options.finalName));
      } catch (error) {
        if (hasErrorCode(error, "EEXIST")) throw new FinalNameCollision();
        throw error;
      }
      published = true;
      try {
        await options.hooks?.afterPublish?.();
      } catch {
        // A published immutable envelope remains authoritative.
      }
    } catch (error) {
      if (!published) throw error;
    } finally {
      await temporary.handle.close().catch(() => undefined);
      if (temporaryIdentity !== undefined) {
        await removeOwnTemporaryFileByIdentity(temporary.path, temporaryIdentity).catch(
          () => undefined,
        );
      }
    }
  }

  async function publishRunEnvelopeBound(options: {
    readonly runsRoot: string;
    readonly runId: string;
    readonly serialized: string;
    readonly signal?: AbortSignal;
    readonly hooks?: RunEnvelopePublicationHooks;
  }): Promise<void> {
    try {
      parseRunEnvelope(options.serialized, options.runId);
    } catch {
      throw writeFailure();
    }

    try {
      const root = await assertTrustedRunsRootBound(options.runsRoot);
      await publishCreateOnly({
        root,
        kind: "run",
        finalName: runFilename(options.runId),
        serialized: options.serialized,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
      });
    } catch (error) {
      if (error instanceof FinalNameCollision) throw runCollision();
      if (error instanceof AppError && cancellationErrors.has(error)) throw error;
      throw writeFailure();
    }
  }

  async function publishRetryReservationBound(options: {
    readonly runsRoot: string;
    readonly parentRunId: string;
    readonly serialized: string;
    readonly signal?: AbortSignal;
    readonly hooks?: RunEnvelopePublicationHooks;
  }): Promise<void> {
    try {
      parseRetryReservation(options.serialized, options.parentRunId);
    } catch {
      throw writeFailure();
    }

    try {
      const root = await assertTrustedRunsRootBound(options.runsRoot);
      await publishCreateOnly({
        root,
        kind: "retry",
        finalName: reservationFilename(options.parentRunId),
        serialized: options.serialized,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
      });
    } catch (error) {
      if (error instanceof FinalNameCollision) throw reservationCollision();
      if (error instanceof AppError && cancellationErrors.has(error)) throw error;
      throw writeFailure();
    }
  }

  async function readBounded(finalPath: string, maximumBytes: number): Promise<string> {
    const pathStats = await operations.lstat(finalPath);
    if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
      throw new Error("Final entry is not a regular file.");
    }

    const handle = await operations.open(finalPath, "r");
    try {
      const openedStats = await handle.stat();
      if (
        openedStats.isSymbolicLink() ||
        !openedStats.isFile() ||
        openedStats.size === undefined ||
        openedStats.size > maximumBytes
      ) {
        throw new Error("Final file is unavailable.");
      }

      const buffer = Buffer.alloc(maximumBytes + 1);
      let total = 0;
      while (total < buffer.length) {
        const result = await handle.read(buffer, total, buffer.length - total, total);
        if (result.bytesRead === 0) break;
        total += result.bytesRead;
      }
      if (total > maximumBytes) throw new Error("Final file exceeds its byte limit.");
      return buffer.subarray(0, total).toString("utf8");
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  async function readRunEnvelopeBound(options: {
    readonly runsRoot: string;
    readonly runId: string;
  }): Promise<RunEnvelope> {
    try {
      SafeRunIdSchema.parse(options.runId);
      const root = await assertTrustedRunsRootBound(options.runsRoot);
      const serialized = await readBounded(
        join(root, runFilename(options.runId)),
        MAX_RUN_ENVELOPE_BYTES,
      );
      return parseRunEnvelope(serialized, options.runId);
    } catch {
      throw runUnavailable();
    }
  }

  async function readRetryReservationBound(options: {
    readonly runsRoot: string;
    readonly parentRunId: string;
  }): Promise<RetryReservationEnvelope> {
    try {
      SafeRunIdSchema.parse(options.parentRunId);
      const root = await assertTrustedRunsRootBound(options.runsRoot);
      const serialized = await readBounded(
        join(root, reservationFilename(options.parentRunId)),
        MAX_RETRY_RESERVATION_BYTES,
      );
      return parseRetryReservation(serialized, options.parentRunId);
    } catch {
      throw reservationUnavailable();
    }
  }

  return Object.freeze({
    assertTrustedRunsRoot: assertTrustedRunsRootBound,
    publishRunEnvelope: publishRunEnvelopeBound,
    readRunEnvelope: readRunEnvelopeBound,
    publishRetryReservation: publishRetryReservationBound,
    readRetryReservation: readRetryReservationBound,
  });
}

const productionBoundary = createRunEnvelopeFileBoundary();

export const assertTrustedRunsRoot = productionBoundary.assertTrustedRunsRoot;
export const publishRunEnvelope = productionBoundary.publishRunEnvelope;
export const readRunEnvelope = productionBoundary.readRunEnvelope;
export const publishRetryReservation = productionBoundary.publishRetryReservation;
export const readRetryReservation = productionBoundary.readRetryReservation;

export const __testOnly = Object.freeze({ createRunEnvelopeFileBoundary });
