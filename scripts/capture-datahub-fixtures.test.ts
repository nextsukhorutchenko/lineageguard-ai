import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalizeFixturePayloads,
  fixtureFileNames,
  serializeFixture,
  writeFixturePayloads,
  type FixturePayloads,
} from "./capture-datahub-fixtures.js";

const token = "local-test-token";

const temporaryRoots: string[] = [];

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const complete = <T>(items: readonly T[]) => ({
  items,
  completeness: {
    complete: true,
    pages: 1,
    itemCount: items.length,
    offsets: [0],
    reasonCodes: [],
  },
});

const ordered = {
  candidates: complete([
    { urn: "urn:li:dataset:a", name: "alpha", platform: "snowflake" },
    { urn: "urn:li:dataset:b", name: "beta", platform: "snowflake" },
  ]),
  fields: complete([
    { fieldPath: "customer_id", nativeDataType: "NUMBER(38,0)" },
    { fieldPath: "order_id", nativeDataType: "NUMBER(38,0)" },
  ]),
  tableLineage: complete([
    {
      urn: "urn:li:dataset:a",
      name: "alpha",
      platform: "snowflake",
      hop: 1,
      lineageColumns: ["customer_id", "order_id"],
    },
    {
      urn: "urn:li:dataset:b",
      name: "beta",
      platform: "snowflake",
      hop: 2,
      lineageColumns: ["customer_id"],
    },
  ]),
  columnLineage: complete([
    {
      urn: "urn:li:dataset:a",
      name: "alpha",
      platform: "snowflake",
      hop: 1,
      lineageColumns: ["customer_id", "order_id"],
    },
    {
      urn: "urn:li:dataset:b",
      name: "beta",
      platform: "snowflake",
      hop: 2,
      lineageColumns: ["customer_id"],
    },
  ]),
  entityContext: complete([
    {
      urn: "urn:li:dataset:a",
      entityType: "DATASET",
      owners: [],
      tags: [],
      glossaryTerms: [],
      siblingUrns: [],
      qualitySignals: [],
    },
  ]),
} as const;

const permuted = {
  candidates: { ...ordered.candidates, items: [...ordered.candidates.items].reverse() },
  fields: { ...ordered.fields, items: [...ordered.fields.items].reverse() },
  tableLineage: {
    ...ordered.tableLineage,
    items: ordered.tableLineage.items
      .map((asset) => ({ ...asset, lineageColumns: [...asset.lineageColumns].reverse() }))
      .reverse(),
  },
  columnLineage: {
    ...ordered.columnLineage,
    items: ordered.columnLineage.items
      .map((asset) => ({ ...asset, lineageColumns: [...asset.lineageColumns].reverse() }))
      .reverse(),
  },
  entityContext: ordered.entityContext,
};

async function render(payloads: FixturePayloads): Promise<readonly string[]> {
  const canonical = canonicalizeFixturePayloads(payloads);
  return Promise.all([
    serializeFixture(canonical.candidates, token),
    serializeFixture(canonical.fields, token),
    serializeFixture(canonical.tableLineage, token),
    serializeFixture(canonical.columnLineage, token),
    serializeFixture(canonical.entityContext, token),
  ]);
}

describe("fixture canonicalization", () => {
  it("renders semantically equivalent permutations as byte-identical fixture content", async () => {
    await expect(render(ordered)).resolves.toEqual(await render(permuted));
  });

  it("serializes the deterministic URN display fallback for unnamed search candidates", async () => {
    const urn = "urn:li:dataset:(urn:li:dataPlatform:snowflake,unnamed_orders,PROD)";
    const [searchFixture] = await render({
      ...ordered,
      candidates: complete([{ urn, name: urn }]),
    });

    expect(JSON.parse(searchFixture!)).toMatchObject({ items: [{ urn, name: urn }] });
  });
});

describe("fixture writer", () => {
  it("writes exactly five canonical token-free fixtures", async () => {
    const destination = await createTemporaryDirectory("lineageguard-fixture-writer-");

    const written = await writeFixturePayloads(ordered, token, destination);

    expect(written.map(({ basename }) => basename)).toEqual(fixtureFileNames);
    expect(
      (await readdir(destination)).toSorted((left, right) => left.localeCompare(right, "en-US")),
    ).toEqual([...fixtureFileNames].toSorted((left, right) => left.localeCompare(right, "en-US")));
    for (const filename of fixtureFileNames) {
      const text = await readFile(join(destination, filename), "utf8");
      expect(() => JSON.parse(text)).not.toThrow();
      expect(text).not.toContain(token);
    }
  });

  it("rejects an existing fixture without changing any existing bytes", async () => {
    const destination = await createTemporaryDirectory("lineageguard-fixture-existing-");
    await writeFixturePayloads(ordered, token, destination);
    const before = await Promise.all(
      fixtureFileNames.map((filename) => readFile(join(destination, filename), "utf8")),
    );

    await expect(writeFixturePayloads(ordered, token, destination)).rejects.toMatchObject({
      code: "EEXIST",
    });

    await expect(
      Promise.all(
        fixtureFileNames.map((filename) => readFile(join(destination, filename), "utf8")),
      ),
    ).resolves.toEqual(before);
  });

  it("does not overwrite a sentinel at the fifth fixture when the first four writes succeed", async () => {
    const destination = await createTemporaryDirectory("lineageguard-fixture-fifth-existing-");
    const fifthFixture = fixtureFileNames[4];
    const sentinel = "do not replace the fifth fixture\\n";
    await writeFile(join(destination, fifthFixture), sentinel, { encoding: "utf8", flag: "wx" });

    await expect(writeFixturePayloads(ordered, token, destination)).rejects.toMatchObject({
      code: "EEXIST",
    });

    await expect(readFile(join(destination, fifthFixture), "utf8")).resolves.toBe(sentinel);
    await expect(readdir(destination)).resolves.toHaveLength(fixtureFileNames.length);
  });

  it("rejects a linked destination at the immediate write boundary", async () => {
    const sandbox = await createTemporaryDirectory("lineageguard-fixture-linked-destination-");
    const destination = join(sandbox, "candidate");
    const outside = join(sandbox, "outside");
    const sentinel = join(outside, "sentinel.txt");
    await mkdir(outside);
    await writeFile(sentinel, "keep\\n", "utf8");
    await symlink(outside, destination, process.platform === "win32" ? "junction" : "dir");

    await expect(writeFixturePayloads(ordered, token, destination)).rejects.toThrow(
      "Fixture destination is unsafe.",
    );

    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep\\n");
  });

  it.each([
    ["email", "owner@example.invalid"],
    ["profile", "private-profile"],
    ["relatedDocuments", ["urn:li:dataset:private"]],
    ["rawSql", "select secret from private_table"],
    ["token", "fixture-token"],
    ["diagnostics", { stderr: "raw dependency failure" }],
    ["description", "x".repeat(2_001)],
  ] as const)(
    "rejects forbidden entity-context field %s before filesystem output",
    async (field, value) => {
      const sandbox = await createTemporaryDirectory("lineageguard-fixture-invalid-");
      const destination = join(sandbox, "candidate");
      const unsafePayloads = {
        ...ordered,
        entityContext: complete([
          {
            urn: "urn:li:dataset:test",
            entityType: "DATASET",
            owners: [],
            tags: [],
            glossaryTerms: [],
            siblingUrns: [],
            qualitySignals: [],
            [field]: value,
          },
        ]),
      } as unknown as FixturePayloads;

      await expect(writeFixturePayloads(unsafePayloads, token, destination)).rejects.toThrow();
      await expect(access(destination)).rejects.toThrow();
    },
  );
});
