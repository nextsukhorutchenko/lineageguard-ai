import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "prettier";
import { describe, expect, test } from "vitest";
import {
  captureDataHubFixtures,
  fixtureFileNames,
} from "../../scripts/capture-datahub-fixtures.js";
import { loadRuntimeConfig } from "../../src/config/runtime-config.js";
import { DataHubMcpCatalog } from "../../src/datahub/mcp/datahub-mcp-catalog.js";
import { connectDataHubMcp } from "../../src/datahub/mcp/mcp-client.js";

const DATASET_URN =
  "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)";
const DATASET_HINT = "order+details";

const integrationTest = test.runIf(Boolean(process.env.DATAHUB_GMS_TOKEN));

describe("DataHub MCP live integration", () => {
  integrationTest(
    "reads the official showcase-ecommerce target through the read-only MCP tools",
    async () => {
      const config = loadRuntimeConfig({
        DATAHUB_GMS_URL: process.env.DATAHUB_GMS_URL ?? "http://localhost:8080",
        DATAHUB_GMS_TOKEN: process.env.DATAHUB_GMS_TOKEN,
        DATAHUB_MCP_UVX_PATH: process.env.DATAHUB_MCP_UVX_PATH,
      });
      const catalog = new DataHubMcpCatalog(await connectDataHubMcp(config), [
        config.datahubGmsToken,
      ]);

      try {
        const candidates = await catalog.searchDatasets(DATASET_HINT);
        const fields = await catalog.listSchemaFields(DATASET_URN);
        const tableLineage = await catalog.getDownstreamLineage(DATASET_URN, { maxHops: 2 });
        const columnLineage = await catalog.getDownstreamLineage(DATASET_URN, {
          column: "customer_id",
          maxHops: 2,
        });

        expect(candidates).toContainEqual(expect.objectContaining({ urn: DATASET_URN }));
        expect(fields).toContainEqual(
          expect.objectContaining({
            fieldPath: "customer_id",
            nativeDataType: "NUMBER(38,0)",
          }),
        );
        expect(tableLineage.length).toBeGreaterThan(0);
        expect(columnLineage).toContainEqual(
          expect.objectContaining({
            lineageColumns: expect.arrayContaining(["customer_id"]),
          }),
        );
        expect(catalog.getTrace().map(({ tool }) => tool)).toEqual([
          "search",
          "list_schema_fields",
          "get_lineage",
          "get_lineage",
        ]);
      } finally {
        await catalog.close();
      }
    },
    120_000,
  );

  integrationTest(
    "captures only the four sanitized normalized fixture payloads",
    async () => {
      const config = loadRuntimeConfig({
        DATAHUB_GMS_URL: process.env.DATAHUB_GMS_URL ?? "http://localhost:8080",
        DATAHUB_GMS_TOKEN: process.env.DATAHUB_GMS_TOKEN,
        DATAHUB_MCP_UVX_PATH: process.env.DATAHUB_MCP_UVX_PATH,
      });
      const destination = await mkdtemp(join(tmpdir(), "lineageguard-datahub-fixtures-"));

      try {
        const written = await captureDataHubFixtures(config, destination);

        expect(written.map(({ basename }) => basename)).toEqual(fixtureFileNames);
        expect((await readdir(destination)).sort()).toEqual([...fixtureFileNames].sort());
        for (const filename of fixtureFileNames) {
          const content = await readFile(join(destination, filename), "utf8");
          expect(content).not.toContain(config.datahubGmsToken);
          expect(await check(content, { parser: "json", printWidth: 100 })).toBe(true);
        }
      } finally {
        await rm(destination, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
