import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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

async function validateCommittedFixtures(): Promise<void> {
  for (const [index, filename] of fixtureFileNames.entries()) {
    const text = await readFile(
      new URL(`../tests/fixtures/datahub/${filename}`, import.meta.url),
      "utf8",
    );
    fixtureSchemas[index]!.parse(JSON.parse(text));
  }
}

export async function serializeFixture(payload: unknown, token: string): Promise<string> {
  const serialized = `${JSON.stringify(redact(payload, [token]), null, 2)}\n`;
  if (serialized.includes(token))
    throw new Error("Fixture capture refused to write an unredacted token.");
  return format(serialized, { parser: "json", printWidth: 100 });
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
    const payloads = [
      canonical.candidates,
      canonical.fields,
      canonical.tableLineage,
      canonical.columnLineage,
      canonical.entityContext,
    ] as const;
    payloads.forEach((payload, index) => fixtureSchemas[index]!.parse(payload));

    await mkdir(destination, { recursive: true });
    const written: CapturedFixture[] = [];
    for (const [index, filename] of fixtureFileNames.entries()) {
      const path = resolve(destination, filename);
      await writeFile(path, await serializeFixture(payloads[index], config.datahubGmsToken), {
        encoding: "utf8",
        flag: "wx",
      });
      written.push({ path, basename: basename(path) as (typeof fixtureFileNames)[number] });
    }
    return written;
  } finally {
    await catalog.close();
  }
}

async function main(): Promise<void> {
  const config = loadRuntimeConfig(process.env);
  const written = await captureDataHubFixtures(config, resolve("tests/fixtures/datahub"));
  console.log(`Captured ${written.length} sanitized DataHub fixtures.`);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) void main();
