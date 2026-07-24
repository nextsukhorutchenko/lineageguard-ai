import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { EnvironmentMap } from "../src/config/runtime-config.js";
import {
  canonicalizeFixturePayloads,
  fixtureCaptureRepositoryRoot,
  fixtureCompletionMarker,
  fixtureFileNames,
  runFixtureCaptureCli,
  runFixtureCaptureCommand,
  serializeFixture,
  writeFixturePayloads,
  type FixtureCaptureCliDependencies,
  type FixtureCaptureTextWriter,
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

function createRecordingWriter(): {
  readonly chunks: string[];
  readonly writer: FixtureCaptureTextWriter;
} {
  const chunks: string[] = [];
  return {
    chunks,
    writer: {
      write(text: string): void {
        chunks.push(text);
      },
    },
  };
}

function fixtureEnvironment(): EnvironmentMap {
  return {
    DATAHUB_GMS_URL: "http://localhost:8080",
    DATAHUB_GMS_TOKEN: token,
    DATAHUB_MCP_UVX_PATH: "uvx",
    LINEAGEGUARD_RUNS_DIR: "runs",
  };
}

function createCliDependencies(
  repositoryRoot: string,
  stdout: FixtureCaptureTextWriter,
  overrides: Partial<FixtureCaptureCliDependencies> = {},
): FixtureCaptureCliDependencies {
  const defaults: FixtureCaptureCliDependencies = {
    repositoryRoot,
    environment: fixtureEnvironment(),
    stdout,
    createDirectory: (path) => mkdir(path),
    createCandidateDirectory: (prefix) => mkdtemp(prefix),
    capture: async (config, destination) =>
      writeFixturePayloads(ordered, config.datahubGmsToken, destination),
    openCompletionMarker: (path) => open(path, "wx"),
    removeCandidateEntry: (path) => unlink(path),
    removeCandidate: (path) => rmdir(path),
  };
  return { ...defaults, ...overrides };
}

const invalidCandidateMutations: readonly {
  readonly name: string;
  readonly mutate: (destination: string, outside: string) => Promise<void>;
}[] = [
  {
    name: "missing fixture",
    mutate: async (destination) => {
      await rm(join(destination, fixtureFileNames[0]));
    },
  },
  {
    name: "extra file",
    mutate: async (destination) => {
      await writeFile(join(destination, "extra.json"), "{}\n", "utf8");
    },
  },
  {
    name: "malformed fixture",
    mutate: async (destination) => {
      await writeFile(join(destination, fixtureFileNames[0]), "{not-json\n", "utf8");
    },
  },
  {
    name: "linked fixture",
    mutate: async (destination, outside) => {
      const fixture = join(destination, fixtureFileNames[0]);
      await rm(fixture);
      await symlink(outside, fixture, process.platform === "win32" ? "junction" : "dir");
    },
  },
];

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

describe("fixture capture CLI", () => {
  it("anchors the default repository root to the script module", () => {
    expect(fixtureCaptureRepositoryRoot).toBe(
      resolve(fileURLToPath(new URL("../", import.meta.url))),
    );
  });

  it("creates a complete five-fixture candidate outside committed fixtures", async () => {
    const repositoryRoot = await createTemporaryDirectory("lineageguard-capture-repository-");
    const output = createRecordingWriter();

    const result = await runFixtureCaptureCli(createCliDependencies(repositoryRoot, output.writer));

    const relativeDestination = relative(repositoryRoot, result.destination).split(sep).join("/");
    expect(relativeDestination).toMatch(/^tmp\/datahub-fixture-captures\/capture-[A-Za-z0-9_-]+$/);
    expect(result.destination).not.toBe(resolve(repositoryRoot, "tests/fixtures/datahub"));
    expect(result.written.map(({ basename }) => basename)).toEqual(fixtureFileNames);
    expect(
      (await readdir(result.destination)).toSorted((left, right) =>
        left.localeCompare(right, "en-US"),
      ),
    ).toEqual(
      [...fixtureFileNames, fixtureCompletionMarker].toSorted((left, right) =>
        left.localeCompare(right, "en-US"),
      ),
    );
    const marker = await lstat(join(result.destination, fixtureCompletionMarker));
    expect(marker.isFile()).toBe(true);
    expect(marker.isSymbolicLink()).toBe(false);
    expect(marker.size).toBe(0);
    for (const filename of fixtureFileNames) {
      const fixture = await lstat(join(result.destination, filename));
      expect(fixture.isFile()).toBe(true);
      expect(fixture.isSymbolicLink()).toBe(false);
    }
    expect(output.chunks).toEqual([
      `Captured 5 sanitized DataHub fixture candidates at ${relativeDestination}.\n`,
    ]);
  });

  it("never reuses or removes an existing capture directory", async () => {
    const repositoryRoot = await createTemporaryDirectory("lineageguard-capture-existing-");
    const captureRoot = join(repositoryRoot, "tmp", "datahub-fixture-captures");
    const existing = join(captureRoot, "capture-existing");
    const sentinel = join(existing, "sentinel.txt");
    await mkdir(existing, { recursive: true });
    await writeFile(sentinel, "keep\n", "utf8");
    const output = createRecordingWriter();

    const result = await runFixtureCaptureCli(createCliDependencies(repositoryRoot, output.writer));

    expect(result.destination).not.toBe(existing);
    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep\n");
  });

  it("rejects a candidate swapped to a link during capture before any fixture write", async () => {
    const sandbox = await createTemporaryDirectory("lineageguard-capture-write-swap-");
    const repositoryRoot = join(sandbox, "repository");
    const outside = join(sandbox, "outside");
    const sentinel = join(outside, "sentinel.txt");
    await mkdir(repositoryRoot);
    await mkdir(outside);
    await writeFile(sentinel, "keep\\n", "utf8");
    const output = createRecordingWriter();

    await expect(
      runFixtureCaptureCli(
        createCliDependencies(repositoryRoot, output.writer, {
          capture: async (config, destination) => {
            await rm(destination, { recursive: true, force: true });
            await symlink(outside, destination, process.platform === "win32" ? "junction" : "dir");
            return writeFixturePayloads(ordered, config.datahubGmsToken, destination);
          },
        }),
      ),
    ).rejects.toThrow("Fixture destination is unsafe.");

    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep\\n");
    expect(output.chunks).toEqual([]);
  });

  it("rejects a linked capture-root ancestor without writing outside the repository", async () => {
    const sandbox = await createTemporaryDirectory("lineageguard-capture-root-link-");
    const repositoryRoot = join(sandbox, "repository");
    const outside = join(sandbox, "outside");
    const sentinel = join(outside, "sentinel.txt");
    await mkdir(repositoryRoot);
    await mkdir(outside);
    await writeFile(sentinel, "keep\n", "utf8");
    await symlink(
      outside,
      join(repositoryRoot, "tmp"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const output = createRecordingWriter();

    await expect(
      runFixtureCaptureCli(createCliDependencies(repositoryRoot, output.writer)),
    ).rejects.toThrow("Fixture capture path is unsafe.");

    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep\n");
    expect(output.chunks).toEqual([]);
  });

  it("stops after a root component is swapped to a link before creating the nested root", async () => {
    const sandbox = await createTemporaryDirectory("lineageguard-capture-root-swap-");
    const repositoryRoot = join(sandbox, "repository");
    const outside = join(sandbox, "outside");
    const sentinel = join(outside, "sentinel.txt");
    const nestedCaptureRoot = join(outside, "datahub-fixture-captures");
    await mkdir(repositoryRoot);
    await mkdir(outside);
    await writeFile(sentinel, "keep\n", "utf8");
    const output = createRecordingWriter();

    await expect(
      runFixtureCaptureCli(
        createCliDependencies(repositoryRoot, output.writer, {
          createDirectory: async (path) => {
            await mkdir(path);
            if (relative(repositoryRoot, path) === "tmp") {
              await rm(path, { recursive: true });
              await symlink(outside, path, process.platform === "win32" ? "junction" : "dir");
            }
          },
        }),
      ),
    ).rejects.toThrow("Fixture capture path is unsafe.");

    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep\n");
    await expect(access(nestedCaptureRoot)).rejects.toThrow();
    expect(output.chunks).toEqual([]);
  });

  it("rejects a regular root component substituted while creating the nested root", async () => {
    const sandbox = await createTemporaryDirectory("lineageguard-capture-root-identity-");
    const repositoryRoot = join(sandbox, "repository");
    const displacedTemporaryRoot = join(sandbox, "validated-tmp");
    await mkdir(repositoryRoot);
    const output = createRecordingWriter();
    let captureCalled = false;
    let markerOpened = false;

    await expect(
      runFixtureCaptureCli(
        createCliDependencies(repositoryRoot, output.writer, {
          createDirectory: async (path) => {
            if (relative(repositoryRoot, path) === join("tmp", "datahub-fixture-captures")) {
              await rename(join(repositoryRoot, "tmp"), displacedTemporaryRoot);
              await mkdir(join(repositoryRoot, "tmp"));
            }
            await mkdir(path);
          },
          capture: async () => {
            captureCalled = true;
            throw new Error("Capture must not run for a substituted root.");
          },
          openCompletionMarker: async (path) => {
            markerOpened = true;
            return open(path, "wx");
          },
        }),
      ),
    ).rejects.toThrow("Fixture capture path is unsafe.");

    expect(captureCalled).toBe(false);
    expect(markerOpened).toBe(false);
    await expect(access(displacedTemporaryRoot)).resolves.toBeUndefined();
    expect(output.chunks).toEqual([]);
  });

  it("rejects a linked candidate without traversing it during cleanup", async () => {
    const sandbox = await createTemporaryDirectory("lineageguard-capture-child-link-");
    const repositoryRoot = join(sandbox, "repository");
    const outside = join(sandbox, "outside");
    const sentinel = join(outside, "sentinel.txt");
    await mkdir(repositoryRoot);
    await mkdir(outside);
    await writeFile(sentinel, "keep\n", "utf8");
    const output = createRecordingWriter();

    await expect(
      runFixtureCaptureCli(
        createCliDependencies(repositoryRoot, output.writer, {
          createCandidateDirectory: async (prefix) => {
            const linkedCandidate = join(dirname(prefix), "capture-linked");
            await symlink(
              outside,
              linkedCandidate,
              process.platform === "win32" ? "junction" : "dir",
            );
            return linkedCandidate;
          },
        }),
      ),
    ).rejects.toThrow("Fixture capture path is unsafe.");

    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep\n");
    expect(output.chunks).toEqual([]);
  });

  it("rejects a candidate path outside the validated capture root", async () => {
    const sandbox = await createTemporaryDirectory("lineageguard-capture-escape-");
    const repositoryRoot = join(sandbox, "repository");
    const outsideCandidate = join(sandbox, "capture-outside");
    const sentinel = join(outsideCandidate, "sentinel.txt");
    await mkdir(repositoryRoot);
    await mkdir(outsideCandidate);
    await writeFile(sentinel, "keep\n", "utf8");
    const output = createRecordingWriter();

    await expect(
      runFixtureCaptureCli(
        createCliDependencies(repositoryRoot, output.writer, {
          createCandidateDirectory: async () => outsideCandidate,
        }),
      ),
    ).rejects.toThrow("Fixture capture path is unsafe.");

    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep\n");
    expect(output.chunks).toEqual([]);
  });

  it("does not publish a regular directory substituted for the owned candidate", async () => {
    const repositoryRoot = await createTemporaryDirectory(
      "lineageguard-capture-candidate-identity-",
    );
    const output = createRecordingWriter();
    let candidate: string | undefined;
    let displacedCandidate: string | undefined;
    const dependencies = createCliDependencies(repositoryRoot, output.writer, {
      createCandidateDirectory: async (prefix) => {
        candidate = await mkdtemp(prefix);
        return candidate;
      },
      capture: async (config, destination) => {
        const written = await writeFixturePayloads(ordered, config.datahubGmsToken, destination);
        displacedCandidate = join(dirname(destination), "capture-displaced");
        await rename(destination, displacedCandidate);
        await mkdir(destination);
        await writeFixturePayloads(ordered, config.datahubGmsToken, destination);
        return written;
      },
      removeCandidate: async () => {
        throw new Error("Substituted directories must not be removed.");
      },
    });

    await expect(runFixtureCaptureCli(dependencies)).rejects.toThrow(
      "Fixture capture path is unsafe.",
    );
    if (candidate === undefined || displacedCandidate === undefined) {
      throw new Error("Expected both candidate directories.");
    }
    await expect(access(candidate)).resolves.toBeUndefined();
    await expect(access(displacedCandidate)).resolves.toBeUndefined();
    await expect(access(join(candidate, fixtureCompletionMarker))).rejects.toThrow();
    expect(output.chunks).toEqual([]);
  });

  it.each(invalidCandidateMutations)(
    "does not complete a candidate with a $name",
    async ({ mutate }) => {
      const sandbox = await createTemporaryDirectory("lineageguard-capture-invalid-set-");
      const repositoryRoot = join(sandbox, "repository");
      const outside = join(sandbox, "outside");
      const sentinel = join(outside, "sentinel.txt");
      await mkdir(repositoryRoot);
      await mkdir(outside);
      await writeFile(sentinel, "keep\n", "utf8");
      const output = createRecordingWriter();
      let candidate: string | undefined;

      const dependencies = createCliDependencies(repositoryRoot, output.writer, {
        createCandidateDirectory: async (prefix) => {
          candidate = await mkdtemp(prefix);
          return candidate;
        },
        capture: async (config, destination) => {
          const written = await writeFixturePayloads(ordered, config.datahubGmsToken, destination);
          await mutate(destination, outside);
          return written;
        },
        removeCandidate: async () => {
          throw new Error("simulated cleanup failure");
        },
      });

      await expect(runFixtureCaptureCli(dependencies)).rejects.toThrow();
      if (candidate === undefined) throw new Error("Expected a candidate directory.");
      await expect(access(join(candidate, fixtureCompletionMarker))).rejects.toThrow();
      await expect(readFile(sentinel, "utf8")).resolves.toBe("keep\n");
      expect(output.chunks).toEqual([]);
    },
  );

  it("removes a partial unmarked candidate and preserves the primary failure", async () => {
    const repositoryRoot = await createTemporaryDirectory("lineageguard-capture-partial-");
    const output = createRecordingWriter();
    const primary = new Error("primary capture failure");
    let candidate: string | undefined;
    const dependencies = createCliDependencies(repositoryRoot, output.writer, {
      createCandidateDirectory: async (prefix) => {
        candidate = await mkdtemp(prefix);
        return candidate;
      },
      capture: async (_config, destination) => {
        await writeFile(join(destination, fixtureFileNames[0]), "{}\n", {
          encoding: "utf8",
          flag: "wx",
        });
        throw primary;
      },
    });

    await expect(runFixtureCaptureCli(dependencies)).rejects.toBe(primary);
    if (candidate === undefined) throw new Error("Expected a candidate directory.");
    await expect(access(candidate)).rejects.toThrow();
    expect(output.chunks).toEqual([]);
  });

  it("refuses cleanup when a regular directory replaces the owned candidate", async () => {
    const repositoryRoot = await createTemporaryDirectory("lineageguard-capture-cleanup-identity-");
    const output = createRecordingWriter();
    const primary = new Error("capture failed after candidate substitution");
    let candidate: string | undefined;
    let displacedCandidate: string | undefined;
    const dependencies = createCliDependencies(repositoryRoot, output.writer, {
      createCandidateDirectory: async (prefix) => {
        candidate = await mkdtemp(prefix);
        return candidate;
      },
      capture: async (_config, destination) => {
        await writeFile(join(destination, fixtureFileNames[0]), "original\n", "utf8");
        displacedCandidate = join(dirname(destination), "capture-cleanup-displaced");
        await rename(destination, displacedCandidate);
        await mkdir(destination);
        throw primary;
      },
    });

    await expect(runFixtureCaptureCli(dependencies)).rejects.toBe(primary);
    if (candidate === undefined || displacedCandidate === undefined) {
      throw new Error("Expected both candidate directories.");
    }
    await expect(access(candidate)).resolves.toBeUndefined();
    await expect(access(displacedCandidate)).resolves.toBeUndefined();
    await expect(access(join(candidate, fixtureCompletionMarker))).rejects.toThrow();
    expect(output.chunks).toEqual([]);
  });

  it("leaves cleanup-failed output unmarked and preserves the primary failure", async () => {
    const repositoryRoot = await createTemporaryDirectory("lineageguard-capture-cleanup-");
    const output = createRecordingWriter();
    const primary = new Error("primary capture failure");
    let candidate: string | undefined;
    const dependencies = createCliDependencies(repositoryRoot, output.writer, {
      createCandidateDirectory: async (prefix) => {
        candidate = await mkdtemp(prefix);
        return candidate;
      },
      capture: async (_config, destination) => {
        await writeFile(join(destination, fixtureFileNames[0]), "{}\n", {
          encoding: "utf8",
          flag: "wx",
        });
        throw primary;
      },
      removeCandidate: async () => {
        throw new Error("secondary cleanup failure");
      },
    });

    await expect(runFixtureCaptureCli(dependencies)).rejects.toBe(primary);
    if (candidate === undefined) throw new Error("Expected a candidate directory.");
    await expect(access(candidate)).resolves.toBeUndefined();
    await expect(access(join(candidate, fixtureCompletionMarker))).rejects.toThrow();
    expect(output.chunks).toEqual([]);
  });

  it("refuses final cleanup when a completion marker appears before directory removal", async () => {
    const repositoryRoot = await createTemporaryDirectory("lineageguard-capture-cleanup-marker-");
    const output = createRecordingWriter();
    const primary = new Error("capture failed before cleanup marker race");
    let candidate: string | undefined;
    const dependencies = createCliDependencies(repositoryRoot, output.writer, {
      createCandidateDirectory: async (prefix) => {
        candidate = await mkdtemp(prefix);
        return candidate;
      },
      capture: async (_config, destination) => {
        await writeFile(join(destination, fixtureFileNames[0]), "{}\n", "utf8");
        throw primary;
      },
      beforeCleanupRemoval: async (path) => {
        if (candidate !== undefined && path === candidate) {
          await writeFile(join(candidate, fixtureCompletionMarker), "", {
            encoding: "utf8",
            flag: "wx",
          });
        }
      },
    });

    await expect(runFixtureCaptureCli(dependencies)).rejects.toBe(primary);
    if (candidate === undefined) throw new Error("Expected a candidate directory.");
    await expect(lstat(join(candidate, fixtureCompletionMarker))).resolves.toMatchObject({
      size: 0,
    });
    await expect(readdir(candidate)).resolves.toEqual([fixtureCompletionMarker]);
    expect(output.chunks).toEqual([]);
  });

  it("refuses cleanup when a regular entry is substituted before its removal", async () => {
    const repositoryRoot = await createTemporaryDirectory("lineageguard-capture-cleanup-entry-");
    const output = createRecordingWriter();
    const primary = new Error("capture failed before cleanup entry race");
    const replacement = "do not remove replacement\n";
    let candidate: string | undefined;
    let displacedEntry: string | undefined;
    let substituted = false;
    const dependencies = createCliDependencies(repositoryRoot, output.writer, {
      createCandidateDirectory: async (prefix) => {
        candidate = await mkdtemp(prefix);
        return candidate;
      },
      capture: async (_config, destination) => {
        await writeFile(join(destination, fixtureFileNames[0]), "original\n", "utf8");
        throw primary;
      },
      beforeCleanupRemoval: async (path) => {
        if (
          !substituted &&
          candidate !== undefined &&
          path === join(candidate, fixtureFileNames[0])
        ) {
          substituted = true;
          displacedEntry = join(dirname(candidate), "displaced-entry.txt");
          await rename(path, displacedEntry);
          await writeFile(path, replacement, "utf8");
        }
      },
    });

    await expect(runFixtureCaptureCli(dependencies)).rejects.toBe(primary);
    if (candidate === undefined || displacedEntry === undefined) {
      throw new Error("Expected entry substitution.");
    }
    await expect(readFile(join(candidate, fixtureFileNames[0]), "utf8")).resolves.toBe(replacement);
    await expect(readFile(displacedEntry, "utf8")).resolves.toBe("original\n");
    await expect(access(join(candidate, fixtureCompletionMarker))).rejects.toThrow();
    expect(output.chunks).toEqual([]);
  });

  it("refuses cleanup when an owned candidate contains a linked entry", async () => {
    const sandbox = await createTemporaryDirectory("lineageguard-capture-linked-cleanup-");
    const repositoryRoot = join(sandbox, "repository");
    const outside = join(sandbox, "outside");
    const sentinel = join(outside, "sentinel.txt");
    await mkdir(repositoryRoot);
    await mkdir(outside);
    await writeFile(sentinel, "keep\n", "utf8");
    const output = createRecordingWriter();
    const primary = new Error("capture failed after linked output");
    let candidate: string | undefined;
    const dependencies = createCliDependencies(repositoryRoot, output.writer, {
      createCandidateDirectory: async (prefix) => {
        candidate = await mkdtemp(prefix);
        return candidate;
      },
      capture: async (_config, destination) => {
        await symlink(
          outside,
          join(destination, fixtureFileNames[0]),
          process.platform === "win32" ? "junction" : "dir",
        );
        throw primary;
      },
    });

    await expect(runFixtureCaptureCli(dependencies)).rejects.toBe(primary);
    if (candidate === undefined) throw new Error("Expected a candidate directory.");
    await expect(access(candidate)).resolves.toBeUndefined();
    await expect(access(join(candidate, fixtureCompletionMarker))).rejects.toThrow();
    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep\n");
    expect(output.chunks).toEqual([]);
  });

  it("removes a candidate when exclusive marker open fails", async () => {
    const repositoryRoot = await createTemporaryDirectory("lineageguard-capture-marker-open-");
    const output = createRecordingWriter();
    const primary = new Error("marker open failed");
    let candidate: string | undefined;
    const dependencies = createCliDependencies(repositoryRoot, output.writer, {
      createCandidateDirectory: async (prefix) => {
        candidate = await mkdtemp(prefix);
        return candidate;
      },
      openCompletionMarker: async () => {
        throw primary;
      },
    });

    await expect(runFixtureCaptureCli(dependencies)).rejects.toBe(primary);
    if (candidate === undefined) throw new Error("Expected a candidate directory.");
    await expect(access(candidate)).rejects.toThrow();
    expect(output.chunks).toEqual([]);
  });

  it("keeps completion authoritative when marker-handle close fails", async () => {
    const repositoryRoot = await createTemporaryDirectory("lineageguard-capture-marker-close-");
    const output = createRecordingWriter();
    const closeFailure = new Error(`close failed at C:\\private\\capture with ${token}`);
    const dependencies = createCliDependencies(repositoryRoot, output.writer, {
      openCompletionMarker: async (path) => {
        const handle = await open(path, "wx");
        return {
          close: async () => {
            await handle.close();
            throw closeFailure;
          },
        };
      },
    });

    const result = await runFixtureCaptureCli(dependencies);

    const marker = await lstat(join(result.destination, fixtureCompletionMarker));
    expect(marker.isFile()).toBe(true);
    expect(marker.size).toBe(0);
    expect(output.chunks.join("")).not.toContain(token);
    expect(output.chunks.join("")).not.toContain("C:\\private");
  });

  it("keeps completion authoritative when marker-handle close throws synchronously", async () => {
    const repositoryRoot = await createTemporaryDirectory(
      "lineageguard-capture-marker-sync-close-",
    );
    const output = createRecordingWriter();
    const closeFailure = new Error(`sync close failed at C:\\private\\capture with ${token}`);
    const dependencies = createCliDependencies(repositoryRoot, output.writer, {
      openCompletionMarker: async (path) => {
        const handle = await open(path, "wx");
        return {
          close: () => {
            void handle.close().catch(() => undefined);
            throw closeFailure;
          },
        };
      },
    });

    const result = await runFixtureCaptureCli(dependencies);

    const marker = await lstat(join(result.destination, fixtureCompletionMarker));
    expect(marker.isFile()).toBe(true);
    expect(marker.size).toBe(0);
    expect(output.chunks).toEqual([
      expect.stringMatching(
        /^Captured 5 sanitized DataHub fixture candidates at tmp\/datahub-fixture-captures\/capture-/,
      ),
    ]);
    expect(output.chunks.join("")).not.toContain(token);
    expect(output.chunks.join("")).not.toContain("C:\\private");
  });

  it("keeps a completed candidate successful when stdout throws", async () => {
    const repositoryRoot = await createTemporaryDirectory("lineageguard-capture-stdout-failure-");
    const stderr = createRecordingWriter();
    let candidate: string | undefined;
    const stdout: FixtureCaptureTextWriter = {
      write: () => {
        throw new Error(`stdout failed at C:\\\\private\\\\capture with ${token}`);
      },
    };
    const dependencies = createCliDependencies(repositoryRoot, stdout, {
      createCandidateDirectory: async (prefix) => {
        candidate = await mkdtemp(prefix);
        return candidate;
      },
    });

    await expect(runFixtureCaptureCommand(dependencies, stderr.writer)).resolves.toBe(0);
    if (candidate === undefined) throw new Error("Expected a candidate directory.");
    await expect(lstat(join(candidate, fixtureCompletionMarker))).resolves.toMatchObject({
      size: 0,
    });
    expect(stderr.chunks).toEqual([]);
  });

  it("keeps a completed candidate successful when stdout rejects asynchronously", async () => {
    const repositoryRoot = await createTemporaryDirectory("lineageguard-capture-stdout-rejection-");
    const stderr = createRecordingWriter();
    let candidate: string | undefined;
    const stdout: FixtureCaptureTextWriter = {
      write: () =>
        Promise.reject(new Error(`stdout rejected at C:\\\\private\\\\capture with ${token}`)),
    };
    const dependencies = createCliDependencies(repositoryRoot, stdout, {
      createCandidateDirectory: async (prefix) => {
        candidate = await mkdtemp(prefix);
        return candidate;
      },
    });

    await expect(runFixtureCaptureCommand(dependencies, stderr.writer)).resolves.toBe(0);
    if (candidate === undefined) throw new Error("Expected a candidate directory.");
    await expect(lstat(join(candidate, fixtureCompletionMarker))).resolves.toMatchObject({
      size: 0,
    });
    expect(stderr.chunks).toEqual([]);
  });

  it("maps raw failures to one fixed public CLI error", async () => {
    const repositoryRoot = await createTemporaryDirectory("lineageguard-capture-public-error-");
    const stdout = createRecordingWriter();
    const stderr = createRecordingWriter();
    const raw = new Error(`raw failure at C:\\private\\capture with ${token}`);
    const dependencies = createCliDependencies(repositoryRoot, stdout.writer, {
      capture: async () => {
        throw raw;
      },
    });

    await expect(runFixtureCaptureCli(dependencies)).rejects.toBe(raw);
    await expect(runFixtureCaptureCommand(dependencies, stderr.writer)).resolves.toBe(1);
    expect(stdout.chunks).toEqual([]);
    expect(stderr.chunks).toEqual(["DataHub fixture capture failed.\n"]);
    expect(stderr.chunks.join("")).not.toContain(token);
    expect(stderr.chunks.join("")).not.toContain("C:\\private");
  });

  it("contains rejected asynchronous stderr writes without leaking raw diagnostics", async () => {
    const repositoryRoot = await createTemporaryDirectory("lineageguard-capture-stderr-rejection-");
    const stdout = createRecordingWriter();
    const raw = new Error(`stderr rejected at C:\\private\\capture with ${token}`);
    const chunks: string[] = [];
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    const stderr: FixtureCaptureTextWriter = {
      write: (text) => {
        chunks.push(text);
        return Promise.reject(raw);
      },
    };
    const dependencies = createCliDependencies(repositoryRoot, stdout.writer, {
      capture: async () => {
        throw raw;
      },
    });

    process.on("unhandledRejection", onUnhandledRejection);
    try {
      await expect(runFixtureCaptureCommand(dependencies, stderr)).resolves.toBe(1);
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(chunks).toEqual(["DataHub fixture capture failed.\n"]);
    expect(chunks.join("")).not.toContain(token);
    expect(chunks.join("")).not.toContain("C:\\private");
    expect(unhandledRejections).toEqual([]);
  });
});
