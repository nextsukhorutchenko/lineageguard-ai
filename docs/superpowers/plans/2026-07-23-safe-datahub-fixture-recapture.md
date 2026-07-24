# Safe DataHub Fixture Recapture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the documented DataHub fixture capture command produce a safe, reviewable five-fixture candidate without modifying committed fixtures, and document the existing `INCOMPLETE_EVIDENCE` behavior accurately.

**Architecture:** Keep live DataHub collection in `captureDataHubFixtures`, extract a strict create-only fixture writer, and add a module-anchored CLI orchestrator that owns one `mkdtemp` candidate beneath `tmp/datahub-fixture-captures/`. A candidate becomes complete only after the exact five regular non-link fixture files pass strict on-disk validation and an empty `.complete` marker is created through exclusive open.

**Tech Stack:** Node.js `22.23.1`, TypeScript `6.0.3` with strict ESM/NodeNext settings, pnpm `10.10.0`, Zod `4.4.3`, Vitest `4.1.10`, Prettier `3.9.6`, and Node built-in filesystem/path APIs.

## Global Constraints

- Treat `docs/superpowers/specs/2026-07-23-safe-datahub-fixture-recapture-design.md` as the approved authority for this remediation.
- Commit this plan separately before execution and begin Task 1 from a fully clean `agent/nextjs-openai-agent-spec` worktree.
- Modify only `scripts/capture-datahub-fixtures.ts`, `scripts/capture-datahub-fixtures.test.ts`, `README.md`, and `docs/demo-scenario.md` during implementation.
- Do not modify committed files beneath `tests/fixtures/datahub/`.
- Do not modify impact scoring, report-status derivation, dependencies, `pnpm-lock.yaml`, CI, integration-test contracts, or application source.
- Keep the exact five fixture filenames in the existing `fixtureFileNames` tuple:
  - `search-order-details.json`;
  - `schema-order-details.json`;
  - `lineage-order-details-table.json`;
  - `lineage-order-details-customer-id.json`; and
  - `entity-context-order-details-impact.json`.
- Write live candidates only beneath the module-anchored repository path `tmp/datahub-fixture-captures/capture-*`; never derive the default from `process.cwd()`.
- Create the fixed `tmp` and `datahub-fixture-captures` root components one at a
  time with non-recursive `mkdir`, validating each component before creating
  the next; never recursively create the full root through an unchecked path.
- Validate every fixture through its strict replay schema and serialize all five payloads before the first filesystem write.
- Keep every fixture write and the `.complete` marker create-only.
- Define successful exclusive `open(".complete", "wx")` as the irreversible completion point. Treat a later marker-handle close failure as suppressed cleanup failure; it must not downgrade or delete the completed candidate.
- A complete candidate contains exactly five strict regular non-link fixture files plus one zero-byte regular non-link `.complete` marker.
- Reject lexical escape, physical escape, symbolic links, and Windows junctions. Cleanup may target only the owned pre-completion candidate and must never traverse a link or remove an existing completed candidate.
- Keep the executable error exactly `DataHub fixture capture failed.` with a trailing newline. Never expose a token, stack, raw dependency error, or unrestricted native path.
- Keep all mandatory tests deterministic, offline, credential-free, and independent of live DataHub, Docker, or OpenAI.
- Keep code, tests, documentation, CLI copy, and commits in English.
- Do not push, merge, or open/update a pull request as part of this plan.

## Target File Map

- Read: `docs/superpowers/specs/2026-07-23-safe-datahub-fixture-recapture-design.md` — approved requirements and acceptance criteria.
- Modify: `scripts/capture-datahub-fixtures.ts` — strict writer, safe candidate filesystem boundary, completion marker, and bounded executable entrypoint.
- Modify: `scripts/capture-datahub-fixtures.test.ts` — offline positive, negative, containment, cleanup, completion, and public-error tests.
- Modify: `README.md` — five-fixture candidate workflow and `INCOMPLETE_EVIDENCE` operator semantics.
- Modify: `docs/demo-scenario.md` — live candidate capture, replay boundary, completion marker, and incomplete-evidence demo guidance.

No new production module, dependency, fixture, lockfile, CI workflow, browser flow, or live-service test is required.

---

### Task 1: Extract and Prove the Strict Create-Only Fixture Writer

**Files:**

- Read: `docs/superpowers/specs/2026-07-23-safe-datahub-fixture-recapture-design.md`
- Modify: `scripts/capture-datahub-fixtures.ts`
- Test: `scripts/capture-datahub-fixtures.test.ts`

**Interfaces:**

- Consumes: the existing `FixturePayloads`, `CapturedFixture`, `fixtureFileNames`, `fixtureSchemas`, `serializeFixture`, and `captureDataHubFixtures` contracts.
- Produces:

```ts
export async function writeFixturePayloads(
  payloads: FixturePayloads,
  token: string,
  destination: string,
): Promise<readonly CapturedFixture[]>;
```

- Guarantees: all five payloads are strictly validated and serialized before the first `wx` write; the caller must provide an existing candidate directory, which is immediately `lstat`-checked as a regular non-link directory, physically resolved with `realpath`, and used as the write root; existing files remain unchanged; `captureDataHubFixtures` delegates candidate persistence to this writer.

- [ ] **Step 1: Confirm clean scope and approved authority**

Run:

```powershell
$branch = git branch --show-current
if ($LASTEXITCODE -ne 0) {
  throw "Unable to read the current branch."
}
if ($branch -ne "agent/nextjs-openai-agent-spec") {
  throw "Unexpected branch: $branch"
}

$status = @(git status --porcelain)
if ($LASTEXITCODE -ne 0) {
  throw "Unable to inspect worktree status."
}
if ($status.Count -ne 0) {
  throw "Implementation requires a clean worktree: $($status -join '; ')"
}

$required = @(
  "docs/superpowers/specs/2026-07-23-safe-datahub-fixture-recapture-design.md",
  "scripts/capture-datahub-fixtures.ts",
  "scripts/capture-datahub-fixtures.test.ts"
)
foreach ($path in $required) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required file is missing: $path"
  }
}
```

Expected:

- branch is `agent/nextjs-openai-agent-spec`;
- the worktree is clean;
- every required file exists; and
- the command exits `0`.

Stop if any check fails. Do not overwrite, stage, or commit unrelated work.

- [ ] **Step 2: Add failing create-only writer tests**

Replace the imports at the top of
`scripts/capture-datahub-fixtures.test.ts` with:

```ts
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
```

Immediately after `const token = "local-test-token";`, add:

```ts
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
```

Leave the existing `complete`, `ordered`, `permuted`, `render`, and
`fixture canonicalization` code unchanged. Append this complete suite:

```ts
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
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
node node_modules/vitest/vitest.mjs run scripts/capture-datahub-fixtures.test.ts
```

Expected:

- Vitest selects exactly `scripts/capture-datahub-fixtures.test.ts`;
- the run fails because `writeFixturePayloads` is not exported; and
- no live DataHub connection is attempted.

If the test passes before implementation, stop and inspect the current diff and
test selection.

- [ ] **Step 4: Implement strict pre-validation, pre-serialization, an immediate physical write boundary, and create-only writes**

In `scripts/capture-datahub-fixtures.ts`, replace the Node filesystem and path
imports with the following imports, then add these helpers immediately after
`serializeFixture`:

```ts
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
```

```ts
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
```

Replace the complete existing `captureDataHubFixtures` function with:

```ts
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
```

Do not change `validateCommittedFixtures`, collection behavior, canonical
ordering, schemas, redaction, or committed fixture paths.

- [ ] **Step 5: Format and run the focused GREEN gate**

Run:

```powershell
node node_modules/prettier/bin/prettier.cjs --write scripts/capture-datahub-fixtures.ts scripts/capture-datahub-fixtures.test.ts
node node_modules/vitest/vitest.mjs run scripts/capture-datahub-fixtures.test.ts
pnpm typecheck
```

Expected:

- Prettier changes only the two named files if formatting is needed;
- Vitest reports exactly one selected test file and all writer/canonicalization
  tests pass;
- the seven forbidden-field rows reject before destination creation;
- strict TypeScript checking passes; and
- no live DataHub connection is attempted.

- [ ] **Step 6: Inspect and commit Task 1**

Run:

```powershell
git diff --check
git diff -- scripts/capture-datahub-fixtures.ts scripts/capture-datahub-fixtures.test.ts
git status --short
```

Expected: only the two Task 1 files are modified and `git diff --check` exits
`0`.

Then run:

```powershell
git add scripts/capture-datahub-fixtures.ts scripts/capture-datahub-fixtures.test.ts
git commit -m "fix: harden DataHub fixture candidate writes"
```

Expected: one focused commit containing the strict writer and its offline tests.

---

### Task 2: Add the Safe A1 Candidate Lifecycle and Bounded CLI Entrypoint

**Files:**

- Read: `docs/superpowers/specs/2026-07-23-safe-datahub-fixture-recapture-design.md`
- Modify: `scripts/capture-datahub-fixtures.ts`
- Test: `scripts/capture-datahub-fixtures.test.ts`

**Interfaces:**

- Consumes: Task 1's `writeFixturePayloads`, the existing strict fixture schemas,
  `loadRuntimeConfig`, and Node filesystem primitives.
- Produces:

```ts
export const fixtureCompletionMarker = ".complete";
export const fixtureCaptureRepositoryRoot: string;

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

export async function runFixtureCaptureCli(
  dependencies?: FixtureCaptureCliDependencies,
): Promise<FixtureCaptureCliResult>;

export async function runFixtureCaptureCommand(
  dependencies?: FixtureCaptureCliDependencies,
  stderr?: FixtureCaptureTextWriter,
): Promise<number>;
```

- Completion: successful exclusive marker open is authoritative; marker close is
  best-effort and cannot downgrade the candidate. The exact five-file set is
  strictly validated immediately before marker creation, and the positive
  lifecycle test independently `lstat`s all five fixtures plus the marker after
  the runner returns.
- Public errors: command wrapper writes only
  `DataHub fixture capture failed.\n` and returns exit code `1`.

- [ ] **Step 1: Add failing lifecycle, containment, cleanup, and error tests**

Replace the import block in `scripts/capture-datahub-fixtures.test.ts` with:

```ts
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
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
```

After the existing `render` helper and before the `describe` blocks, add:

```ts
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

function fixtureEnvironment(): NodeJS.ProcessEnv {
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
    removeCandidate: (path) =>
      rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
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
```

Append this complete suite after the Task 1 writer tests:

```ts
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
});
```

- [ ] **Step 2: Run the focused lifecycle tests and verify RED**

Run:

```powershell
node node_modules/vitest/vitest.mjs run scripts/capture-datahub-fixtures.test.ts
```

Expected:

- Vitest selects exactly one test file;
- compilation fails because the new lifecycle exports do not exist; and
- no live DataHub, Docker, or OpenAI dependency is contacted.

- [ ] **Step 3: Add the filesystem imports, constants, and public interfaces**

Replace the Node built-in imports at the top of
`scripts/capture-datahub-fixtures.ts` with:

```ts
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
```

Immediately after `fixtureFileNames`, add:

```ts
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
```

- [ ] **Step 4: Add lexical, physical, and link-safe directory validation**

Immediately after the existing `fixtureSchemas` declaration, add:

```ts
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
```

These helpers deliberately mirror the repository's existing artifact-writer
pattern while keeping the remediation inside the approved script file.

- [ ] **Step 5: Add exact on-disk validation, safe cleanup, and default dependencies**

Immediately after `validateCommittedFixtures`, add:

```ts
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
```

The cleanup comment states a required implementation invariant.

- [ ] **Step 6: Replace the broken `main` destination with the A1 runner and bounded command**

Delete the existing private `main()` function and replace it with:

```ts
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
```

Replace the current entrypoint footer with:

```ts
const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  process.exitCode = await runFixtureCaptureCommand();
}
```

Do not add `--replace`, explicit committed-fixture destinations, raw error
printing, or a directory rename.

- [ ] **Step 7: Format and run the focused GREEN gate**

Run:

```powershell
node node_modules/prettier/bin/prettier.cjs --write scripts/capture-datahub-fixtures.ts scripts/capture-datahub-fixtures.test.ts
node node_modules/vitest/vitest.mjs run scripts/capture-datahub-fixtures.test.ts
pnpm typecheck
```

Expected:

- Prettier changes only the two named files if needed;
- Vitest reports exactly one selected file and all canonicalization, writer,
  containment, completion, cleanup, and public-error tests pass;
- the close-failure test still returns success with a zero-byte marker;
- every pre-completion failure emits no success output;
- TypeScript strict checking passes; and
- no live service is contacted.

- [ ] **Step 8: Inspect and commit Task 2**

Run:

```powershell
git diff --check
git diff -- scripts/capture-datahub-fixtures.ts scripts/capture-datahub-fixtures.test.ts
git status --short
```

Expected: only the two Task 2 files are modified and the focused diff contains
no committed fixture, dependency, status, or CI change.

Then run:

```powershell
git add scripts/capture-datahub-fixtures.ts scripts/capture-datahub-fixtures.test.ts
git commit -m "fix: capture DataHub fixtures into safe candidates"
```

Expected: one focused commit containing the complete A1 candidate lifecycle.

---

### Task 3: Correct Operator Documentation and Run the Full Offline Gate

**Files:**

- Read: `docs/superpowers/specs/2026-07-23-safe-datahub-fixture-recapture-design.md`
- Modify: `README.md`
- Modify: `docs/demo-scenario.md`
- Verify: `scripts/capture-datahub-fixtures.ts`
- Verify: `scripts/capture-datahub-fixtures.test.ts`
- Verify: `tests/fixture-impact-analysis.test.ts`
- Verify: `src/app/run-impact-analysis.test.ts`

**Interfaces:**

- Consumes: Task 2's `capture-*` plus `.complete` workflow and the already
  implemented `INCOMPLETE_EVIDENCE` status derivation.
- Produces: operator documentation that describes five fixtures, candidate
  completion, reviewed promotion, replay limitations, lower-bound evidence, and
  separate Context Coverage semantics.

- [ ] **Step 1: Run the one-time documentation RED check**

Run:

```powershell
$readme = Get-Content -Raw -LiteralPath "README.md"
$demo = Get-Content -Raw -LiteralPath "docs/demo-scenario.md"
$problems = @()
$fixtureNames = @(
  "search-order-details.json",
  "schema-order-details.json",
  "lineage-order-details-table.json",
  "lineage-order-details-customer-id.json",
  "entity-context-order-details-impact.json"
)

if ($readme.Contains("Recapture the four deterministic")) {
  $problems += "README still says four fixtures."
}
if (-not $readme.Contains('| `INCOMPLETE_EVIDENCE`')) {
  $problems += "README status table omits INCOMPLETE_EVIDENCE."
}
if (-not $readme.Contains('`.complete`')) {
  $problems += "README omits the candidate completion marker."
}
if (-not $demo.Contains('`.complete`')) {
  $problems += "Demo scenario omits the candidate completion marker."
}
foreach ($name in $fixtureNames) {
  if (-not $readme.Contains($name) -or -not $demo.Contains($name)) {
    $problems += "Documentation omits fixture: $name"
  }
}
foreach ($document in @(
  @{ Name = "README"; Text = $readme },
  @{ Name = "Demo scenario"; Text = $demo }
)) {
  foreach ($requiredPhrase in @("lower bounds", "Context Coverage", "unmarked candidate is untrusted", 'do not manually create, copy, or add `.complete`')) {
    if (-not $document.Text.Contains($requiredPhrase)) {
      $problems += "$($document.Name) omits required operator semantics: $requiredPhrase"
    }
  }
}

if ($problems.Count -gt 0) {
  throw ($problems -join " ")
}
```

Expected: FAIL and name the stale four-fixture wording plus every missing
required status, marker, five-filename, lower-bound, Context Coverage, and
unmarked-candidate operator statement.

This is a one-time documentation contract check. Do not add a persistent
exact-prose test.

- [ ] **Step 2: Add the missing report-producing status and evidence semantics**

In `README.md`, replace the current report-status table and the sentence
immediately after it with:

```markdown
| Status                       | Meaning                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `COMPLETED`                  | Downstream tables and at least one exact-URN column confirmation are available; coverage gaps may remain.              |
| `COMPLETED_WITH_LIMITATIONS` | Downstream tables exist, but no column-lineage result confirms an exact downstream table URN.                          |
| `INSUFFICIENT_METADATA`      | No downstream lineage was returned within the two-hop boundary.                                                        |
| `INCOMPLETE_EVIDENCE`        | Search, schema, table-lineage, or column-lineage collection is incomplete; collected affected counts are lower bounds. |

`INCOMPLETE_EVIDENCE` still produces a report when enough validated evidence exists to continue. Incomplete search or schema cannot prove that a dataset or source column is absent, and incomplete lineage cannot justify a direct rename. The status changes execution policy without changing the deterministic impact formula. Entity-context gaps remain separate Context Coverage information and do not, by themselves, select `INCOMPLETE_EVIDENCE`.

Input, resolution, missing-column, DataHub/MCP, and artifact failures return actionable terminal guidance and do not fabricate a report.
```

Do not modify application status code or impact scoring.

- [ ] **Step 3: Replace the broken four-fixture recapture instructions**

In `README.md`, replace the current paragraph beginning
`Recapture the four deterministic` and its command block with:

````markdown
Capture a review candidate when intentionally revalidating the pinned datapack:

```powershell
pnpm tsx scripts/capture-datahub-fixtures.ts
```

The command writes a new create-only candidate beneath `tmp/datahub-fixture-captures/capture-*`; it never writes to or replaces `tests/fixtures/datahub/`. A candidate is complete only when all five strict regular fixture files are present and an empty `.complete` marker was created last:

| Fixture                                    | Replay evidence                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `search-order-details.json`                | Exact dataset-search candidates and collection completeness.            |
| `schema-order-details.json`                | Target schema fields and collection completeness.                       |
| `lineage-order-details-table.json`         | Bounded downstream table lineage.                                       |
| `lineage-order-details-customer-id.json`   | Bounded downstream lineage for the source column `customer_id`.         |
| `entity-context-order-details-impact.json` | Allowlisted context for the target and deduplicated table-lineage URNs. |

Each fixture is a canonical strict `{ items, completeness }` replay envelope. The entity-context schema rejects fields named `email`, `profile`, `relatedDocuments`, `rawSql`, `token`, and `diagnostics`, and rejects descriptions longer than 2,000 characters; serialization redacts the configured DataHub token literal. This is a field-name and configured-literal guarantee, not a general content scan for every possible SQL or credential string. Candidate output is replay-compatible review evidence, not proof of current live DataHub state. An unmarked candidate is untrusted even if its files look complete: do not manually create, copy, or add `.complete`; delete it and rerun capture. Promoting a candidate requires a separate owner-approved deterministic fixture migration and version-control review; do not copy `.complete` into committed fixtures.
````

Keep the existing token-leak verification section immediately after this new
block.

- [ ] **Step 4: Update the demo scenario with the same candidate boundary**

In `docs/demo-scenario.md`, change:

```markdown
## Run the Live MCP Proof and Capture Fixtures
```

to:

```markdown
## Run the Live MCP Proof and Capture a Fixture Candidate
```

Immediately after the command block ending with
`pnpm tsx scripts/capture-datahub-fixtures.ts`, add:

```markdown
The capture command prints a repository-relative path beneath `tmp/datahub-fixture-captures/capture-*`. It never overwrites the committed replay fixtures. A complete candidate contains these five canonical strict `{ items, completeness }` fixtures plus an empty `.complete` marker created last:

| Fixture                                    | Purpose                                           |
| ------------------------------------------ | ------------------------------------------------- |
| `search-order-details.json`                | Exact dataset-search candidates.                  |
| `schema-order-details.json`                | Target schema fields.                             |
| `lineage-order-details-table.json`         | Two-hop downstream table lineage.                 |
| `lineage-order-details-customer-id.json`   | Two-hop downstream lineage for `customer_id`.     |
| `entity-context-order-details-impact.json` | Allowlisted target and downstream entity context. |

The candidate is replay-compatible review evidence rather than a current live-service claim. The entity-context schema rejects fields named `email`, `profile`, `relatedDocuments`, `rawSql`, `token`, and `diagnostics`, and rejects descriptions longer than 2,000 characters; serialization redacts the configured DataHub token literal. This does not claim a general content scan for every SQL or credential-shaped string. An unmarked candidate is untrusted even if its files look complete: do not manually create, copy, or add `.complete`; delete it and rerun capture. Promotion into `tests/fixtures/datahub/` is a separate owner-approved deterministic migration; the `.complete` marker is never promoted.
```

Immediately after the paragraph beginning `These counts and mappings are
verified fixture facts`, add:

```markdown
The certified golden replay has complete search, schema, table-lineage, and column-lineage collections for the stated 24/11 facts. If any required collection is incomplete, LineageGuard uses `INCOMPLETE_EVIDENCE`: collected counts are lower bounds, incomplete search/schema cannot prove absence, and incomplete lineage cannot justify direct-rename guidance. Entity-context gaps are reported separately as Context Coverage and do not alone select that status.
```

- [ ] **Step 5: Format the documentation and rerun the contract check**

Run:

```powershell
node node_modules/prettier/bin/prettier.cjs --write README.md docs/demo-scenario.md

$readme = Get-Content -Raw -LiteralPath "README.md"
$demo = Get-Content -Raw -LiteralPath "docs/demo-scenario.md"
$problems = @()
$fixtureNames = @(
  "search-order-details.json",
  "schema-order-details.json",
  "lineage-order-details-table.json",
  "lineage-order-details-customer-id.json",
  "entity-context-order-details-impact.json"
)

if ($readme.Contains("Recapture the four deterministic")) {
  $problems += "README still says four fixtures."
}
if (-not $readme.Contains('| `INCOMPLETE_EVIDENCE`')) {
  $problems += "README status table omits INCOMPLETE_EVIDENCE."
}
if (-not $readme.Contains('`.complete`')) {
  $problems += "README omits the candidate completion marker."
}
if (-not $demo.Contains('`.complete`')) {
  $problems += "Demo scenario omits the candidate completion marker."
}
foreach ($name in $fixtureNames) {
  if (-not $readme.Contains($name) -or -not $demo.Contains($name)) {
    $problems += "Documentation omits fixture: $name"
  }
}
foreach ($document in @(
  @{ Name = "README"; Text = $readme },
  @{ Name = "Demo scenario"; Text = $demo }
)) {
  foreach ($requiredPhrase in @("lower bounds", "Context Coverage", "unmarked candidate is untrusted", 'do not manually create, copy, or add `.complete`')) {
    if (-not $document.Text.Contains($requiredPhrase)) {
      $problems += "$($document.Name) omits required operator semantics: $requiredPhrase"
    }
  }
}
if ($problems.Count -gt 0) {
  throw ($problems -join " ")
}
```

Expected:

- only the two documentation files are formatted;
- the contract check exits `0`; and
- no stale four-fixture statement remains; and
- both documents name all five fixtures and state lower-bound,
  `Context Coverage`, and unmarked-candidate marker semantics.

- [ ] **Step 6: Run the focused offline regression slice and prove selection**

Run:

```powershell
$focused = @(
  "scripts/capture-datahub-fixtures.test.ts",
  "tests/fixture-impact-analysis.test.ts",
  "src/app/run-impact-analysis.test.ts"
)
$missing = @($focused | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
if ($missing.Count -gt 0) {
  throw "Focused test file is missing: $($missing -join ', ')"
}
$focused | ForEach-Object { Write-Output "Focused test: $_" }
node node_modules/vitest/vitest.mjs run @focused
if ($LASTEXITCODE -ne 0) {
  throw "Focused regression slice failed."
}
```

Expected:

- PowerShell prints exactly three test paths;
- Vitest reports exactly three selected files;
- all fixture capture, replay, evidence-completeness, context-coverage, and
  report-status tests pass; and
- no live service is contacted.

- [ ] **Step 7: Run the complete mandatory repository gate**

Run each command separately and verify exit code `0`:

```powershell
pnpm format:check
```

```powershell
pnpm lint
```

```powershell
pnpm typecheck
```

```powershell
pnpm test
```

```powershell
pnpm build:cli
```

Expected:

- formatting, lint, strict TypeScript, the complete offline suite, and CLI
  build all pass;
- `pnpm test` continues to exclude `tests/integration/**`;
- no credential or live service is required; and
- skipped live verification is not reported as passing.

`pnpm test:integration` is optional and must be reported separately. Run it only
when the documented pinned local DataHub environment and credentials are
already configured; never add it to the mandatory evidence.

- [ ] **Step 8: Check secrets, focused diff, and final scope**

Run:

```powershell
$package = Get-Content -Raw -LiteralPath "package.json" | ConvertFrom-Json
if ($null -ne $package.scripts.'security:scan') {
  pnpm security:scan
  if ($LASTEXITCODE -ne 0) {
    throw "Repository secret scan failed."
  }
} else {
  Write-Output "No repository-provided security:scan script is available; not reported as passing."
}
```

Then run:

```powershell
git diff --check
git diff -- README.md docs/demo-scenario.md
git status --short
```

Expected:

- secret scanning passes if the repository provides it; otherwise its absence
  is reported truthfully;
- `git diff --check` exits `0`;
- only `README.md` and `docs/demo-scenario.md` remain modified after the first
  two task commits;
- no token, native private path, raw MCP error, fixture payload, dependency,
  lockfile, CI, or status-derivation change is present.

- [ ] **Step 9: Commit documentation and inspect the complete remediation**

Run:

```powershell
git add README.md docs/demo-scenario.md
git commit -m "docs: explain safe DataHub fixture candidates"
```

Then run:

```powershell
git log -3 --oneline
git diff --check HEAD~3..HEAD
git diff --stat HEAD~3..HEAD
git status --short --branch
```

Expected:

- the latest three implementation commits are the Task 1 writer, Task 2
  candidate lifecycle, and Task 3 documentation commits;
- the three-commit diff contains only the four approved implementation files;
- the worktree is clean; and
- the branch remains unpushed until the project owner requests publication.

---

## Post-Implementation Review Gate

After all three tasks:

1. use `superpowers:requesting-code-review` for an independent whole-remediation
   review against the approved design and this plan;
2. address any Critical or Important finding through
   `superpowers:receiving-code-review` and the appropriate TDD/debugging skill;
3. rerun the focused and complete offline gates after every remediation;
4. use `superpowers:verification-before-completion` before claiming success;
5. inspect the complete branch diff, not only the last commit; and
6. use `superpowers:finishing-a-development-branch` only after all required
   checks and reviews pass.

Do not push, update the pull request, or merge without an explicit project-owner
instruction.
