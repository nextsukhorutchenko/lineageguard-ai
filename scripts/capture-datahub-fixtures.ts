import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { format } from "prettier";
import { loadRuntimeConfig, type RuntimeConfig } from "../src/config/runtime-config.js";
import { DataHubMcpCatalog } from "../src/datahub/mcp/datahub-mcp-catalog.js";
import { connectDataHubMcp } from "../src/datahub/mcp/mcp-client.js";
import type { LineageAsset, SchemaField } from "../src/domain/evidence.js";
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
] as const;

export interface CapturedFixture {
  readonly path: string;
  readonly basename: (typeof fixtureFileNames)[number];
}

export interface FixturePayloads {
  readonly candidates: readonly DatasetCandidate[];
  readonly fields: readonly SchemaField[];
  readonly tableLineage: readonly LineageAsset[];
  readonly columnLineage: readonly LineageAsset[];
}

const compareEnglish = (left: string, right: string): number => left.localeCompare(right, "en-US");

const compareCandidate = (left: DatasetCandidate, right: DatasetCandidate): number =>
  compareEnglish(left.urn, right.urn) ||
  compareEnglish(left.name, right.name) ||
  compareEnglish(left.platform ?? "", right.platform ?? "");

const compareField = (left: SchemaField, right: SchemaField): number =>
  compareEnglish(left.fieldPath, right.fieldPath);

const compareLineage = (left: LineageAsset, right: LineageAsset): number =>
  compareEnglish(left.urn, right.urn) ||
  left.hop - right.hop ||
  compareEnglish(left.name ?? "", right.name ?? "") ||
  compareEnglish(left.platform ?? "", right.platform ?? "");

const canonicalizeLineage = (assets: readonly LineageAsset[]): readonly LineageAsset[] =>
  assets
    .map((asset) => ({
      ...asset,
      lineageColumns: [...asset.lineageColumns].sort(compareEnglish),
    }))
    .sort(compareLineage);

export function canonicalizeFixturePayloads(payloads: FixturePayloads): FixturePayloads {
  return {
    candidates: [...payloads.candidates].sort(compareCandidate),
    fields: [...payloads.fields].sort(compareField),
    tableLineage: canonicalizeLineage(payloads.tableLineage),
    columnLineage: canonicalizeLineage(payloads.columnLineage),
  };
}

export async function serializeFixture(payload: unknown, token: string): Promise<string> {
  const serialized = `${JSON.stringify(redact(payload, [token]), null, 2)}\n`;
  if (serialized.includes(token)) {
    throw new Error("Fixture capture refused to write an unredacted token.");
  }
  return format(serialized, { parser: "json", printWidth: 100 });
}

export async function captureDataHubFixtures(
  config: RuntimeConfig,
  destination: string,
): Promise<readonly CapturedFixture[]> {
  const catalog = new DataHubMcpCatalog(await connectDataHubMcp(config), [config.datahubGmsToken]);

  try {
    const canonical = canonicalizeFixturePayloads({
      candidates: await catalog.searchDatasets(DATASET_HINT),
      fields: await catalog.listSchemaFields(DATASET_URN),
      tableLineage: await catalog.getDownstreamLineage(DATASET_URN, { maxHops: 2 }),
      columnLineage: await catalog.getDownstreamLineage(DATASET_URN, {
        column: "customer_id",
        maxHops: 2,
      }),
    });
    const payloads = [
      [fixtureFileNames[0], canonical.candidates],
      [fixtureFileNames[1], canonical.fields],
      [fixtureFileNames[2], canonical.tableLineage],
      [fixtureFileNames[3], canonical.columnLineage],
    ] as const;

    await mkdir(destination, { recursive: true });
    const written: CapturedFixture[] = [];
    for (const [filename, payload] of payloads) {
      const path = resolve(destination, filename);
      await writeFile(path, await serializeFixture(payload, config.datahubGmsToken), "utf8");
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
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void main();
}
