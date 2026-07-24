import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format } from "prettier";
import { z } from "zod";
import {
  loadRuntimeConfig,
  type EnvironmentMap,
  type RuntimeConfig,
} from "../src/config/runtime-config.js";
import type { CollectionResult } from "../src/datahub/catalog.js";
import { DataHubMcpCatalog } from "../src/datahub/mcp/datahub-mcp-catalog.js";
import { connectDataHubMcp } from "../src/datahub/mcp/mcp-client.js";
import type { EntityContext, LineageAsset, SchemaField } from "../src/domain/evidence.js";
import type { DatasetCandidate } from "../src/domain/resolve-dataset.js";
import { redact } from "../src/security/redact.js";

const DATASET_URN =
  "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)";
const DATASET_HINT = "order+details";

export const fixtureFileNames = [
  "search-order-details.json",
  "schema-order-details.json",
  "lineage-order-details-table.json",
  "lineage-order-details-customer-id.json",
  "entity-context-order-details-impact.json",
] as const;

export const fixtureCompletionMarker = ".complete";
export const fixtureCaptureRepositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));

const candidateNamePattern = /^capture-[A-Za-z0-9_-]+$/;

export interface FixtureCaptureMarkerHandle {
  close(): Promise<void>;
}

export interface FixtureCaptureTextWriter {
  write(text: string): unknown;
}

export interface FixtureCaptureCliDependencies {
  readonly repositoryRoot: string;
  readonly environment: EnvironmentMap;
  readonly stdout: FixtureCaptureTextWriter;
  readonly createDirectory: (path: string) => Promise<void>;
  readonly createCandidateDirectory: (prefix: string) => Promise<string>;
  readonly capture: typeof captureDataHubFixtures;
  readonly openCompletionMarker: (path: string) => Promise<FixtureCaptureMarkerHandle>;
  readonly beforeCleanupRemoval?: (path: string) => Promise<void>;
  readonly removeCandidateEntry: (path: string) => Promise<void>;
  readonly removeCandidate: (path: string) => Promise<void>;
}

export interface FixtureCaptureCliResult {
  readonly destination: string;
  readonly written: readonly CapturedFixture[];
}

export interface CapturedFixture {
  readonly path: string;
  readonly basename: (typeof fixtureFileNames)[number];
}

export interface FixturePayloads {
  readonly candidates: CollectionResult<DatasetCandidate>;
  readonly fields: CollectionResult<SchemaField>;
  readonly tableLineage: CollectionResult<LineageAsset>;
  readonly columnLineage: CollectionResult<LineageAsset>;
  readonly entityContext: CollectionResult<EntityContext, string>;
}

const compareEnglish = (left: string, right: string): number => left.localeCompare(right, "en-US");
const compareCandidate = (left: DatasetCandidate, right: DatasetCandidate): number =>
  compareEnglish(left.urn, right.urn) || compareEnglish(left.name, right.name);
const compareField = (left: SchemaField, right: SchemaField): number =>
  compareEnglish(left.fieldPath, right.fieldPath);
const compareLineage = (left: LineageAsset, right: LineageAsset): number =>
  compareEnglish(left.urn, right.urn) || left.hop - right.hop;

const canonicalizeCollection = <T, R extends string>(
  result: CollectionResult<T, R>,
  compare: (left: T, right: T) => number,
  normalize: (item: T) => T = (item) => item,
): CollectionResult<T, R> => ({
  items: result.items.map(normalize).toSorted(compare),
  completeness: result.completeness,
});

export function canonicalizeFixturePayloads(payloads: FixturePayloads): FixturePayloads {
  return {
    candidates: canonicalizeCollection(payloads.candidates, compareCandidate),
    fields: canonicalizeCollection(payloads.fields, compareField),
    tableLineage: canonicalizeCollection(payloads.tableLineage, compareLineage, (asset) => ({
      ...asset,
      lineageColumns: [...asset.lineageColumns].sort(compareEnglish),
    })),
    columnLineage: canonicalizeCollection(payloads.columnLineage, compareLineage, (asset) => ({
      ...asset,
      lineageColumns: [...asset.lineageColumns].sort(compareEnglish),
    })),
    entityContext: canonicalizeCollection(payloads.entityContext, (left, right) =>
      compareEnglish(left.urn, right.urn),
    ),
  };
}

const completenessSchema = z
  .object({
    complete: z.boolean(),
    pages: z.number().int().nonnegative(),
    itemCount: z.number().int().nonnegative(),
    offsets: z.array(z.number().int().nonnegative()),
    reasonCodes: z.array(z.string()),
  })
  .strict();
const collectionSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), completeness: completenessSchema }).strict();
const candidateSchema = z
  .object({
    urn: z.string(),
    name: z.string(),
    platform: z.string().optional(),
    environment: z.string().optional(),
  })
  .strict();
const fieldSchema = z
  .object({
    fieldPath: z.string(),
    nativeDataType: z.string().optional(),
    nullable: z.boolean().optional(),
    description: z.string().optional(),
  })
  .strict();
const lineageSchema = z
  .object({
    urn: z.string(),
    name: z.string().optional(),
    platform: z.string().optional(),
    hop: z.number().int().nonnegative(),
    lineageColumns: z.array(z.string()),
  })
  .strict();
const entityContextSchema = z
  .object({
    urn: z.string().max(500),
    entityType: z.string().max(100),
    name: z.string().max(500).optional(),
    platform: z.string().max(100).optional(),
    description: z.string().max(2_000).optional(),
    owners: z.array(z.string().max(500)).max(20),
    tags: z.array(z.string().max(500)).max(20),
    glossaryTerms: z.array(z.string().max(500)).max(20),
    siblingUrns: z.array(z.string().max(500)).max(20),
    qualitySignals: z.array(z.string().max(100)).max(20),
  })
  .strict();
const fixtureSchemas = [
  collectionSchema(candidateSchema),
  collectionSchema(fieldSchema),
  collectionSchema(lineageSchema),
  collectionSchema(lineageSchema),
  collectionSchema(entityContextSchema),
] as const;

function fixtureCapturePathError(): Error {
  return new Error("Fixture capture path is unsafe.");
}

interface FileSystemIdentity {
  readonly device: bigint;
  readonly inode: bigint;
}

interface DirectoryIdentity extends FileSystemIdentity {
  readonly path: string;
}

function assertDescendant(root: string, target: string): void {
  const fromRoot = relative(root, target);
  if (
    fromRoot.length === 0 ||
    isAbsolute(fromRoot) ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`)
  ) {
    throw fixtureCapturePathError();
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

function identitiesMatch(left: FileSystemIdentity, right: FileSystemIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

async function readDirectoryIdentity(path: string): Promise<DirectoryIdentity> {
  const absolutePath = resolve(path);
  const stats = await lstat(absolutePath, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw fixtureCapturePathError();
  }
  const physicalPath = await realpath(absolutePath);
  if (relative(absolutePath, physicalPath) !== "") {
    throw fixtureCapturePathError();
  }
  return {
    path: physicalPath,
    device: stats.dev,
    inode: stats.ino,
  };
}

async function assertDirectoryIdentity(identity: DirectoryIdentity): Promise<void> {
  const current = await readDirectoryIdentity(identity.path);
  if (!identitiesMatch(identity, current) || relative(identity.path, current.path) !== "") {
    throw fixtureCapturePathError();
  }
}

function isExistingPathError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "EEXIST"
  );
}

async function ensureSafeDirectoryComponent(
  parent: DirectoryIdentity,
  name: string,
  createDirectory: (path: string) => Promise<void>,
): Promise<DirectoryIdentity> {
  const child = resolve(parent.path, name);
  assertDescendant(parent.path, child);
  await assertDirectoryIdentity(parent);
  try {
    await createDirectory(child);
  } catch (error) {
    if (!isExistingPathError(error)) throw error;
  }

  await assertDirectoryIdentity(parent);
  const childIdentity = await readDirectoryIdentity(child);
  assertDescendant(parent.path, childIdentity.path);
  await assertDirectoryIdentity(parent);
  return childIdentity;
}

async function prepareCaptureRoot(
  repositoryRoot: string,
  createDirectory: (path: string) => Promise<void>,
): Promise<{
  readonly repositoryRoot: DirectoryIdentity;
  readonly captureRoot: DirectoryIdentity;
}> {
  const lexicalRepositoryRoot = resolve(repositoryRoot);
  const repositoryStats = await lstat(lexicalRepositoryRoot, { bigint: true });
  if (repositoryStats.isSymbolicLink() || !repositoryStats.isDirectory()) {
    throw fixtureCapturePathError();
  }
  const physicalRepositoryRoot = await realpath(lexicalRepositoryRoot);
  const repositoryIdentity: DirectoryIdentity = {
    path: physicalRepositoryRoot,
    device: repositoryStats.dev,
    inode: repositoryStats.ino,
  };
  await assertDirectoryIdentity(repositoryIdentity);
  const temporaryRoot = await ensureSafeDirectoryComponent(
    repositoryIdentity,
    "tmp",
    createDirectory,
  );
  const physicalCaptureRoot = await ensureSafeDirectoryComponent(
    temporaryRoot,
    "datahub-fixture-captures",
    createDirectory,
  );
  return {
    repositoryRoot: repositoryIdentity,
    captureRoot: physicalCaptureRoot,
  };
}

async function assertOwnedCandidateDirectory(
  captureRoot: DirectoryIdentity,
  candidate: string,
  expected?: DirectoryIdentity,
): Promise<DirectoryIdentity> {
  await assertDirectoryIdentity(captureRoot);
  const absoluteCandidate = resolve(candidate);
  assertDescendant(captureRoot.path, absoluteCandidate);
  const leaf = relative(captureRoot.path, absoluteCandidate);
  if (leaf.includes(sep) || !candidateNamePattern.test(leaf)) {
    throw fixtureCapturePathError();
  }

  const current = await readDirectoryIdentity(absoluteCandidate);
  assertDescendant(captureRoot.path, current.path);
  if (
    expected !== undefined &&
    (!identitiesMatch(expected, current) || relative(expected.path, current.path) !== "")
  ) {
    throw fixtureCapturePathError();
  }
  await assertDirectoryIdentity(captureRoot);
  return expected ?? current;
}

async function validateCommittedFixtures(): Promise<void> {
  for (const [index, filename] of fixtureFileNames.entries()) {
    const text = await readFile(
      new URL(`../tests/fixtures/datahub/${filename}`, import.meta.url),
      "utf8",
    );
    fixtureSchemas[index]!.parse(JSON.parse(text));
  }
}

async function validateCapturedCandidate(
  candidate: DirectoryIdentity,
): Promise<readonly CapturedFixture[]> {
  await assertDirectoryIdentity(candidate);
  const expected = [...fixtureFileNames].toSorted((left, right) =>
    left.localeCompare(right, "en-US"),
  );
  const actual = (await readdir(candidate.path)).toSorted((left, right) =>
    left.localeCompare(right, "en-US"),
  );
  await assertDirectoryIdentity(candidate);
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error("Captured fixture candidate has an invalid file set.");
  }

  const written: CapturedFixture[] = [];
  for (const [index, filename] of fixtureFileNames.entries()) {
    await assertDirectoryIdentity(candidate);
    const path = resolve(candidate.path, filename);
    assertDescendant(candidate.path, path);
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("Captured fixture candidate contains an unsafe fixture.");
    }
    const text = await readFile(path, "utf8");
    await assertDirectoryIdentity(candidate);
    fixtureSchemas[index]!.parse(JSON.parse(text));
    written.push({ path, basename: filename });
  }
  await assertDirectoryIdentity(candidate);
  return written;
}

async function assertCompletionMarkerAbsent(candidate: DirectoryIdentity): Promise<void> {
  await assertDirectoryIdentity(candidate);
  try {
    await lstat(resolve(candidate.path, fixtureCompletionMarker));
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
  throw fixtureCapturePathError();
}

async function readRegularFileIdentity(path: string): Promise<FileSystemIdentity> {
  const stats = await lstat(path, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw fixtureCapturePathError();
  }
  return {
    device: stats.dev,
    inode: stats.ino,
  };
}

async function assertRegularFileIdentity(
  path: string,
  expected: FileSystemIdentity,
): Promise<void> {
  const current = await readRegularFileIdentity(path);
  if (!identitiesMatch(expected, current)) {
    throw fixtureCapturePathError();
  }
}

async function cleanupOwnedCandidate(
  captureRoot: DirectoryIdentity,
  candidate: DirectoryIdentity,
  dependencies: FixtureCaptureCliDependencies,
): Promise<void> {
  try {
    await assertOwnedCandidateDirectory(captureRoot, candidate.path, candidate);
    await assertCompletionMarkerAbsent(candidate);
    const entries = await readdir(candidate.path);
    if (
      entries.some((name) => !fixtureFileNames.includes(name as (typeof fixtureFileNames)[number]))
    ) {
      throw fixtureCapturePathError();
    }

    for (const name of entries) {
      await assertOwnedCandidateDirectory(captureRoot, candidate.path, candidate);
      await assertCompletionMarkerAbsent(candidate);
      const entry = resolve(candidate.path, name);
      assertDescendant(candidate.path, entry);
      const entryIdentity = await readRegularFileIdentity(entry);
      await dependencies.beforeCleanupRemoval?.(entry);
      await assertOwnedCandidateDirectory(captureRoot, candidate.path, candidate);
      await assertCompletionMarkerAbsent(candidate);
      await assertRegularFileIdentity(entry, entryIdentity);
      await dependencies.removeCandidateEntry(entry);
      await assertOwnedCandidateDirectory(captureRoot, candidate.path, candidate);
    }

    await dependencies.beforeCleanupRemoval?.(candidate.path);
    await assertOwnedCandidateDirectory(captureRoot, candidate.path, candidate);
    await assertCompletionMarkerAbsent(candidate);
    if ((await readdir(candidate.path)).length !== 0) {
      throw fixtureCapturePathError();
    }
    await dependencies.removeCandidate(candidate.path);
  } catch {
    // Cleanup is best-effort. Never remove an unverified entry or replace the primary failure.
  }
}

function createDefaultFixtureCaptureCliDependencies(): FixtureCaptureCliDependencies {
  return {
    repositoryRoot: fixtureCaptureRepositoryRoot,
    environment: process.env,
    stdout: process.stdout,
    createDirectory: (path) => mkdir(path),
    createCandidateDirectory: (prefix) => mkdtemp(prefix),
    capture: captureDataHubFixtures,
    openCompletionMarker: (path) => open(path, "wx"),
    removeCandidateEntry: (path) => unlink(path),
    removeCandidate: (path) => rmdir(path),
  };
}

export async function serializeFixture(payload: unknown, token: string): Promise<string> {
  const serialized = `${JSON.stringify(redact(payload, [token]), null, 2)}\n`;
  if (serialized.includes(token))
    throw new Error("Fixture capture refused to write an unredacted token.");
  return format(serialized, { parser: "json", printWidth: 100 });
}

function fixturePayloadList(payloads: FixturePayloads): readonly unknown[] {
  return [
    payloads.candidates,
    payloads.fields,
    payloads.tableLineage,
    payloads.columnLineage,
    payloads.entityContext,
  ];
}

async function resolveWritableFixtureDestination(destination: string): Promise<string> {
  const lexicalDestination = resolve(destination);
  const stats = await lstat(lexicalDestination);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("Fixture destination is unsafe.");
  }
  const physicalDestination = await realpath(lexicalDestination);
  if (relative(lexicalDestination, physicalDestination) !== "") {
    throw new Error("Fixture destination is unsafe.");
  }
  return physicalDestination;
}

export async function writeFixturePayloads(
  payloads: FixturePayloads,
  token: string,
  destination: string,
): Promise<readonly CapturedFixture[]> {
  const values = fixturePayloadList(payloads);
  values.forEach((value, index) => fixtureSchemas[index]!.parse(value));
  const rendered = await Promise.all(values.map((value) => serializeFixture(value, token)));

  const safeDestination = await resolveWritableFixtureDestination(destination);
  const written: CapturedFixture[] = [];
  for (const [index, filename] of fixtureFileNames.entries()) {
    const path = resolve(safeDestination, filename);
    await writeFile(path, rendered[index]!, {
      encoding: "utf8",
      flag: "wx",
    });
    written.push({ path, basename: basename(path) as (typeof fixtureFileNames)[number] });
  }
  return written;
}

export async function captureDataHubFixtures(
  config: RuntimeConfig,
  destination: string,
): Promise<readonly CapturedFixture[]> {
  await validateCommittedFixtures();
  const catalog = new DataHubMcpCatalog(await connectDataHubMcp(config), [config.datahubGmsToken]);

  try {
    const candidates = await catalog.searchDatasets(DATASET_HINT);
    const fields = await catalog.listSchemaFields(DATASET_URN);
    const tableLineage = await catalog.getDownstreamLineage(DATASET_URN, { maxHops: 2 });
    const columnLineage = await catalog.getDownstreamLineage(DATASET_URN, {
      column: "customer_id",
      maxHops: 2,
    });
    const relevantUrns = [DATASET_URN, ...tableLineage.items.map(({ urn }) => urn)];
    const entityContext = await catalog.getEntityContext(relevantUrns);
    const canonical = canonicalizeFixturePayloads({
      candidates,
      fields,
      tableLineage,
      columnLineage,
      entityContext,
    });

    return await writeFixturePayloads(canonical, config.datahubGmsToken, destination);
  } finally {
    await catalog.close();
  }
}

export async function runFixtureCaptureCli(
  dependencies: FixtureCaptureCliDependencies = createDefaultFixtureCaptureCliDependencies(),
): Promise<FixtureCaptureCliResult> {
  const config = loadRuntimeConfig(dependencies.environment);
  const roots = await prepareCaptureRoot(dependencies.repositoryRoot, dependencies.createDirectory);
  let candidate: DirectoryIdentity | undefined;
  let completed = false;

  try {
    await assertDirectoryIdentity(roots.repositoryRoot);
    await assertDirectoryIdentity(roots.captureRoot);
    const created = await dependencies.createCandidateDirectory(
      join(roots.captureRoot.path, "capture-"),
    );
    await assertDirectoryIdentity(roots.repositoryRoot);
    await assertDirectoryIdentity(roots.captureRoot);
    candidate = await assertOwnedCandidateDirectory(roots.captureRoot, created);
    await dependencies.capture(config, candidate.path);
    await assertDirectoryIdentity(roots.repositoryRoot);
    candidate = await assertOwnedCandidateDirectory(roots.captureRoot, candidate.path, candidate);
    const written = await validateCapturedCandidate(candidate);

    await assertDirectoryIdentity(roots.repositoryRoot);
    await assertOwnedCandidateDirectory(roots.captureRoot, candidate.path, candidate);
    const markerHandle = await dependencies.openCompletionMarker(
      resolve(candidate.path, fixtureCompletionMarker),
    );
    completed = true;
    try {
      await markerHandle.close();
    } catch {
      // Exclusive marker open is authoritative; close failure cannot downgrade completion.
    }

    const displayPath = relative(roots.repositoryRoot.path, candidate.path).split(sep).join("/");
    try {
      await dependencies.stdout.write(
        `Captured ${fixtureFileNames.length} sanitized DataHub fixture candidates at ${displayPath}.\n`,
      );
    } catch {
      // Completion is authoritative; output failure cannot downgrade or delete the candidate.
    }
    return { destination: candidate.path, written };
  } catch (error) {
    if (candidate !== undefined && !completed) {
      await cleanupOwnedCandidate(roots.captureRoot, candidate, dependencies);
    }
    throw error;
  }
}

export async function runFixtureCaptureCommand(
  dependencies: FixtureCaptureCliDependencies = createDefaultFixtureCaptureCliDependencies(),
  stderr: FixtureCaptureTextWriter = process.stderr,
): Promise<number> {
  try {
    await runFixtureCaptureCli(dependencies);
    return 0;
  } catch {
    try {
      await stderr.write("DataHub fixture capture failed.\n");
    } catch {
      // A broken output stream must not expose or replace the bounded public failure.
    }
    return 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  process.exitCode = await runFixtureCaptureCommand();
}
