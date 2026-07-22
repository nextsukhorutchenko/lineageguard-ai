import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { format } from "prettier";
import { loadRuntimeConfig, type RuntimeConfig } from "../src/config/runtime-config.js";
import { DataHubMcpCatalog } from "../src/datahub/mcp/datahub-mcp-catalog.js";
import { connectDataHubMcp } from "../src/datahub/mcp/mcp-client.js";
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

async function serializeFixture(payload: unknown, token: string): Promise<string> {
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
    const payloads = [
      [fixtureFileNames[0], await catalog.searchDatasets(DATASET_HINT)],
      [fixtureFileNames[1], await catalog.listSchemaFields(DATASET_URN)],
      [fixtureFileNames[2], await catalog.getDownstreamLineage(DATASET_URN, { maxHops: 2 })],
      [
        fixtureFileNames[3],
        await catalog.getDownstreamLineage(DATASET_URN, {
          column: "customer_id",
          maxHops: 2,
        }),
      ],
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
