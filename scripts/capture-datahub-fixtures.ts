import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format } from "prettier";
import { z } from "zod";
import { loadRuntimeConfig, type RuntimeConfig } from "../src/config/runtime-config.js";
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
  readonly environment: NodeJS.ProcessEnv;
  readonly stdout: FixtureCaptureTextWriter;
  readonly createDirectory: (path: string) => Promise<void>;
  readonly createCandidateDirectory: (prefix: string) => Promise<string>;
  readonly capture: typeof captureDataHubFixtures;
  readonly openCompletionMarker: (path: string) => Promise<FixtureCaptureMarkerHandle>;
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

async function assertNoLinkedExistingDirectoryComponents(
  root: string,
  target: string,
): Promise<void> {
  const absoluteRoot = resolve(root);
  const absoluteTarget = resolve(target);
  assertDescendant(absoluteRoot, absoluteTarget);

  const rootStats = await lstat(absoluteRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw fixtureCapturePathError();
  }

  let current = absoluteRoot;
  for (const component of relative(absoluteRoot, absoluteTarget).split(sep).filter(Boolean)) {
    current = join(current, component);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw fixtureCapturePathError();
      }
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }
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
  parent: string,
  name: string,
  createDirectory: (path: string) => Promise<void>,
): Promise<string> {
  const child = resolve(parent, name);
  assertDescendant(parent, child);
  try {
    await createDirectory(child);
  } catch (error) {
    if (!isExistingPathError(error)) throw error;
  }

  const stats = await lstat(child);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw fixtureCapturePathError();
  }
  const [physicalParent, physicalChild] = await Promise.all([realpath(parent), realpath(child)]);
  assertDescendant(physicalParent, physicalChild);
  return physicalChild;
}

async function prepareCaptureRoot(
  repositoryRoot: string,
  createDirectory: (path: string) => Promise<void>,
): Promise<{
  readonly repositoryRoot: string;
  readonly captureRoot: string;
}> {
  const lexicalRepositoryRoot = resolve(repositoryRoot);
  const repositoryStats = await lstat(lexicalRepositoryRoot);
  if (repositoryStats.isSymbolicLink() || !repositoryStats.isDirectory()) {
    throw fixtureCapturePathError();
  }
  const physicalRepositoryRoot = await realpath(lexicalRepositoryRoot);
  const temporaryRoot = await ensureSafeDirectoryComponent(
    physicalRepositoryRoot,
    "tmp",
    createDirectory,
  );
  const physicalCaptureRoot = await ensureSafeDirectoryComponent(
    temporaryRoot,
    "datahub-fixture-captures",
    createDirectory,
  );
  return {
    repositoryRoot: physicalRepositoryRoot,
    captureRoot: physicalCaptureRoot,
  };
}

async function assertOwnedCandidateDirectory(
  captureRoot: string,
  candidate: string,
): Promise<string> {
  const absoluteCandidate = resolve(candidate);
  assertDescendant(captureRoot, absoluteCandidate);
  const leaf = relative(captureRoot, absoluteCandidate);
  if (leaf.includes(sep) || !candidateNamePattern.test(leaf)) {
    throw fixtureCapturePathError();
  }

  await assertNoLinkedExistingDirectoryComponents(captureRoot, absoluteCandidate);
  const stats = await lstat(absoluteCandidate);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw fixtureCapturePathError();
  }
  const physicalCandidate = await realpath(absoluteCandidate);
  assertDescendant(captureRoot, physicalCandidate);
  return physicalCandidate;
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

async function validateCapturedCandidate(destination: string): Promise<readonly CapturedFixture[]> {
  const expected = [...fixtureFileNames].toSorted((left, right) =>
    left.localeCompare(right, "en-US"),
  );
  const actual = (await readdir(destination)).toSorted((left, right) =>
    left.localeCompare(right, "en-US"),
  );
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error("Captured fixture candidate has an invalid file set.");
  }

  const written: CapturedFixture[] = [];
  for (const [index, filename] of fixtureFileNames.entries()) {
    const path = resolve(destination, filename);
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("Captured fixture candidate contains an unsafe fixture.");
    }
    const text = await readFile(path, "utf8");
    fixtureSchemas[index]!.parse(JSON.parse(text));
    written.push({ path, basename: filename });
  }
  return written;
}

async function assertSafeCleanupEntries(candidate: string): Promise<void> {
  for (const name of await readdir(candidate)) {
    if (name === fixtureCompletionMarker) {
      throw fixtureCapturePathError();
    }
    const entry = resolve(candidate, name);
    assertDescendant(candidate, entry);
    const stats = await lstat(entry);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw fixtureCapturePathError();
    }
  }
}

async function cleanupOwnedCandidate(
  captureRoot: string,
  candidate: string,
  removeCandidate: (path: string) => Promise<void>,
): Promise<void> {
  try {
    const ownedCandidate = await assertOwnedCandidateDirectory(captureRoot, candidate);
    await assertSafeCleanupEntries(ownedCandidate);
    await removeCandidate(ownedCandidate);
  } catch {
    // Cleanup is best-effort. Never traverse an unverified path or replace the primary failure.
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
    removeCandidate: (path) =>
      rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
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
  let candidate: string | undefined;
  let completed = false;

  try {
    const created = await dependencies.createCandidateDirectory(
      join(roots.captureRoot, "capture-"),
    );
    candidate = await assertOwnedCandidateDirectory(roots.captureRoot, created);
    await dependencies.capture(config, candidate);
    candidate = await assertOwnedCandidateDirectory(roots.captureRoot, candidate);
    const written = await validateCapturedCandidate(candidate);

    const markerHandle = await dependencies.openCompletionMarker(
      resolve(candidate, fixtureCompletionMarker),
    );
    completed = true;
    await markerHandle.close().catch(() => undefined);

    const displayPath = relative(roots.repositoryRoot, candidate).split(sep).join("/");
    try {
      dependencies.stdout.write(
        `Captured ${fixtureFileNames.length} sanitized DataHub fixture candidates at ${displayPath}.\n`,
      );
    } catch {
      // Completion is authoritative; output failure cannot downgrade or delete the candidate.
    }
    return { destination: candidate, written };
  } catch (error) {
    if (candidate !== undefined && !completed) {
      await cleanupOwnedCandidate(roots.captureRoot, candidate, dependencies.removeCandidate);
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
      stderr.write("DataHub fixture capture failed.\n");
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
