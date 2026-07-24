# DataHub Runtime Blocker Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the four approved DataHub runtime blockers without changing product scope: require canonical-URN proof for incomplete search, bound every MCP call/result/close path, and close the catalog before publishing a successful impact report.

**Architecture:** Add one small MCP boundary-policy module beneath the existing catalog adapter, keep application-level raw-result accounting beside JSON decoding, and retain the current deterministic domain and artifact modules. The application continues to resolve complete search through the existing generic resolver, while incomplete search uses one narrow canonical-URN helper; successful orchestration renders in memory, closes the bounded catalog, rechecks cancellation, and only then invokes the existing create-only writer.

**Tech Stack:** Node.js `22.23.1`, TypeScript `6.0.3` with strict ESM/NodeNext settings, pnpm `10.10.0`, `@modelcontextprotocol/sdk` `1.29.0`, Zod `4.4.3`, Vitest `4.1.10`, and Prettier `3.9.6`.

## Global Constraints

- Treat `docs/superpowers/specs/2026-07-23-datahub-runtime-blocker-remediation-design.md` as the approved corrective authority.
- Preserve the approved product behavior in specifications 001 and 002 except where the corrective design explicitly supersedes their implementation-plan guidance.
- Commit this implementation plan separately before execution and begin Task 1 from a clean `agent/nextjs-openai-agent-spec` worktree.
- Keep the four-operation read-only allowlist exactly `search`, `list_schema_fields`, `get_lineage`, and `get_entities`.
- Do not add mutation, SQL execution, a custom MCP transport, an SDK fork, a dependency, an environment variable, a retry loop, or a CI restructuring.
- Keep the SDK JSON-RPC framing limitation explicit: the application budget begins after the pinned SDK has framed and parsed the protocol response.
- Use these certified constants with no runtime override:
  - tool-call deadline: `15_000` ms;
  - close deadline: `5_000` ms;
  - complete `CallToolResult` budget: `1_048_576` accounted bytes;
  - maximum JSON container depth: `64`, counting the root `CallToolResult` container as depth 1;
  - maximum visited JSON values: `100_000`, counting the root and every array element or object-property value; object keys consume bytes but not nodes.
- Account for the full MCP result before selecting `structuredContent`, joining text, calling `JSON.parse`, invoking a tool schema, normalizing evidence, or persisting output.
- Account for JSON syntax and escaping plus one UTF-8 newline byte between every pair of text blocks that `decodeJsonToolResult` would join.
- Reject cycles, accessors, sparse arrays, non-finite numbers, `bigint`, `undefined`, functions, symbols, custom object prototypes, and every other non-JSON value with fixed value-free errors.
- Use these raw schema maxima:
  - search results: `50`;
  - schema fields: `100`;
  - lineage results: `100`;
  - entity results: `10`;
  - URNs, names, field paths, and lineage-column names: `500` characters;
  - platform names and entity types: `100` characters;
  - native data types: `500` characters;
  - descriptions and per-entity error text: `2_000` characters;
  - nested lineage-column arrays: `100` entries;
  - owners, tags, glossary terms, siblings, assertions, and quality-signal arrays: `100` entries each; existing normalization still emits at most `20` entries per category.
- Unknown passthrough object fields may remain forward-compatible, but the global byte/depth/node budget must cover them and normalization must not copy them.
- Preserve caller abort classification exactly. Map owned call expiry and dependency call failure to fixed `DATAHUB_UNAVAILABLE`; map close rejection/expiry to fixed `MCP_UNAVAILABLE`.
- Never inspect, log, persist, or expose `AbortSignal.reason`, SDK timeout payloads, native dependency exceptions, raw MCP results, secrets, or unrestricted native paths.
- A successful tool trace entry may be committed only after the bounded result has decoded and passed the tool-specific schema.
- The startup owner and the catalog owner each invoke their underlying close at most once, return the same cached settlement to repeated callers, and ignore late settlement.
- An incomplete search may continue only when the user hint is a canonical dataset URN and exactly one collected `candidate.urn` matches it under existing normalization. Do not deduplicate duplicate matching candidates.
- Complete search retains exact URN, exact name, explicit `platform:name`, URN-derived `platform:name`, not-found, and sorted ambiguity behavior.
- Treat a rendered report as `readyToPublish`, not completed. Required close must succeed, caller cancellation must be rechecked, and only then may the existing create-only writer expose `impact-report.md`.
- Preserve the primary analysis error when close also fails. Attach only the existing fixed suppressed-cleanup record.
- Do not modify the legacy writer, impact formula, evidence statuses, Context Coverage, future four-file atomic package protocol, fixture payloads, or the separate stale-example finding.
- Keep mandatory tests deterministic, offline, credential-free, and controlled by fake timers. Do not require Docker, DataHub, OpenAI, or network access.
- Use `.\node_modules\.bin\vitest.cmd run ...` for focused Vitest commands in this Windows worktree; do not use the unresolved `pnpm vitest run` form.
- Prove the selected file inventory before trusting the broad offline suite.
- Keep code, tests, comments, documentation, UI/CLI text, and commit messages in English.
- Do not push, merge, open or update a pull request, or clean up the worktree as part of this plan.

## Target File Map

- Read: `AGENTS.md` — process, trust-boundary, testing, and definition-of-done authority.
- Read: `docs/superpowers/specs/2026-07-23-datahub-runtime-blocker-remediation-design.md` — approved corrective behavior.
- Create: `src/datahub/mcp/mcp-boundary-policy.ts` — certified MCP constants, first-wins bounded tool-call primitive, and cached bounded-close primitive.
- Create: `src/datahub/mcp/mcp-boundary-policy.test.ts` — fake-timer unit proof for deadline ownership, cancellation provenance, listener disposal, late settlement, and close-once behavior.
- Modify: `src/datahub/mcp/mcp-client.ts` — explicit SDK `timeout`/`maxTotalTimeout` forwarding and bounded startup cleanup.
- Modify: `src/datahub/mcp/datahub-mcp-catalog.ts` — shared bounded calls, bounded idempotent normal close, and trace commit after validation.
- Modify: `src/datahub/mcp/datahub-mcp-catalog.test.ts` — four-tool deadline integration, SDK-option forwarding, startup/normal close, late-result, schema-public-error, and trace regressions.
- Create: `src/datahub/mcp/mcp-tool-result-budget.ts` — iterative complete-result byte/depth/node/structure accounting.
- Create: `src/datahub/mcp/mcp-tool-result-budget.test.ts` — exact-boundary, escaping, Unicode, newline, ignored-content, nesting, node, cycle, and non-JSON accounting tests.
- Modify: `src/datahub/mcp/decode-tool-result.ts` — enforce the complete-result budget before selecting or decoding content.
- Modify: `src/datahub/mcp/decode-tool-result.test.ts` — pre-parse integration and fixed-error tests.
- Modify: `src/datahub/mcp/schemas.ts` — finite maxima for every declared MCP string and array.
- Create: `src/datahub/mcp/schemas.test.ts` — direct exact-limit and limit-plus-one schema tests.
- Modify: `src/domain/resolve-dataset.ts` — pure unique canonical candidate-URN matcher while preserving the generic complete-search resolver.
- Modify: `src/domain/resolve-dataset.test.ts` — helper boundaries plus missing complete-search name characterization.
- Modify: `src/app/run-impact-analysis.ts` — incomplete-search gate and `readyToPublish` close-before-write protocol.
- Modify: `src/app/run-impact-analysis.test.ts` — fail-closed resolution and terminal-publication regressions.
- Modify: `docs/specs/001-datahub-impact-slice/plan.md` — narrow historical corrective note.
- Modify: `docs/specs/002-nextjs-openai-agent-demo/plan.md` — canonical incomplete-search, shared MCP policy, and close-before-publication reuse.
- Regression only, with no production change expected: `src/cli.ts`, `src/cli.test.ts`, `src/artifacts/write-run-artifacts.ts`, `src/artifacts/write-run-artifacts.test.ts`, `scripts/capture-datahub-fixtures.ts`, `scripts/capture-datahub-fixtures.test.ts`, and `tests/integration/datahub-mcp.integration.test.ts`.

No dependency, lockfile, CI workflow, committed fixture, example report, Next.js, OpenAI, or browser file belongs in this remediation.

---

### Task 1: Add the Application-Owned MCP Boundary Primitives

**Files:**

- Read: `docs/superpowers/specs/2026-07-23-datahub-runtime-blocker-remediation-design.md`
- Create: `src/datahub/mcp/mcp-boundary-policy.ts`
- Create: `src/datahub/mcp/mcp-boundary-policy.test.ts`

**Interfaces:**

- Consumes: an optional caller `AbortSignal`, one promise-returning SDK invocation, or one promise-returning close operation.
- Produces:

```ts
export const DATAHUB_MCP_BOUNDARY_POLICY: Readonly<{
  readonly toolCallMs: 15_000;
  readonly closeMs: 5_000;
  readonly maxToolResultBytes: 1_048_576;
  readonly maxJsonDepth: 64;
  readonly maxJsonNodes: 100_000;
}>;

export interface OwnedMcpToolCallOptions {
  readonly signal: AbortSignal;
  readonly timeout: number;
  readonly maxTotalTimeout: number;
}

export function runWithMcpToolDeadline<T>(
  callerSignal: AbortSignal | undefined,
  invoke: (options: OwnedMcpToolCallOptions) => Promise<T>,
): Promise<T>;

export function createBoundedMcpClose(close: () => Promise<void>): () => Promise<void>;
```

- Guarantees: the first caller-abort or owned-deadline event wins immutably; dependency failure is sanitized; the application await settles even when the dependency ignores its signal; timers/listeners are disposed; repeated close calls return the same promise and invoke the dependency once.

- [ ] **Step 1: Confirm clean execution scope and authority**

Run:

```powershell
$branch = git branch --show-current
if ($LASTEXITCODE -ne 0 -or $branch -ne "agent/nextjs-openai-agent-spec") {
  throw "Task 1 must run on agent/nextjs-openai-agent-spec."
}

$status = @(git status --porcelain)
if ($LASTEXITCODE -ne 0 -or $status.Count -ne 0) {
  throw "Task 1 requires a clean worktree."
}

$required = @(
  "AGENTS.md",
  "docs/superpowers/specs/2026-07-23-datahub-runtime-blocker-remediation-design.md"
)
foreach ($path in $required) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Missing authority file: $path"
  }
}
```

Expected: the branch is correct, the worktree is clean, and both authority files exist.

- [ ] **Step 2: Write failing policy tests**

Create `src/datahub/mcp/mcp-boundary-policy.test.ts` with fake-timer cases that prove:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../errors/app-error.js";
import {
  createBoundedMcpClose,
  DATAHUB_MCP_BOUNDARY_POLICY,
  runWithMcpToolDeadline,
} from "./mcp-boundary-policy.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("DATAHUB_MCP_BOUNDARY_POLICY", () => {
  it("publishes only the certified constants", () => {
    expect(DATAHUB_MCP_BOUNDARY_POLICY).toEqual({
      toolCallMs: 15_000,
      closeMs: 5_000,
      maxToolResultBytes: 1_048_576,
      maxJsonDepth: 64,
      maxJsonNodes: 100_000,
    });
    expect(Object.isFrozen(DATAHUB_MCP_BOUNDARY_POLICY)).toBe(true);
  });
});

describe("runWithMcpToolDeadline", () => {
  it("owns a fifteen-second await and passes explicit SDK limits", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    let received:
      | {
          readonly signal: AbortSignal;
          readonly timeout: number;
          readonly maxTotalTimeout: number;
        }
      | undefined;
    const operation = runWithMcpToolDeadline(caller.signal, async (options) => {
      received = options;
      return new Promise<never>(() => undefined);
    });
    const rejected = expect(operation).rejects.toMatchObject({
      code: "DATAHUB_UNAVAILABLE",
      message: "DataHub is unavailable through the MCP adapter.",
      details: {},
    });

    expect(received).toMatchObject({ timeout: 15_000, maxTotalTimeout: 15_000 });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(received?.signal.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disposes its timer and caller listener after success", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener");

    await expect(runWithMcpToolDeadline(caller.signal, async () => "ok")).resolves.toBe("ok");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves the exact caller classification and disposes its listener", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    const classified = new AppError("DATAHUB_UNAVAILABLE", "Parent scope owns cancellation.");
    const operation = runWithMcpToolDeadline(caller.signal, async () => {
      return new Promise<never>(() => undefined);
    });

    caller.abort(classified);

    await expect(operation).rejects.toBe(classified);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses registration order for deterministic same-turn first-winner behavior", async () => {
    vi.useFakeTimers();
    const callerWins = new AbortController();
    const classified = new AppError("DATAHUB_UNAVAILABLE", "Caller won.");
    setTimeout(() => callerWins.abort(classified), 15_000);
    const first = runWithMcpToolDeadline(callerWins.signal, async () => {
      return new Promise<never>(() => undefined);
    });
    const firstRejected = expect(first).rejects.toBe(classified);
    await vi.advanceTimersByTimeAsync(15_000);
    await firstRejected;
    expect(vi.getTimerCount()).toBe(0);

    const deadlineWins = new AbortController();
    const second = runWithMcpToolDeadline(deadlineWins.signal, async () => {
      return new Promise<never>(() => undefined);
    });
    setTimeout(() => deadlineWins.abort(classified), 15_000);
    const secondRejected = expect(second).rejects.toMatchObject({
      code: "DATAHUB_UNAVAILABLE",
      message: "DataHub is unavailable through the MCP adapter.",
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await secondRejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sanitizes dependency rejection and disposes its boundary", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener");
    const deferred = Promise.withResolvers<string>();
    const operation = runWithMcpToolDeadline(caller.signal, async () => deferred.promise);
    deferred.reject(new Error("raw dependency failure with secret-token"));

    const error = await operation.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "DATAHUB_UNAVAILABLE", details: {} });
    expect(JSON.stringify(error)).not.toContain("raw dependency failure");
    expect(JSON.stringify(error)).not.toContain("secret-token");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("createBoundedMcpClose", () => {
  it("returns one cached settlement and closes once", async () => {
    const deferred = Promise.withResolvers<void>();
    let closeCount = 0;
    const close = createBoundedMcpClose(async () => {
      closeCount += 1;
      return deferred.promise;
    });

    const first = close();
    const second = close();

    expect(first).toBe(second);
    expect(closeCount).toBe(1);
    deferred.resolve();
    await expect(first).resolves.toBeUndefined();
    await expect(close()).resolves.toBeUndefined();
    expect(closeCount).toBe(1);
  });

  it("bounds a dependency that ignores cleanup and ignores late settlement", async () => {
    vi.useFakeTimers();
    const deferred = Promise.withResolvers<void>();
    let closeCount = 0;
    const close = createBoundedMcpClose(async () => {
      closeCount += 1;
      return deferred.promise;
    });
    const operation = close();
    const rejected = expect(operation).rejects.toMatchObject({
      code: "MCP_UNAVAILABLE",
      message: "The DataHub MCP client could not be closed.",
      details: {},
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    deferred.resolve();
    await Promise.resolve();
    expect(close()).toBe(operation);
    expect(closeCount).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sanitizes close rejection", async () => {
    const close = createBoundedMcpClose(async () => {
      throw new Error("raw close failure with secret-token");
    });

    const error = await close().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "MCP_UNAVAILABLE", details: {} });
    expect(JSON.stringify(error)).not.toContain("raw close failure");
    expect(JSON.stringify(error)).not.toContain("secret-token");
  });
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/datahub/mcp/mcp-boundary-policy.test.ts
```

Expected: FAIL because `mcp-boundary-policy.ts` and its exports do not exist.

- [ ] **Step 4: Implement the policy primitives**

Create `src/datahub/mcp/mcp-boundary-policy.ts`:

```ts
import { AppError } from "../../errors/app-error.js";

export const DATAHUB_MCP_BOUNDARY_POLICY = Object.freeze({
  toolCallMs: 15_000,
  closeMs: 5_000,
  maxToolResultBytes: 1_048_576,
  maxJsonDepth: 64,
  maxJsonNodes: 100_000,
} as const);

export interface OwnedMcpToolCallOptions {
  readonly signal: AbortSignal;
  readonly timeout: number;
  readonly maxTotalTimeout: number;
}

const toolUnavailable = (): AppError =>
  new AppError("DATAHUB_UNAVAILABLE", "DataHub is unavailable through the MCP adapter.");

const closeUnavailable = (): AppError =>
  new AppError("MCP_UNAVAILABLE", "The DataHub MCP client could not be closed.");

export async function runWithMcpToolDeadline<T>(
  callerSignal: AbortSignal | undefined,
  invoke: (options: OwnedMcpToolCallOptions) => Promise<T>,
): Promise<T> {
  callerSignal?.throwIfAborted();

  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onCallerAbort = (): void => {
      if (finished || callerSignal === undefined) return;

      let classified: unknown;
      try {
        callerSignal.throwIfAborted();
        return;
      } catch (error) {
        classified = error;
      }

      if (!finish(() => reject(classified))) return;
      controller.abort();
    };

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    };

    const finish = (settle: () => void): boolean => {
      if (finished) return false;
      finished = true;
      cleanup();
      settle();
      return true;
    };

    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    timer = setTimeout(() => {
      if (!finish(() => reject(toolUnavailable()))) return;
      controller.abort();
    }, DATAHUB_MCP_BOUNDARY_POLICY.toolCallMs);
    timer.unref();

    if (callerSignal?.aborted) {
      onCallerAbort();
      return;
    }

    let pending: Promise<T>;
    try {
      pending = invoke({
        signal: controller.signal,
        timeout: DATAHUB_MCP_BOUNDARY_POLICY.toolCallMs,
        maxTotalTimeout: DATAHUB_MCP_BOUNDARY_POLICY.toolCallMs,
      });
    } catch {
      finish(() => reject(toolUnavailable()));
      return;
    }

    void pending.then(
      (value) => {
        finish(() => resolve(value));
      },
      () => {
        finish(() => reject(toolUnavailable()));
      },
    );
  });
}

export function createBoundedMcpClose(close: () => Promise<void>): () => Promise<void> {
  let settlement: Promise<void> | undefined;

  return (): Promise<void> => {
    settlement ??= new Promise<void>((resolve, reject) => {
      let finished = false;
      const timer = setTimeout(() => {
        finish(() => reject(closeUnavailable()));
      }, DATAHUB_MCP_BOUNDARY_POLICY.closeMs);
      timer.unref();

      const finish = (settle: () => void): boolean => {
        if (finished) return false;
        finished = true;
        clearTimeout(timer);
        settle();
        return true;
      };

      let pending: Promise<void>;
      try {
        pending = close();
      } catch {
        finish(() => reject(closeUnavailable()));
        return;
      }

      void pending.then(
        () => {
          finish(resolve);
        },
        () => {
          finish(() => reject(closeUnavailable()));
        },
      );
    });

    return settlement;
  };
}
```

Keep both errors fixed and value-free. Do not accept caller-provided durations or messages.

- [ ] **Step 5: Run GREEN and strict type checking**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/datahub/mcp/mcp-boundary-policy.test.ts
pnpm typecheck
```

Expected: the new policy file passes, same-turn winners are deterministic under fake timers, no timer remains pending, and strict TypeScript passes.

- [ ] **Step 6: Commit the isolated policy primitive**

Run:

```powershell
git add src/datahub/mcp/mcp-boundary-policy.ts src/datahub/mcp/mcp-boundary-policy.test.ts
git diff --cached --check
git commit -m "feat: add bounded DataHub MCP policy"
```

Expected: one commit containing only the new policy module and unit test.

---

### Task 2: Enforce the Policy Across All MCP Reads and Cleanup Owners

**Files:**

- Read: `src/datahub/mcp/mcp-boundary-policy.ts`
- Modify: `src/datahub/mcp/mcp-client.ts`
- Modify: `src/datahub/mcp/datahub-mcp-catalog.ts`
- Modify: `src/datahub/mcp/datahub-mcp-catalog.test.ts`

**Interfaces:**

- Consumes:

```ts
runWithMcpToolDeadline<T>(
  callerSignal: AbortSignal | undefined,
  invoke: (options: OwnedMcpToolCallOptions) => Promise<T>,
): Promise<T>;

createBoundedMcpClose(close: () => Promise<void>): () => Promise<void>;
```

- Produces:

```ts
export interface McpToolClient {
  callTool(request: ToolCallRequest, options: OwnedMcpToolCallOptions): Promise<CallToolResult>;
  getServerInfo(): DataHubServerInfo;
  close(): Promise<void>;
}
```

- Guarantees: every catalog read passes a composed signal and explicit 15-second SDK limits, a caller-abort or owned-expiry winner cannot be rewritten later, successful traces appear only after decode/schema success, startup cleanup and normal close settle within five seconds, and both close owners invoke their dependency once.

- [ ] **Step 1: Extend the recording fake without changing existing request assertions**

In `src/datahub/mcp/datahub-mcp-catalog.test.ts`, import `afterEach`, `vi`, and `OwnedMcpToolCallOptions`; restore real timers/mocks after every case. Extend `RecordingMcpClient` with a parallel option log while retaining `calls`:

```ts
class RecordingMcpClient implements McpToolClient {
  readonly calls: ToolCallRequest[] = [];
  readonly callOptions: OwnedMcpToolCallOptions[] = [];
  closeCount = 0;

  constructor(private readonly results: readonly CallToolResult[]) {}

  async callTool(
    request: ToolCallRequest,
    options: OwnedMcpToolCallOptions,
  ): Promise<CallToolResult> {
    this.calls.push(request);
    this.callOptions.push(options);
    const result = this.results[this.calls.length - 1];
    if (!result) throw new Error("The fake has no result for this call.");
    return result;
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }

  getServerInfo() {
    return {};
  }
}
```

Add:

```ts
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
```

Update structural `McpToolClient` fakes in this test file to accept an unused second parameter when required by inference. Do not change request payload expectations.

- [ ] **Step 2: Write failing four-tool deadline, winner, and late-result tests**

Add a `describe("DataHubMcpCatalog owned boundary", ...)` block. Use this exact table so every allowlisted read is independently exercised:

```ts
const ownedReadCases = [
  {
    tool: "search",
    invoke: (catalog: DataHubMcpCatalog, signal?: AbortSignal) =>
      catalog.searchDatasets("orders", { signal }),
  },
  {
    tool: "list_schema_fields",
    invoke: (catalog: DataHubMcpCatalog, signal?: AbortSignal) =>
      catalog.listSchemaFields(DATASET_URN, { signal }),
  },
  {
    tool: "get_lineage",
    invoke: (catalog: DataHubMcpCatalog, signal?: AbortSignal) =>
      catalog.getDownstreamLineage(DATASET_URN, { maxHops: 2, signal }),
  },
  {
    tool: "get_entities",
    invoke: (catalog: DataHubMcpCatalog, signal?: AbortSignal) =>
      catalog.getEntityContext([DATASET_URN], { signal }),
  },
] as const;

it.each(ownedReadCases)(
  "expires $tool without a caller signal after fifteen seconds",
  async ({ tool, invoke }) => {
    vi.useFakeTimers();
    let received: OwnedMcpToolCallOptions | undefined;
    const client: McpToolClient = {
      async callTool(_request, options) {
        received = options;
        return new Promise<never>(() => undefined);
      },
      getServerInfo: () => ({}),
      async close() {},
    };
    const catalog = new DataHubMcpCatalog(client);
    const operation = invoke(catalog);
    const rejected = expect(operation).rejects.toMatchObject({
      code: "DATAHUB_UNAVAILABLE",
      message: "DataHub is unavailable through the MCP adapter.",
      details: {},
    });

    expect(received).toMatchObject({ timeout: 15_000, maxTotalTimeout: 15_000 });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(received?.signal.aborted).toBe(true);
    expect(catalog.getTrace()).toMatchObject([{ tool, status: "error" }]);
  },
);
```

Add these named cases:

- `preserves the exact caller cancellation while aborting the owned request`;
- `does not let later caller cancellation replace an earlier dependency failure`;
- `does not promote a late MCP result to evidence or an ok trace`; and
- `forwards signal, timeout, and maxTotalTimeout unchanged to SDK callTool`.

For exact caller preservation:

```ts
const caller = new AbortController();
const classified = new AppError("DATAHUB_UNAVAILABLE", "Parent scope owns cancellation.");
let ownedSignal: AbortSignal | undefined;
const client: McpToolClient = {
  async callTool(_request, options) {
    ownedSignal = options.signal;
    return new Promise<never>(() => undefined);
  },
  getServerInfo: () => ({}),
  async close() {},
};
const operation = new DataHubMcpCatalog(client).searchDatasets("orders", {
  signal: caller.signal,
});
caller.abort(classified);

await expect(operation).rejects.toBe(classified);
expect(ownedSignal).not.toBe(caller.signal);
expect(ownedSignal?.aborted).toBe(true);
```

For late resolution, retain the resolver from `Promise.withResolvers<CallToolResult>()`, expire the operation at 15 seconds, resolve it with a valid search page afterward, flush a microtask, and assert the trace remains exactly one `error` entry and no collection result becomes observable.

For SDK forwarding, call through `toDataHubMcpToolClient` with a fake whose third `callTool` parameter is captured; invoke that client through `DataHubMcpCatalog.searchDatasets` and assert the captured `signal`, `timeout: 15_000`, and `maxTotalTimeout: 15_000`.

- [ ] **Step 3: Write failing startup and normal cleanup tests**

Add:

```ts
it("returns one normal-close settlement and invokes the client once", async () => {
  const deferred = Promise.withResolvers<void>();
  let closeCount = 0;
  const client: McpToolClient = {
    async callTool() {
      return jsonResult({});
    },
    getServerInfo: () => ({}),
    async close() {
      closeCount += 1;
      return deferred.promise;
    },
  };
  const catalog = new DataHubMcpCatalog(client);
  const first = catalog.close();
  const second = catalog.close();

  expect(first).toBe(second);
  expect(closeCount).toBe(1);
  deferred.resolve();
  await first;
  await catalog.close();
  expect(closeCount).toBe(1);
});

it("settles a hung normal close at five seconds", async () => {
  vi.useFakeTimers();
  let closeCount = 0;
  const client: McpToolClient = {
    async callTool() {
      return jsonResult({});
    },
    getServerInfo: () => ({}),
    async close() {
      closeCount += 1;
      return new Promise<never>(() => undefined);
    },
  };
  const operation = new DataHubMcpCatalog(client).close();
  const rejected = expect(operation).rejects.toMatchObject({
    code: "MCP_UNAVAILABLE",
    message: "The DataHub MCP client could not be closed.",
    details: {},
  });

  await vi.advanceTimersByTimeAsync(4_999);
  expect(closeCount).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(closeCount).toBe(1);
});
```

Add a startup case whose fake `connect()` rejects safely and whose `close()` returns a never-settling promise. Start `connectOwnedDataHubMcpClient`, advance fake timers by `5_000`, and assert fixed `MCP_UNAVAILABLE`, `closeCount === 1`, no raw error text, and no pending fake timer.

Add `does not let later caller cancellation replace an earlier startup failure`: make `connect()` reject, wait until the never-settling startup `close()` begins, abort the caller with a classified error, advance `5_000` ms, and assert the original fixed `MCP_UNAVAILABLE` still wins. Retain the existing cancelled second capability-page case and its exact caller `AbortError`; in that case the caller signal is already aborted when the startup catch classifies its primary outcome.

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/datahub/mcp/datahub-mcp-catalog.test.ts -t "owned boundary"
.\node_modules\.bin\vitest.cmd run src/datahub/mcp/datahub-mcp-catalog.test.ts -t "close"
```

Expected: FAIL because call options contain only the caller signal, hung reads and cleanup do not settle at the approved boundaries, and repeated normal close invokes the client more than once.

- [ ] **Step 5: Require and forward the certified SDK request options**

In `src/datahub/mcp/mcp-client.ts`, import `OwnedMcpToolCallOptions` and `createBoundedMcpClose`. Change only the private/client option shapes:

```ts
interface SdkToolClient {
  callTool(
    request: ToolCallRequest,
    resultSchema?: typeof CallToolResultSchema,
    options?: OwnedMcpToolCallOptions,
  ): ReturnType<Client["callTool"]>;
  // Keep listTools, getServerVersion, and close unchanged.
}
```

Update the adapter method:

```ts
async callTool(request, options) {
  const result = await client.callTool(request, CallToolResultSchema, options);
  if ("toolResult" in result) {
    throw new Error("DataHub MCP returned an unsupported task result.");
  }
  const parsed = CallToolResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error("DataHub MCP returned an unsupported task result.");
  }
  return parsed.data;
},
```

Do not alter capability discovery or the pinned subprocess parameters.

- [ ] **Step 6: Apply the owned call and normal-close boundary in the catalog**

In `src/datahub/mcp/datahub-mcp-catalog.ts`, import:

```ts
import {
  createBoundedMcpClose,
  type OwnedMcpToolCallOptions,
  runWithMcpToolDeadline,
} from "./mcp-boundary-policy.js";
```

Require certified options on `McpToolClient.callTool`:

```ts
export interface McpToolClient {
  callTool(request: ToolCallRequest, options: OwnedMcpToolCallOptions): Promise<CallToolResult>;
  getServerInfo(): DataHubServerInfo;
  close(): Promise<void>;
}
```

Add one cached close owner:

```ts
export class DataHubMcpCatalog implements DataHubCatalog {
  readonly #trace: Array<ToolTraceEntry | undefined> = [];
  readonly #closeOwnedClient: () => Promise<void>;
  #nextCallNumber = 1;

  constructor(
    private readonly client: McpToolClient,
    private readonly secrets: readonly string[] = [],
  ) {
    this.#closeOwnedClient = createBoundedMcpClose(() => client.close());
  }

  close(): Promise<void> {
    return this.#closeOwnedClient();
  }
}
```

Replace the body below trace-entry initialization in private `call<T>` with two explicit phases:

```ts
let result: CallToolResult;
try {
  result = await runWithMcpToolDeadline(signal, (ownedOptions) =>
    this.client.callTool(request, ownedOptions),
  );
} catch (error) {
  this.#trace[traceIndex] = { ...traceEntry, status: "error" };
  throw error;
}

try {
  signal?.throwIfAborted();
  const parsed = parse(decodeJsonToolResult(result));
  signal?.throwIfAborted();
  this.#trace[traceIndex] = { ...traceEntry, status: "ok" };
  return parsed;
} catch {
  this.#trace[traceIndex] = { ...traceEntry, status: "error" };
  if (signal?.aborted) signal.throwIfAborted();
  throw this.unavailable();
}
```

Do not re-check `signal.aborted` in the first catch. `runWithMcpToolDeadline` has already fixed the winner; a later caller abort must not replace an earlier dependency failure or owned expiry.

- [ ] **Step 7: Bound startup cleanup without changing primary classification**

At the start of `connectOwnedDataHubMcpClient`, create the startup owner:

```ts
const closeOwnedClient = createBoundedMcpClose(() => client.close());
```

Replace only the catch cleanup. Classify the primary outcome before awaiting cleanup so a later caller abort cannot rewrite an earlier startup failure:

```ts
} catch {
  let primary: unknown = new AppError(
    "MCP_UNAVAILABLE",
    "The DataHub MCP subprocess could not be started.",
  );
  if (signal?.aborted) {
    try {
      signal.throwIfAborted();
    } catch (error) {
      primary = error;
    }
  }

  try {
    await closeOwnedClient();
  } catch {
    // Startup cleanup is bounded and secondary to the classified startup failure.
  }
  throw primary;
}
```

Do not pass startup close ownership into the catalog. Before catalog creation the factory owns raw SDK cleanup; after creation the catalog owns normal cleanup.

- [ ] **Step 8: Run GREEN and the complete MCP adapter regression**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/datahub/mcp/mcp-boundary-policy.test.ts src/datahub/mcp/datahub-mcp-catalog.test.ts
pnpm typecheck
```

Expected: both files pass; every read carries exact SDK limits; caller cancellation remains exact; late read settlement is inert; startup and normal close settle by five seconds and call their dependency once; strict TypeScript passes.

- [ ] **Step 9: Commit the shared call and cleanup boundary**

Run:

```powershell
git add src/datahub/mcp/mcp-client.ts src/datahub/mcp/datahub-mcp-catalog.ts src/datahub/mcp/datahub-mcp-catalog.test.ts
git diff --cached --check
git commit -m "fix: enforce DataHub MCP deadlines"
```

Expected: one commit containing only MCP client/catalog integration and tests; Task 1 files remain unchanged unless a test-proven defect required a separately reviewed correction.

---

### Task 3: Reject Oversized or Non-JSON MCP Results Before Decoding

**Files:**

- Read: `src/datahub/mcp/mcp-boundary-policy.ts`
- Create: `src/datahub/mcp/mcp-tool-result-budget.ts`
- Create: `src/datahub/mcp/mcp-tool-result-budget.test.ts`
- Modify: `src/datahub/mcp/decode-tool-result.ts`
- Modify: `src/datahub/mcp/decode-tool-result.test.ts`
- Modify: `src/datahub/mcp/datahub-mcp-catalog.test.ts`

**Interfaces:**

- Consumes: the complete SDK-validated `CallToolResult`.
- Produces:

```ts
export function assertMcpToolResultWithinBudget(result: CallToolResult): void;

export function decodeJsonToolResult(result: CallToolResult): unknown;
```

- Guarantees: the complete result, including ignored blocks and both content forms, is bounded before selection, join, parse, schema validation, trace success, normalization, or persistence; the traversal is iterative, uses no `JSON.stringify`, permits repeated acyclic references, and fails closed on cycles/non-JSON structure.

- [ ] **Step 1: Write failing exact-budget and structural tests**

Create `src/datahub/mcp/mcp-tool-result-budget.test.ts`. Use `JSON.stringify` only in test-owned fixture sizing; production accounting must not call it:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { DATAHUB_MCP_BOUNDARY_POLICY } from "./mcp-boundary-policy.js";
import { assertMcpToolResultWithinBudget } from "./mcp-tool-result-budget.js";

const accountedFixtureBytes = (result: CallToolResult): number => {
  const textBlocks = result.content.filter(({ type }) => type === "text").length;
  return Buffer.byteLength(JSON.stringify(result), "utf8") + Math.max(0, textBlocks - 1);
};

function oneTextResultAtBytes(bytes: number): CallToolResult {
  const empty: CallToolResult = {
    content: [{ type: "text", text: '""' }],
  };
  const fillerLength = bytes - accountedFixtureBytes(empty);
  if (fillerLength < 0) throw new Error("Requested fixture size is too small.");
  return {
    content: [{ type: "text", text: `"${"x".repeat(fillerLength)}"` }],
  };
}

function oneTextResultWithPrefixAtBytes(prefix: string, bytes: number): CallToolResult {
  const empty: CallToolResult = {
    content: [{ type: "text", text: prefix }],
  };
  const fillerLength = bytes - accountedFixtureBytes(empty);
  if (fillerLength < 0) throw new Error("Requested fixture size is too small.");
  return {
    content: [{ type: "text", text: `${prefix}${"x".repeat(fillerLength)}` }],
  };
}

function nestedArrays(count: number): unknown {
  let value: unknown = null;
  for (let index = 0; index < count; index += 1) value = [value];
  return value;
}

describe("assertMcpToolResultWithinBudget", () => {
  it("accepts exactly 1,048,576 accounted bytes and rejects one more", () => {
    const exact = oneTextResultAtBytes(DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes);
    const oversized = oneTextResultAtBytes(DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes + 1);

    expect(accountedFixtureBytes(exact)).toBe(1_048_576);
    expect(() => assertMcpToolResultWithinBudget(exact)).not.toThrow();
    expect(() => assertMcpToolResultWithinBudget(oversized)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });

  it("accounts for inserted newlines between joined text blocks", () => {
    const empty: CallToolResult = {
      content: [
        { type: "text", text: '{"value":' },
        { type: "text", text: '""}' },
      ],
    };
    const filler = DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes - accountedFixtureBytes(empty);
    const exact: CallToolResult = {
      content: [
        { type: "text", text: '{"value":' },
        { type: "text", text: `"${"x".repeat(filler)}"}` },
      ],
    };
    const oversized: CallToolResult = {
      content: [
        { type: "text", text: '{"value":' },
        { type: "text", text: `"${"x".repeat(filler + 1)}"}` },
      ],
    };

    expect(accountedFixtureBytes(exact)).toBe(1_048_576);
    expect(() => assertMcpToolResultWithinBudget(exact)).not.toThrow();
    expect(() => assertMcpToolResultWithinBudget(oversized)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });

  it("counts JSON escaping and multibyte Unicode in UTF-8 bytes", () => {
    const prefix = '🙂"\n\\';
    const exact = oneTextResultWithPrefixAtBytes(
      prefix,
      DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes,
    );
    const oversized = oneTextResultWithPrefixAtBytes(
      prefix,
      DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes + 1,
    );

    expect(accountedFixtureBytes(exact)).toBe(1_048_576);
    expect(() => assertMcpToolResultWithinBudget(exact)).not.toThrow();
    expect(() => assertMcpToolResultWithinBudget(oversized)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });

  it("counts content and structured content even when structured content wins", () => {
    const result = oneTextResultAtBytes(DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes);
    const withStructured = {
      ...result,
      structuredContent: { safe: true },
    } satisfies CallToolResult;

    expect(() => assertMcpToolResultWithinBudget(withStructured)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });

  it("rejects oversized ignored content", () => {
    const result = {
      content: [{ type: "image", data: "x".repeat(1_048_576), mimeType: "image/png" }],
      structuredContent: { safe: true },
    } as CallToolResult;

    expect(() => assertMcpToolResultWithinBudget(result)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });

  it("accepts container depth 64 and rejects depth 65", () => {
    const atLimit = {
      content: [],
      structuredContent: { nested: nestedArrays(62) },
    } as CallToolResult;
    const overLimit = {
      content: [],
      structuredContent: { nested: nestedArrays(63) },
    } as CallToolResult;

    expect(() => assertMcpToolResultWithinBudget(atLimit)).not.toThrow();
    expect(() => assertMcpToolResultWithinBudget(overLimit)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });

  it("accepts 100,000 visited values and rejects 100,001", () => {
    const atLimit = {
      content: [],
      structuredContent: { values: Array.from({ length: 99_996 }, () => null) },
    } as CallToolResult;
    const overLimit = {
      content: [],
      structuredContent: { values: Array.from({ length: 99_997 }, () => null) },
    } as CallToolResult;

    expect(() => assertMcpToolResultWithinBudget(atLimit)).not.toThrow();
    expect(() => assertMcpToolResultWithinBudget(overLimit)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });

  it("rejects cycles but accepts repeated acyclic references", () => {
    const shared = { value: "safe" };
    const repeated = {
      content: [],
      structuredContent: { first: shared, second: shared },
    } as CallToolResult;
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => assertMcpToolResultWithinBudget(repeated)).not.toThrow();
    expect(() =>
      assertMcpToolResultWithinBudget({
        content: [],
        structuredContent: cyclic,
      } as CallToolResult),
    ).toThrow("DataHub MCP tool result exceeded the application boundary.");
  });

  it.each([
    ["undefined", undefined],
    ["bigint", 1n],
    ["symbol", Symbol("unsafe")],
    ["function", () => undefined],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["custom prototype", new Date()],
    ["sparse array", Array(1)],
    [
      "accessor",
      Object.defineProperty({}, "secret", {
        enumerable: true,
        get: () => "unsafe",
      }),
    ],
    [
      "non-enumerable property",
      Object.defineProperty({}, "hidden", {
        enumerable: false,
        value: "unsafe",
      }),
    ],
    [
      "non-enumerable accessor",
      Object.defineProperty({}, "hidden", {
        enumerable: false,
        get: () => "unsafe",
      }),
    ],
    [
      "extra array property",
      Object.defineProperty([], "hidden", {
        enumerable: true,
        value: "unsafe",
      }),
    ],
  ])("rejects non-JSON structured value %s", (_label, value) => {
    const result = {
      content: [],
      structuredContent: { value },
    } as CallToolResult;

    expect(() => assertMcpToolResultWithinBudget(result)).toThrow(
      "DataHub MCP tool result exceeded the application boundary.",
    );
  });
});
```

- [ ] **Step 2: Write failing decoder-order and public-mapping tests**

In `src/datahub/mcp/decode-tool-result.test.ts`, import `vi` and add:

```ts
it("rejects oversized text before application JSON parsing", () => {
  const parse = vi.spyOn(JSON, "parse");
  const result = oneTextResultAtBytes(DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes + 1);

  expect(() => decodeJsonToolResult(result)).toThrow(
    "DataHub MCP tool result exceeded the application boundary.",
  );
  expect(parse).not.toHaveBeenCalled();
});

it("rejects oversized ignored text before preferring structured content", () => {
  const result = {
    ...oneTextResultAtBytes(DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes),
    structuredContent: { searchResults: [] },
  } satisfies CallToolResult;

  expect(() => decodeJsonToolResult(result)).toThrow(
    "DataHub MCP tool result exceeded the application boundary.",
  );
});
```

Copy the small test-owned `accountedFixtureBytes` and `oneTextResultAtBytes` helpers into this test file; do not export production byte-accounting internals for fixture construction.

In `src/datahub/mcp/datahub-mcp-catalog.test.ts`, add one secret-bearing oversized search result. Assert fixed `DATAHUB_UNAVAILABLE`, `details: {}`, one `error` trace, and absence of the secret/raw payload in serialized error and trace.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/datahub/mcp/mcp-tool-result-budget.test.ts src/datahub/mcp/decode-tool-result.test.ts
.\node_modules\.bin\vitest.cmd run src/datahub/mcp/datahub-mcp-catalog.test.ts -t "result budget"
```

Expected: FAIL because the budget module is absent and oversized/hostile results reach selection or parsing.

- [ ] **Step 4: Implement iterative lexical accounting**

Create `src/datahub/mcp/mcp-tool-result-budget.ts`:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DATAHUB_MCP_BOUNDARY_POLICY } from "./mcp-boundary-policy.js";

interface BudgetState {
  bytes: number;
  nodes: number;
}

type ObjectFrame = {
  readonly kind: "object";
  readonly value: Record<string, unknown>;
  readonly keys: Generator<string>;
  readonly depth: number;
  readonly first: boolean;
};

type WorkItem =
  | { readonly kind: "value"; readonly value: unknown; readonly parentDepth: number }
  | {
      readonly kind: "array";
      readonly value: readonly unknown[];
      readonly index: number;
      readonly depth: number;
    }
  | {
      readonly kind: "array-keys";
      readonly value: readonly unknown[];
      readonly keys: Generator<string>;
    }
  | ObjectFrame
  | { readonly kind: "exit"; readonly value: object };

const boundaryFailure = (): Error =>
  new Error("DataHub MCP tool result exceeded the application boundary.");

function addBytes(state: BudgetState, amount: number): void {
  state.bytes += amount;
  if (state.bytes > DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes) {
    throw boundaryFailure();
  }
}

function addJsonString(state: BudgetState, value: string): void {
  addBytes(state, 2);

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code === 0x22 || code === 0x5c) {
      addBytes(state, 2);
    } else if (code <= 0x1f) {
      addBytes(
        state,
        code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6,
      );
    } else if (code <= 0x7f) {
      addBytes(state, 1);
    } else if (code <= 0x7ff) {
      addBytes(state, 2);
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        addBytes(state, 4);
        index += 1;
      } else {
        addBytes(state, 6);
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      addBytes(state, 6);
    } else {
      addBytes(state, 3);
    }
  }
}

function* ownJsonKeys(value: object): Generator<string> {
  const array = Array.isArray(value);

  for (const key of Object.getOwnPropertyNames(value)) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw boundaryFailure();
    }
    if (array && !canonicalArrayIndex(key, value.length)) throw boundaryFailure();
    yield key;
  }
}

function assertNoSymbolKeys(value: object): void {
  if (Object.getOwnPropertySymbols(value).length > 0) throw boundaryFailure();
}

function assertPlainRecord(value: object): asserts value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw boundaryFailure();
}

function canonicalArrayIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

export function assertMcpToolResultWithinBudget(result: CallToolResult): void {
  const state: BudgetState = { bytes: 0, nodes: 0 };
  let textBlocks = 0;

  if (result.content.length > DATAHUB_MCP_BOUNDARY_POLICY.maxJsonNodes) {
    throw boundaryFailure();
  }
  for (const block of result.content) {
    if (block.type !== "text") continue;
    if (textBlocks > 0) addBytes(state, 1);
    textBlocks += 1;
  }

  const active = new Set<object>();
  const stack: WorkItem[] = [{ kind: "value", value: result, parentDepth: 0 }];

  while (stack.length > 0) {
    const item = stack.pop()!;

    if (item.kind === "exit") {
      active.delete(item.value);
      continue;
    }

    if (item.kind === "array") {
      if (item.index >= item.value.length) continue;
      if (item.index > 0) addBytes(state, 1);
      const descriptor = Object.getOwnPropertyDescriptor(item.value, String(item.index));
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        throw boundaryFailure();
      }
      stack.push({ ...item, index: item.index + 1 });
      stack.push({ kind: "value", value: descriptor.value, parentDepth: item.depth });
      continue;
    }

    if (item.kind === "array-keys") {
      const next = item.keys.next();
      if (next.done) continue;
      if (!canonicalArrayIndex(next.value, item.value.length)) throw boundaryFailure();
      stack.push(item);
      continue;
    }

    if (item.kind === "object") {
      const next = item.keys.next();
      if (next.done) continue;
      const descriptor = Object.getOwnPropertyDescriptor(item.value, next.value);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        throw boundaryFailure();
      }
      if (!item.first) addBytes(state, 1);
      addJsonString(state, next.value);
      addBytes(state, 1);
      stack.push({ ...item, first: false });
      stack.push({ kind: "value", value: descriptor.value, parentDepth: item.depth });
      continue;
    }

    state.nodes += 1;
    if (state.nodes > DATAHUB_MCP_BOUNDARY_POLICY.maxJsonNodes) throw boundaryFailure();

    const value = item.value;
    if (value === null) {
      addBytes(state, 4);
      continue;
    }
    if (typeof value === "string") {
      addJsonString(state, value);
      continue;
    }
    if (typeof value === "boolean") {
      addBytes(state, value ? 4 : 5);
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw boundaryFailure();
      addBytes(state, String(Object.is(value, -0) ? 0 : value).length);
      continue;
    }
    if (typeof value !== "object") throw boundaryFailure();

    const depth = item.parentDepth + 1;
    if (depth > DATAHUB_MCP_BOUNDARY_POLICY.maxJsonDepth) throw boundaryFailure();
    if (active.has(value)) throw boundaryFailure();
    assertNoSymbolKeys(value);
    active.add(value);
    addBytes(state, 2);
    stack.push({ kind: "exit", value });

    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw boundaryFailure();
      stack.push({
        kind: "array-keys",
        value,
        keys: ownJsonKeys(value),
      });
      stack.push({ kind: "array", value, index: 0, depth });
      continue;
    }

    assertPlainRecord(value);
    stack.push({
      kind: "object",
      value,
      keys: ownJsonKeys(value),
      depth,
      first: true,
    });
  }
}
```

The frame order is deliberate: child values complete and remove themselves from `active` before the next property is visited, so repeated acyclic references pass while an active ancestor cycle fails. Do not replace the traversal with recursion, `JSON.stringify`, a deep clone, or a permissive serializer.

- [ ] **Step 5: Enforce the budget before every decode branch**

At the top of `decodeJsonToolResult`:

```ts
import { assertMcpToolResultWithinBudget } from "./mcp-tool-result-budget.js";

export function decodeJsonToolResult(result: CallToolResult): unknown {
  assertMcpToolResultWithinBudget(result);

  if (result.isError) {
    throw new Error("DataHub MCP tool returned an error result.");
  }
  if (result.structuredContent) return result.structuredContent;

  const text = result.content
    .filter((item): item is TextContent => item.type === "text")
    .map((item) => item.text)
    .join("\n");

  if (!text) {
    throw new Error("DataHub MCP tool returned no JSON content.");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("DataHub MCP tool returned invalid JSON content.");
  }
}
```

Budget enforcement must remain the first executable statement, including for `isError`.

- [ ] **Step 6: Run GREEN, catalog mapping, and strict checks**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/datahub/mcp/mcp-tool-result-budget.test.ts src/datahub/mcp/decode-tool-result.test.ts
.\node_modules\.bin\vitest.cmd run src/datahub/mcp/datahub-mcp-catalog.test.ts -t "result budget"
pnpm typecheck
```

Expected: exact bytes/depth/nodes pass; every plus-one, cycle, non-JSON value, and ignored oversized block fails with the fixed boundary error; oversized text never reaches `JSON.parse`; catalog exposure is fixed `DATAHUB_UNAVAILABLE`; strict TypeScript passes.

- [ ] **Step 7: Commit the complete-result trust boundary**

Run:

```powershell
git add src/datahub/mcp/mcp-tool-result-budget.ts src/datahub/mcp/mcp-tool-result-budget.test.ts src/datahub/mcp/decode-tool-result.ts src/datahub/mcp/decode-tool-result.test.ts src/datahub/mcp/datahub-mcp-catalog.test.ts
git diff --cached --check
git commit -m "fix: bound MCP results before decoding"
```

Expected: one commit containing only result accounting, decoder integration, and their focused catalog mapping regression.

---

### Task 4: Put Finite Limits on Every Declared MCP Schema Value

**Files:**

- Modify: `src/datahub/mcp/schemas.ts`
- Create: `src/datahub/mcp/schemas.test.ts`
- Modify: `src/datahub/mcp/datahub-mcp-catalog.test.ts`

**Interfaces:**

- Consumes: globally budgeted decoded JSON.
- Produces: the existing four Zod response schemas with finite exact maxima; no public schema name changes.
- Guarantees: top-level arrays match outbound page/batch sizes; identity values reject rather than truncate; nested metadata remains sufficiently large for deterministic normalization to the existing 20-item domain cap; unknown object fields remain passthrough but globally budgeted.

- [ ] **Step 1: Write failing exact-limit schema tests**

Create `src/datahub/mcp/schemas.test.ts` and import all four response schemas. Build valid base payloads once, then use table-driven cases with these exact pass/reject pairs:

```ts
const topLevelCases = [
  {
    label: "search results",
    schema: searchResponseSchema,
    build: (length: number) => ({
      start: 0,
      count: length,
      total: length,
      searchResults: Array.from({ length }, (_, index) => ({
        entity: { urn: `urn:li:dataset:(search-${index})` },
      })),
    }),
    maximum: 50,
  },
  {
    label: "schema fields",
    schema: schemaResponseSchema,
    build: (length: number) => ({
      urn: "urn:li:dataset:(schema)",
      offset: 0,
      fields: Array.from({ length }, (_, index) => ({ fieldPath: `field_${index}` })),
      totalFields: length,
      returned: length,
      remainingCount: 0,
    }),
    maximum: 100,
  },
  {
    label: "lineage results",
    schema: lineageResponseSchema,
    build: (length: number) => ({
      downstreams: {
        searchResults: Array.from({ length }, (_, index) => ({
          entity: { urn: `urn:li:dataset:(lineage-${index})` },
          degree: 1,
          lineageColumns: [],
        })),
        offset: 0,
        returned: length,
        hasMore: false,
      },
    }),
    maximum: 100,
  },
  {
    label: "entity results",
    schema: getEntitiesResponseSchema,
    build: (length: number) =>
      Array.from({ length }, (_, index) => ({
        urn: `urn:li:dataset:(entity-${index})`,
        type: "DATASET",
      })),
    maximum: 10,
  },
] as const;

it.each(topLevelCases)("accepts $label at its request maximum", ({ schema, build, maximum }) => {
  expect(schema.safeParse(build(maximum)).success).toBe(true);
});

it.each(topLevelCases)("rejects $label above its request maximum", ({ schema, build, maximum }) => {
  expect(schema.safeParse(build(maximum + 1)).success).toBe(false);
});
```

Add direct string cases:

```ts
it.each([
  [
    "name",
    500,
    (value: string) => ({
      start: 0,
      count: 1,
      total: 1,
      searchResults: [{ entity: { urn: "urn:li:dataset:test", name: value } }],
    }),
    searchResponseSchema,
  ],
  [
    "platform",
    100,
    (value: string) => ({
      start: 0,
      count: 1,
      total: 1,
      searchResults: [
        {
          entity: { urn: "urn:li:dataset:test", platform: { name: value } },
        },
      ],
    }),
    searchResponseSchema,
  ],
  [
    "entity type",
    100,
    (value: string) => [
      {
        urn: "urn:li:dataset:test",
        type: value,
      },
    ],
    getEntitiesResponseSchema,
  ],
  [
    "native data type",
    500,
    (value: string) => ({
      urn: "urn:li:dataset:test",
      offset: 0,
      fields: [{ fieldPath: "customer_id", nativeDataType: value }],
      totalFields: 1,
      returned: 1,
      remainingCount: 0,
    }),
    schemaResponseSchema,
  ],
  [
    "field path",
    500,
    (value: string) => ({
      urn: "urn:li:dataset:test",
      offset: 0,
      fields: [{ fieldPath: value }],
      totalFields: 1,
      returned: 1,
      remainingCount: 0,
    }),
    schemaResponseSchema,
  ],
  [
    "lineage column",
    500,
    (value: string) => ({
      downstreams: {
        searchResults: [
          {
            entity: { urn: "urn:li:dataset:test" },
            degree: 1,
            lineageColumns: [value],
          },
        ],
        offset: 0,
        returned: 1,
        hasMore: false,
      },
    }),
    lineageResponseSchema,
  ],
  [
    "description",
    2_000,
    (value: string) => [
      {
        urn: "urn:li:dataset:test",
        type: "DATASET",
        properties: { description: value },
      },
    ],
    getEntitiesResponseSchema,
  ],
  [
    "entity error",
    2_000,
    (value: string) => [
      {
        urn: "urn:li:dataset:test",
        error: value,
      },
    ],
    getEntitiesResponseSchema,
  ],
] as const)("bounds %s at %i characters", (_label, maximum, build, schema) => {
  expect(schema.safeParse(build("x".repeat(maximum))).success).toBe(true);
  expect(schema.safeParse(build("x".repeat(maximum + 1))).success).toBe(false);
});
```

Add the URN case separately so the complete value, including its prefix, is measured:

```ts
it("bounds a complete URN at 500 characters", () => {
  const build = (length: number) => ({
    start: 0,
    count: 1,
    total: 1,
    searchResults: [
      {
        entity: {
          urn: `urn:li:${"x".repeat(length - "urn:li:".length)}`,
        },
      },
    ],
  });

  expect(searchResponseSchema.safeParse(build(500)).success).toBe(true);
  expect(searchResponseSchema.safeParse(build(501)).success).toBe(false);
});
```

Add nested-array tests for:

- `lineageColumns`: 100 passes, 101 fails;
- `ownership.owners`: 100 passes, 101 fails;
- `tags.tags`: 100 passes, 101 fails;
- `glossaryTerms.terms`: 100 passes, 101 fails;
- `siblings.siblings`: 100 passes, 101 fails;
- `dataQuality.assertions`: 100 passes, 101 fails; and
- `quality.signals`: 100 passes, 101 fails.

Use schema-valid entries in this exact table:

```ts
const nestedArrayCases = [
  {
    label: "lineage columns",
    schema: lineageResponseSchema,
    build: (length: number) => ({
      downstreams: {
        searchResults: [
          {
            entity: { urn: "urn:li:dataset:test" },
            degree: 1,
            lineageColumns: Array.from({ length }, (_, index) => `field_${index}`),
          },
        ],
      },
    }),
  },
  {
    label: "owners",
    schema: getEntitiesResponseSchema,
    build: (length: number) => [
      {
        urn: "urn:li:dataset:test",
        type: "DATASET",
        ownership: {
          owners: Array.from({ length }, (_, index) => ({
            owner: { urn: `urn:li:corpuser:owner-${index}` },
          })),
        },
      },
    ],
  },
  {
    label: "tags",
    schema: getEntitiesResponseSchema,
    build: (length: number) => [
      {
        urn: "urn:li:dataset:test",
        type: "DATASET",
        tags: {
          tags: Array.from({ length }, (_, index) => ({
            tag: { urn: `urn:li:tag:tag-${index}` },
          })),
        },
      },
    ],
  },
  {
    label: "glossary terms",
    schema: getEntitiesResponseSchema,
    build: (length: number) => [
      {
        urn: "urn:li:dataset:test",
        type: "DATASET",
        glossaryTerms: {
          terms: Array.from({ length }, (_, index) => ({
            term: { urn: `urn:li:glossaryTerm:term-${index}` },
          })),
        },
      },
    ],
  },
  {
    label: "siblings",
    schema: getEntitiesResponseSchema,
    build: (length: number) => [
      {
        urn: "urn:li:dataset:test",
        type: "DATASET",
        siblings: {
          siblings: Array.from({ length }, (_, index) => ({
            urn: `urn:li:dataset:(sibling-${index})`,
          })),
        },
      },
    ],
  },
  {
    label: "assertions",
    schema: getEntitiesResponseSchema,
    build: (length: number) => [
      {
        urn: "urn:li:dataset:test",
        type: "DATASET",
        dataQuality: {
          assertions: Array.from({ length }, () => ({ status: "PASS" as const })),
        },
      },
    ],
  },
  {
    label: "quality signals",
    schema: getEntitiesResponseSchema,
    build: (length: number) => [
      {
        urn: "urn:li:dataset:test",
        type: "DATASET",
        quality: {
          signals: Array.from({ length }, () => ({ status: "PASS" as const })),
        },
      },
    ],
  },
] as const;

it.each(nestedArrayCases)("bounds $label at 100 entries", ({ schema, build }) => {
  expect(schema.safeParse(build(100)).success).toBe(true);
  expect(schema.safeParse(build(101)).success).toBe(false);
});
```

Add one passthrough case with unknown object fields at search-result, entity, platform, schema-field, lineage, and response levels; it must still parse.

- [ ] **Step 2: Add failing catalog-public-error regressions**

In `src/datahub/mcp/datahub-mcp-catalog.test.ts`, add one table for max-plus-one top-level arrays. Each row supplies exactly one raw response and invokes the corresponding catalog method:

```ts
it.each([
  {
    label: "search",
    result: jsonResult({
      start: 0,
      count: 51,
      total: 51,
      searchResults: Array.from({ length: 51 }, (_, index) => ({
        entity: { urn: `urn:li:dataset:(search-${index})` },
      })),
    }),
    invoke: (catalog: DataHubMcpCatalog) => catalog.searchDatasets("orders"),
  },
  {
    label: "schema",
    result: jsonResult({
      urn: DATASET_URN,
      offset: 0,
      fields: Array.from({ length: 101 }, (_, index) => ({
        fieldPath: `field_${index}`,
      })),
      totalFields: 101,
      returned: 101,
      remainingCount: 0,
    }),
    invoke: (catalog: DataHubMcpCatalog) => catalog.listSchemaFields(DATASET_URN),
  },
  {
    label: "lineage",
    result: jsonResult({
      downstreams: {
        searchResults: Array.from({ length: 101 }, (_, index) => ({
          entity: { urn: `urn:li:dataset:(lineage-${index})` },
          degree: 1,
          lineageColumns: [],
        })),
        offset: 0,
        returned: 101,
        hasMore: false,
      },
    }),
    invoke: (catalog: DataHubMcpCatalog) =>
      catalog.getDownstreamLineage(DATASET_URN, { maxHops: 2 }),
  },
  {
    label: "entities",
    result: jsonResult(
      Array.from({ length: 11 }, (_, index) => ({
        urn: index === 0 ? DATASET_URN : `urn:li:dataset:(entity-${index})`,
        type: "DATASET",
      })),
    ),
    invoke: (catalog: DataHubMcpCatalog) => catalog.getEntityContext([DATASET_URN]),
  },
] as const)("maps oversized $label arrays to a safe public failure", async ({ result, invoke }) => {
  const catalog = new DataHubMcpCatalog(new RecordingMcpClient([result]));
  const error = await invoke(catalog).catch((caught: unknown) => caught);

  expect(error).toMatchObject({ code: "DATAHUB_UNAVAILABLE", details: {} });
  expect(catalog.getTrace()).toMatchObject([{ status: "error" }]);
  expect(JSON.stringify(error)).not.toContain("field_100");
});
```

Split the table if TypeScript cannot infer a common promise type; preserve the exact four cases and assertions rather than weakening types with `any`.

Change the existing 101-field row named `page field count stays within the requested limit`: move it out of the pagination-inconsistency table and assert rejection with `DATAHUB_UNAVAILABLE` and an `error` trace. Schema validation now owns this boundary before pagination normalization.

Add a 501-character secret-bearing name case and assert neither the secret nor the raw name appears in the error/trace.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/datahub/mcp/schemas.test.ts
.\node_modules\.bin\vitest.cmd run src/datahub/mcp/datahub-mcp-catalog.test.ts -t "oversized"
```

Expected: FAIL because current Zod strings and search/schema/lineage/nested arrays are unbounded, and the current 101-field behavior returns incomplete pagination instead of rejecting at validation.

- [ ] **Step 4: Replace unbounded declarations with the closed schema vocabulary**

Replace `src/datahub/mcp/schemas.ts` with:

```ts
import { z } from "zod";

const urnSchema = z.string().max(500).startsWith("urn:li:");
const nameSchema = z.string().max(500);
const fieldPathSchema = z.string().max(500);
const platformSchema = z.string().max(100);
const entityTypeSchema = z.string().max(100);
const nativeDataTypeSchema = z.string().max(500);
const descriptionSchema = z.string().max(2_000);
const dependencyErrorSchema = z.string().max(2_000);

export const searchResponseSchema = z
  .object({
    start: z.number().int().nonnegative(),
    count: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    searchResults: z
      .array(
        z
          .object({
            entity: z
              .object({
                urn: urnSchema,
                name: nameSchema.optional(),
                properties: z.object({ name: nameSchema.optional() }).passthrough().optional(),
                type: entityTypeSchema.optional(),
                platform: z.object({ name: platformSchema.optional() }).passthrough().optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .max(50)
      .default([]),
  })
  .passthrough();

export const schemaResponseSchema = z
  .object({
    urn: urnSchema,
    offset: z.number().int().nonnegative(),
    fields: z
      .array(
        z
          .object({
            fieldPath: fieldPathSchema,
            nativeDataType: nativeDataTypeSchema.optional(),
            nullable: z.boolean().optional(),
            description: descriptionSchema.optional(),
          })
          .passthrough(),
      )
      .max(100),
    totalFields: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    remainingCount: z.number().int().nonnegative(),
  })
  .passthrough();

const lineageResultSchema = z
  .object({
    entity: z
      .object({
        urn: urnSchema,
        name: nameSchema.optional(),
        platform: z.object({ name: platformSchema.optional() }).passthrough().optional(),
      })
      .passthrough(),
    degree: z.number().int().nonnegative(),
    lineageColumns: z.array(fieldPathSchema).max(100).default([]),
  })
  .passthrough();

const lineageDirectionSchema = z
  .object({
    searchResults: z.array(lineageResultSchema).max(100).default([]),
    offset: z.number().int().nonnegative().optional(),
    returned: z.number().int().nonnegative().optional(),
    hasMore: z.boolean().optional(),
    truncatedDueToTokenBudget: z.boolean().optional(),
  })
  .passthrough();

export const lineageResponseSchema = z
  .object({ downstreams: lineageDirectionSchema.optional() })
  .passthrough();

const ownerSchema = z.object({ owner: z.object({ urn: urnSchema }).passthrough() }).passthrough();
const tagSchema = z.object({ tag: z.object({ urn: urnSchema }).passthrough() }).passthrough();
const termSchema = z.object({ term: z.object({ urn: urnSchema }).passthrough() }).passthrough();
const siblingSchema = z.union([
  z.object({ urn: urnSchema }).passthrough(),
  z.object({ sibling: z.object({ urn: urnSchema }).passthrough() }).passthrough(),
]);
const qualityStatusSchema = z.enum([
  "PASS",
  "PASSED",
  "FAIL",
  "FAILED",
  "WARN",
  "WARNING",
  "UNKNOWN",
]);
const qualitySignalSchema = z.object({ status: qualityStatusSchema }).passthrough();

export const getEntityErrorSchema = z
  .object({ urn: urnSchema, error: dependencyErrorSchema })
  .passthrough();

export const getEntitySuccessSchema = z
  .object({
    urn: urnSchema,
    error: z.never().optional(),
    type: entityTypeSchema.default("UNKNOWN"),
    name: nameSchema.optional(),
    platform: z.object({ name: platformSchema.optional() }).passthrough().optional(),
    properties: z
      .object({ name: nameSchema.optional(), description: descriptionSchema.optional() })
      .passthrough()
      .optional(),
    ownership: z
      .object({ owners: z.array(ownerSchema).max(100).default([]) })
      .passthrough()
      .optional(),
    tags: z
      .object({ tags: z.array(tagSchema).max(100).default([]) })
      .passthrough()
      .optional(),
    glossaryTerms: z
      .object({ terms: z.array(termSchema).max(100).default([]) })
      .passthrough()
      .optional(),
    siblings: z
      .object({ siblings: z.array(siblingSchema).max(100).default([]) })
      .passthrough()
      .optional(),
    dataQuality: z
      .object({ assertions: z.array(qualitySignalSchema).max(100).default([]) })
      .passthrough()
      .optional(),
    quality: z
      .object({ signals: z.array(qualitySignalSchema).max(100).default([]) })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const getEntitiesResponseSchema = z
  .array(z.union([getEntityErrorSchema, getEntitySuccessSchema]))
  .max(10);
```

After replacement, enumerate every declared string and array consumer:

```powershell
rg -n 'z\.(string|array)' src/datahub/mcp/schemas.ts
```

Expected: the only `z.string()` declarations are immediately assigned to finite reusable schemas, and every `z.array(...)` chain reaches `.max(...)` before `.default(...)`, `.optional()`, or export. Review the complete output and reject the task if any occurrence lacks a finite bound.

- [ ] **Step 5: Run GREEN and normalization regressions**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/datahub/mcp/schemas.test.ts src/datahub/mcp/datahub-mcp-catalog.test.ts
pnpm typecheck
```

Expected: exact caps pass; plus-one values map to fixed safe failures; the existing 30-owner/tag input still parses and deterministically emits 20 normalized values; unknown fields remain passthrough only inside the globally budgeted raw response; strict TypeScript passes.

- [ ] **Step 6: Commit the finite schema boundary**

Run:

```powershell
git add src/datahub/mcp/schemas.ts src/datahub/mcp/schemas.test.ts src/datahub/mcp/datahub-mcp-catalog.test.ts
git diff --cached --check
git commit -m "fix: cap DataHub MCP response schemas"
```

Expected: one commit containing only finite schema declarations and their direct/catalog regressions.

---

### Task 5: Require Canonical Candidate-URN Proof for Incomplete Search

**Files:**

- Modify: `src/domain/resolve-dataset.ts`
- Modify: `src/domain/resolve-dataset.test.ts`
- Modify: `src/app/run-impact-analysis.ts`
- Modify: `src/app/run-impact-analysis.test.ts`

**Interfaces:**

- Consumes: the user-authored dataset hint, bounded collected candidates, and search completeness.
- Produces:

```ts
export function findUniqueCanonicalDatasetUrnMatch(
  datasetHint: string,
  candidates: readonly DatasetCandidate[],
): DatasetCandidate | undefined;
```

- Preserves:

```ts
export function isCanonicalDatasetUrn(urn: string): boolean;

export function resolveDataset(
  intent: ChangeIntent,
  candidates: readonly DatasetCandidate[],
): DatasetCandidate;
```

- Guarantees: complete search stays on the generic resolver; incomplete search uses only one explicit canonical hint matched against exactly one collected `candidate.urn`; aliases never prove incomplete-search uniqueness.

- [ ] **Step 1: Write failing pure canonical-match tests**

In `src/domain/resolve-dataset.test.ts`, import `findUniqueCanonicalDatasetUrnMatch` and add:

```ts
describe("findUniqueCanonicalDatasetUrnMatch", () => {
  const canonical = "urn:li:dataset:(urn:li:dataPlatform:snowflake,Orders,PROD)";
  const matching = {
    urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,orders,PROD)",
    name: "orders",
    platform: "snowflake",
  };

  it("finds exactly one candidate by explicit canonical dataset URN", () => {
    expect(findUniqueCanonicalDatasetUrnMatch(canonical, [matching])).toBe(matching);
  });

  it.each(["orders", "snowflake:orders"])("rejects noncanonical alias hint %s", (hint) => {
    expect(findUniqueCanonicalDatasetUrnMatch(hint, [matching])).toBeUndefined();
  });

  it("rejects a canonical hint matched only through candidate name", () => {
    expect(
      findUniqueCanonicalDatasetUrnMatch(canonical, [
        {
          urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,other,PROD)",
          name: canonical,
        },
      ]),
    ).toBeUndefined();
  });

  it("rejects an absent canonical candidate URN", () => {
    expect(findUniqueCanonicalDatasetUrnMatch(canonical, [])).toBeUndefined();
  });

  it("rejects duplicate normalized canonical candidate URNs", () => {
    expect(
      findUniqueCanonicalDatasetUrnMatch(canonical, [matching, { ...matching, urn: canonical }]),
    ).toBeUndefined();
  });
});
```

Add a missing complete-search characterization under `describe("resolveDataset", ...)`:

```ts
it("resolves an exact plain dataset name from a complete candidate set", () => {
  const candidate = {
    urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,orders,PROD)",
    name: "orders",
  };

  expect(resolveDataset(intent("orders"), [candidate])).toMatchObject({
    urn: candidate.urn,
    name: "orders",
  });
});
```

- [ ] **Step 2: Run the pure helper test and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/domain/resolve-dataset.test.ts -t "findUniqueCanonicalDatasetUrnMatch"
```

Expected: FAIL because the named export does not exist.

- [ ] **Step 3: Implement the narrow canonical candidate matcher**

In `src/domain/resolve-dataset.ts`, immediately after `isCanonicalDatasetUrn` add:

```ts
export function findUniqueCanonicalDatasetUrnMatch(
  datasetHint: string,
  candidates: readonly DatasetCandidate[],
): DatasetCandidate | undefined {
  if (!isCanonicalDatasetUrn(datasetHint)) return undefined;

  const normalizedHint = normalize(datasetHint);
  const matches = candidates.filter(({ urn }) => normalize(urn) === normalizedHint);
  return matches.length === 1 ? matches[0] : undefined;
}
```

Do not deduplicate the matches. Two collected candidate records that normalize to the hint fail the approved uniqueness proof.

- [ ] **Step 4: Run the domain test and verify GREEN**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/domain/resolve-dataset.test.ts
```

Expected: helper boundaries pass, and the complete-search resolver retains all existing URN/name/platform-name/not-found/ambiguity behavior.

- [ ] **Step 5: Replace the unsafe combined application test with explicit RED cases**

In `src/app/run-impact-analysis.test.ts`, extend `runWith` without breaking existing callers:

```ts
async function runWith(
  catalog: FakeCatalog,
  runsRoot: string,
  signal: AbortSignal = new AbortController().signal,
  secrets: readonly string[] = [],
  request: string = REQUEST,
) {
  return runImpactAnalysis({
    request,
    catalog,
    clock: () => new Date("2026-07-22T12:00:00.000Z"),
    runId: RUN_ID,
    runsRoot,
    signal,
    secrets,
  });
}
```

Replace `allows one exact candidate from incomplete search but never infers absence` with six cases:

```ts
const incompleteSearchFailure = {
  code: "DATAHUB_UNAVAILABLE",
  message: "Dataset search was incomplete.",
};

async function expectIncompleteSearchFailure(
  catalog: FakeCatalog,
  runsRoot: string,
  request: string,
): Promise<void> {
  await expect(
    runWith(catalog, runsRoot, new AbortController().signal, [], request),
  ).rejects.toMatchObject(incompleteSearchFailure);
  expect(catalog.operations).toEqual(["searchDatasets", "close"]);
  expect(catalog.closeCount).toBe(1);
  await expect(access(join(runsRoot, RUN_ID, "impact-report.md"))).rejects.toThrow();
}

it("rejects incomplete search with a first-page platform alias before downstream work", async () => {
  const catalog = new FakeCatalog({ searchReasons: ["PAGE_LIMIT_REACHED"] });
  await expectIncompleteSearchFailure(catalog, await createRunsRoot(), REQUEST);
});

it("rejects incomplete search with a first-page plain-name alias before downstream work", async () => {
  const catalog = new FakeCatalog({ searchReasons: ["HAS_MORE"] });
  await expectIncompleteSearchFailure(
    catalog,
    await createRunsRoot(),
    "Rename column customer_id to customer_key in dataset orders",
  );
});

it("rejects incomplete search when the canonical candidate URN is absent", async () => {
  const catalog = new FakeCatalog({
    candidates: [],
    searchReasons: ["PAGE_LIMIT_REACHED"],
  });
  await expectIncompleteSearchFailure(
    catalog,
    await createRunsRoot(),
    `Rename column customer_id to customer_key in dataset ${TARGET.urn}`,
  );
});

it("rejects incomplete search when the canonical candidate URN is duplicated", async () => {
  const catalog = new FakeCatalog({
    candidates: [TARGET, { ...TARGET }],
    searchReasons: ["REPEATED_PAGE"],
  });
  await expectIncompleteSearchFailure(
    catalog,
    await createRunsRoot(),
    `Rename column customer_id to customer_key in dataset ${TARGET.urn}`,
  );
});

it("rejects incomplete search when the canonical hint matches only candidate name", async () => {
  const catalog = new FakeCatalog({
    candidates: [
      {
        urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,other,PROD)",
        name: TARGET.urn,
      },
    ],
    searchReasons: ["HAS_MORE"],
  });
  await expectIncompleteSearchFailure(
    catalog,
    await createRunsRoot(),
    `Rename column customer_id to customer_key in dataset ${TARGET.urn}`,
  );
});

it("continues incomplete search for one explicit canonical candidate URN", async () => {
  const catalog = new FakeCatalog({
    candidates: [TARGET],
    searchReasons: ["PAGE_LIMIT_REACHED"],
  });
  const runsRoot = await createRunsRoot();
  const run = await runWith(
    catalog,
    runsRoot,
    new AbortController().signal,
    [],
    `Rename column customer_id to customer_key in dataset ${TARGET.urn}`,
  );

  expect(run).toMatchObject({
    status: "INCOMPLETE_EVIDENCE",
    evidence: {
      targetDataset: {
        urn: TARGET.urn,
        platform: "snowflake",
        environment: "PROD",
      },
      completeness: {
        complete: false,
        search: { complete: false },
      },
    },
  });
  expect(catalog.operations).toEqual([
    "searchDatasets",
    "listSchemaFields",
    "getDownstreamLineage:table",
    "getDownstreamLineage:customer_id",
    "getEntityContext",
    "close",
  ]);
  await expect(access(run.artifactPath)).resolves.toBeUndefined();
});
```

The first alias case is the regression for a first page that appears unique while an uncollected later page may contain another alias.

- [ ] **Step 6: Run the application cases and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/app/run-impact-analysis.test.ts -t "incomplete search"
```

Expected: the alias/name-only cases incorrectly continue to `INCOMPLETE_EVIDENCE`, proving the blocker; canonical missing/duplicate/name-only cases do not yet follow the explicit gate.

- [ ] **Step 7: Wire completeness before the generic resolver**

Change the import:

```ts
import { findUniqueCanonicalDatasetUrnMatch, resolveDataset } from "../domain/resolve-dataset.js";
```

Replace only the target-selection block in `runImpactAnalysis`:

```ts
let target;
if (search.completeness.complete) {
  target = resolveDataset(intent, search.items);
} else {
  const canonicalMatch = findUniqueCanonicalDatasetUrnMatch(intent.datasetHint, search.items);
  if (canonicalMatch === undefined) {
    throw new AppError("DATAHUB_UNAVAILABLE", "Dataset search was incomplete.");
  }

  target = resolveDataset(intent, [canonicalMatch]);
}
```

The single verified candidate passed to `resolveDataset` preserves canonical platform/environment enrichment without allowing an alias to establish uniqueness.

- [ ] **Step 8: Run GREEN and complete-search regressions**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/domain/resolve-dataset.test.ts src/app/run-impact-analysis.test.ts
pnpm typecheck
```

Expected: all incomplete aliases stop after search and cleanup with no report; one explicit canonical URN continues as `INCOMPLETE_EVIDENCE`; complete search retains generic deterministic resolution; strict TypeScript passes.

- [ ] **Step 9: Commit the identity-proof correction**

Run:

```powershell
git add src/domain/resolve-dataset.ts src/domain/resolve-dataset.test.ts src/app/run-impact-analysis.ts src/app/run-impact-analysis.test.ts
git diff --cached --check
git commit -m "fix: require canonical URN for incomplete search"
```

Expected: one commit containing only the pure matcher, orchestration gate, and focused regression tests.

---

### Task 6: Close the Catalog Before Publishing the Final Report

**Files:**

- Read: `src/datahub/mcp/mcp-boundary-policy.ts`
- Modify: `src/app/run-impact-analysis.ts`
- Modify: `src/app/run-impact-analysis.test.ts`
- Regression only: `src/cli.test.ts`
- Regression only: `src/artifacts/write-run-artifacts.test.ts`

**Interfaces:**

- Consumes: the now-bounded/idempotent `DataHubCatalog.close()`, in-memory `ImpactReportDraft`, rendered Markdown, and existing create-only `writeRunArtifact`.
- Produces: the unchanged public `Promise<AnalysisRun>` contract with one internal `readyToPublish` state.
- Guarantees: required close succeeds before final visibility; close rejection/expiry yields `MCP_UNAVAILABLE` and no report; caller cancellation is rechecked between cleanup and publication; writer failure remains `ImpactReportPersistenceError`; primary analysis failure remains authoritative.

- [ ] **Step 1: Add close-observation support to the application fake**

In `src/app/run-impact-analysis.test.ts`, import `vi` from Vitest. Extend `FakeCatalogOptions`:

```ts
readonly onClose?: () => void | Promise<void>;
```

Change only `FakeCatalog.close()`:

```ts
async close(): Promise<void> {
  this.operations.push("close");
  this.closeCount += 1;
  await this.#options.onClose?.();
  if (this.#options.closeError) throw this.#options.closeError;
}
```

Extend the existing `afterEach`:

```ts
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});
```

- [ ] **Step 2: Write failing terminal-ordering tests**

Add a successful ordering test:

```ts
it("closes successfully before the final report becomes visible", async () => {
  const runsRoot = await createRunsRoot();
  const finalPath = join(runsRoot, RUN_ID, "impact-report.md");
  let reportExistedWhenCloseStarted = true;
  const catalog = new FakeCatalog({
    onClose: async () => {
      reportExistedWhenCloseStarted = await access(finalPath).then(
        () => true,
        () => false,
      );
    },
  });

  const run = await runWith(catalog, runsRoot);

  expect(reportExistedWhenCloseStarted).toBe(false);
  expect(catalog.closeCount).toBe(1);
  await expect(readFile(run.artifactPath, "utf8")).resolves.toContain(
    "# LineageGuard AI Impact Report",
  );
});
```

Strengthen `surfaces a close failure when analysis otherwise succeeds`:

```ts
it("rejects close failure without publishing a final report", async () => {
  const runsRoot = await createRunsRoot();
  const finalPath = join(runsRoot, RUN_ID, "impact-report.md");
  const closeFailure = new AppError(
    "MCP_UNAVAILABLE",
    "The DataHub MCP client could not be closed.",
  );
  const catalog = new FakeCatalog({ closeError: closeFailure });

  await expect(runWith(catalog, runsRoot)).rejects.toBe(closeFailure);
  await expect(access(finalPath)).rejects.toThrow();
  expect(catalog.closeCount).toBe(1);
});
```

Add the same terminal proof for an owned close expiry simulated at the already-classified catalog boundary:

```ts
it("rejects an owned close deadline without publishing a final report", async () => {
  vi.useFakeTimers();
  const runsRoot = await createRunsRoot();
  const finalPath = join(runsRoot, RUN_ID, "impact-report.md");
  const closeStarted = Promise.withResolvers<void>();
  const timeoutFailure = new AppError(
    "MCP_UNAVAILABLE",
    "The DataHub MCP client could not be closed.",
  );
  const catalog = new FakeCatalog({
    onClose: async () => {
      closeStarted.resolve();
      return new Promise<never>((_, reject) => {
        setTimeout(() => reject(timeoutFailure), 5_000);
      });
    },
  });
  const operation = runWith(catalog, runsRoot);
  const rejected = expect(operation).rejects.toBe(timeoutFailure);

  await closeStarted.promise;
  await vi.advanceTimersByTimeAsync(5_000);
  await rejected;
  await expect(access(finalPath)).rejects.toThrow();
  expect(catalog.closeCount).toBe(1);
});
```

Strengthen the existing primary-plus-close failure case. Introduce `const runsRoot = await createRunsRoot();`, pass it to `runWith`, then add:

```ts
await expect(access(join(runsRoot, RUN_ID, "impact-report.md"))).rejects.toThrow();
```

Keep exact assertions for the primary object identity, fixed suppressed failure, and absence of `raw close failure` / `secret-token`.

- [ ] **Step 3: Write failing writer-order and post-close cancellation tests**

Replace the setup in `preserves the safe in-memory report and attempted path after a real writer failure`. Do not pre-create the blocker; create it only from successful close:

```ts
const sandbox = await createRunsRoot();
const blockedRoot = join(sandbox, "runs-file");
const catalog = new FakeCatalog({
  onClose: async () => {
    await writeFile(blockedRoot, "not a directory", "utf8");
  },
});

const caught = await runWith(catalog, blockedRoot).catch((error: unknown) => error);
```

Retain the full `ImpactReportPersistenceError`/report/attempted-path assertions and add:

```ts
expect(catalog.closeCount).toBe(1);
expect(catalog.operations.at(-1)).toBe("close");
await expect(access(join(blockedRoot, RUN_ID, "impact-report.md"))).rejects.toThrow();
```

Add:

```ts
it("rechecks caller cancellation after successful close and before publication", async () => {
  const controller = new AbortController();
  const runsRoot = await createRunsRoot();
  const finalPath = join(runsRoot, RUN_ID, "impact-report.md");
  const catalog = new FakeCatalog({
    onClose: () => controller.abort(),
  });

  await expect(runWith(catalog, runsRoot, controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  await expect(access(finalPath)).rejects.toThrow();
  expect(catalog.closeCount).toBe(1);
});
```

- [ ] **Step 4: Run the application tests and verify RED**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/app/run-impact-analysis.test.ts
```

Expected: close observes an existing report; close rejection and simulated expiry leave a final report; the close-created writer blocker yields the wrong outcome; cancellation after close resolves instead of rejecting.

- [ ] **Step 5: Introduce the private `readyToPublish` outcome**

Near `BuildImpactReportDraftInput`, add:

```ts
type AnalysisOutcome =
  | {
      readonly kind: "readyToPublish";
      readonly report: ImpactReportDraft;
      readonly markdown: string;
      readonly attemptedPath: string;
    }
  | {
      readonly kind: "failed";
      readonly error: unknown;
    };
```

At the start of `runImpactAnalysis`, replace the old completed/failed union with:

```ts
let outcome: AnalysisOutcome;
```

Keep request parsing, bounded catalog reads, identity/schema checks, evidence normalization, assessment, and report construction unchanged. Replace the current write portion inside the main `try` with:

```ts
deps.signal.throwIfAborted();
const markdown = renderImpactReport(report, deps.secrets);
deps.signal.throwIfAborted();
outcome = {
  kind: "readyToPublish",
  report,
  markdown,
  attemptedPath: resolve(deps.runsRoot, report.runId, "impact-report.md"),
};
```

Keep the catch:

```ts
} catch (error) {
  outcome = { kind: "failed", error };
}
```

- [ ] **Step 6: Make close and cancellation gates precede the existing writer**

Retain the close block but change its successful-outcome branch and tail to:

```ts
try {
  await deps.catalog.close();
} catch (closeError) {
  if (outcome.kind === "readyToPublish") throw closeError;

  const failure: SuppressedFailure = {
    code: "MCP_UNAVAILABLE",
    message: "The DataHub catalog could not be closed after analysis failed.",
  };
  attachSuppressedFailure(outcome.error, failure);
}

if (outcome.kind === "failed") throw outcome.error;

deps.signal.throwIfAborted();

let artifactPath: string;
try {
  artifactPath = await writeRunArtifact({
    runsRoot: deps.runsRoot,
    runId: outcome.report.runId,
    filename: "impact-report.md",
    content: outcome.markdown,
    signal: deps.signal,
  });
} catch (error) {
  if (error instanceof AppError && error.code === "ARTIFACT_WRITE_FAILED") {
    throw new ImpactReportPersistenceError(outcome.report, outcome.attemptedPath);
  }
  throw error;
}

return { ...outcome.report, artifactPath };
```

Do not add a second timeout around `deps.catalog.close()`: Task 2 made that interface bounded and idempotent at the resource owner. Do not retry close after writer failure.

- [ ] **Step 7: Run GREEN and coupled CLI/writer regressions**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/app/run-impact-analysis.test.ts src/cli.test.ts src/artifacts/write-run-artifacts.test.ts
pnpm typecheck
```

Expected: exactly these three files pass; successful close precedes visibility; close failure/expiry and post-close cancellation publish nothing; primary failure remains authoritative; writer failure occurs after one successful close; CLI still maps `MCP_UNAVAILABLE` to exit 3 with empty stdout and fixed recovery; writer remains create-only.

- [ ] **Step 8: Commit the terminal-publication correction**

Run:

```powershell
git add src/app/run-impact-analysis.ts src/app/run-impact-analysis.test.ts
git diff --cached --check
git commit -m "fix: close catalog before report publication"
```

Expected: one commit containing only orchestration and application tests. No CLI or artifact-writer production churn is included.

---

### Task 7: Align Historical and Future Execution Authority

**Files:**

- Read: `docs/superpowers/specs/2026-07-23-datahub-runtime-blocker-remediation-design.md`
- Modify: `docs/specs/001-datahub-impact-slice/plan.md`
- Modify: `docs/specs/002-nextjs-openai-agent-demo/plan.md`

**Interfaces:**

- Consumes: the implemented shared MCP boundary, canonical-URN gate, and close-before-publication protocol.
- Produces: narrow corrective execution guidance; specifications 001/002 and their product acceptance criteria remain unchanged.
- Guarantees: no future worker follows the historical write-before-close example, interprets incomplete “exact URN” as an alias, or replaces the shared 15-second call / 5-second cleanup boundaries with the future 55-second workflow parent budget.

- [ ] **Step 1: Add one explicit corrective note to plan 001**

Immediately after `### Task 7: Orchestrate Analysis and Render the Markdown Artifact` in `docs/specs/001-datahub-impact-slice/plan.md`, add:

```markdown
> **Corrective authority (2026-07-23):** The approved
> `docs/superpowers/specs/2026-07-23-datahub-runtime-blocker-remediation-design.md`
> supersedes only the write-before-close sequence in this task. Treat the rendered report as an
> in-memory `readyToPublish` candidate; close the owned catalog through the shared bounded,
> idempotent five-second cleanup boundary; recheck caller cancellation; then invoke the existing
> create-only writer. Close rejection or expiry returns `MCP_UNAVAILABLE` and leaves no
> `impact-report.md`. A primary analysis error remains authoritative if cleanup also fails; a
> writer failure after successful close remains `ARTIFACT_WRITE_FAILED`; cleanup is never retried.
> The Step 3 code below is historical wherever it conflicts with this correction.
```

Do not rewrite the historical code block or imply that it originally implemented the corrected order.

- [ ] **Step 2: Correct Task 1A identity and terminal order in plan 002**

In the Task 1A exact-order block of `docs/specs/002-nextjs-openai-agent-demo/plan.md`, replace the search and terminal lines so the complete block reads:

```text
parse intent
collect all search pages
if search is incomplete, continue only when the user hint is a canonical dataset URN and exactly one collected candidate.urn equals it
resolve complete search from collected candidates; never infer TARGET_NOT_FOUND from incomplete search
collect all schema pages
if schema is incomplete and the source is absent, stop with a collection failure
validate source field; never infer COLUMN_NOT_FOUND from incomplete schema
collect table lineage
collect column lineage
request entity context for target plus deduplicated table-lineage URNs
normalize evidence and calculate Context Coverage
assess impact with the unchanged assessImpact function
derive INCOMPLETE_EVIDENCE before existing status rules
build the ImpactReportDraft and Markdown in memory
close the catalog exactly once through the shared five-second bounded idempotent cleanup boundary
recheck caller cancellation
publish impact-report.md with create-only semantics
return the successful run
```

Replace the following incomplete-search paragraph with:

```markdown
If incomplete search still contains exactly one candidate whose `candidate.urn` equals an explicit
user hint that passes the canonical dataset-URN parser, analysis may continue with
`search.complete=false`. Candidate name, explicit `platform:name`, and URN-derived
`platform:name` matches never establish uniqueness for incomplete search. Every absent,
duplicated, alias-only, or noncanonical outcome throws sanitized `DATAHUB_UNAVAILABLE` with
`Dataset search was incomplete.` without `TARGET_NOT_FOUND` or false ambiguity. If incomplete
schema contains the source field, analysis may continue with `schema.complete=false`; if it does
not, throw sanitized `DATAHUB_UNAVAILABLE` with `Dataset schema was incomplete.` without
`COLUMN_NOT_FOUND`. Add tests for all branches and assert that the two absence codes are emitted
only from complete collections.
```

Immediately after it, add:

```markdown
All four DataHub reads reuse the approved application boundary in
`src/datahub/mcp/mcp-boundary-policy.ts`: each call owns 15 seconds beneath the workflow budget,
passes explicit SDK `timeout` and `maxTotalTimeout`, and validates the complete result against the
1 MiB / depth-64 / 100,000-node budget plus tool-specific schemas. Normal close owns five seconds
and one cached settlement. Close rejection or expiry after otherwise successful analysis is
`MCP_UNAVAILABLE`, publishes no impact report, never makes `ChangeContext` ready, and cannot enter
agent generation. Primary analysis failure remains authoritative; writer failure after close
remains `ARTIFACT_WRITE_FAILED`.
```

- [ ] **Step 3: Make Task 9A reuse, rather than replace, the shared boundary**

Extend Task 9A’s first test step with:

```markdown
Add an otherwise-successful analysis whose catalog close rejects and one whose close expires at the
shared five-second boundary. Both must terminate as `MCP_UNAVAILABLE`, observe `closeCount === 1`,
leave no legacy `impact-report.md`, never make deterministic context ready, make zero provider
generation calls, and leave no package manifest or finalized package.
```

Immediately after the paragraph that creates the 55-second DataHub child scope, add:

```markdown
The workflow-owned 55-second DataHub-analysis scope is a parent budget and classification owner; it
does not replace or lengthen the shared adapter's 15-second per-call deadline or five-second close
deadline. A shared per-call expiry remains fixed `DATAHUB_UNAVAILABLE`; a shared close
rejection/expiry remains fixed `MCP_UNAVAILABLE`. Both settle before the parent budget and suppress
late results.
```

Replace the sentence beginning with `The existing runImpactAnalysis finally-equivalent close path`
with:

```markdown
The existing `runImpactAnalysis` close-before-publication path remains the sole owner after
successful catalog creation: build the report in memory, close through the shared bounded
idempotent boundary, recheck cancellation, then publish through the create-only writer.
`connectDataHubMcp` owns cleanup before catalog creation succeeds. Do not close the same client from
the route handler.
```

- [ ] **Step 4: Verify the documentation delta**

Run:

```powershell
.\node_modules\.bin\prettier.cmd --check docs/specs/001-datahub-impact-slice/plan.md docs/specs/002-nextjs-openai-agent-demo/plan.md
rg -n "Corrective authority|canonical dataset-URN|15-second per-call|close-before-publication|readyToPublish" docs/specs/001-datahub-impact-slice/plan.md docs/specs/002-nextjs-openai-agent-demo/plan.md
git diff --check
git diff -- docs/specs/001-datahub-impact-slice/plan.md docs/specs/002-nextjs-openai-agent-demo/plan.md
```

Expected: Prettier passes; both plans point to the same canonical identity, shared MCP limits, and close-before-publication authority; the diff changes no product specification or unrelated task.

- [ ] **Step 5: Commit the authority corrections**

Run:

```powershell
git add docs/specs/001-datahub-impact-slice/plan.md docs/specs/002-nextjs-openai-agent-demo/plan.md
git diff --cached --check
git commit -m "docs: align DataHub runtime authority"
```

Expected: one documentation-only commit containing exactly the two approved implementation-plan corrections.

---

### Task 8: Verify the Complete Remediation and Prepare Review Evidence

**Files:**

- Inspect: every file listed in the Target File Map.
- Do not create or modify production, test, fixture, dependency, lockfile, CI, example, or documentation files in this task.

**Interfaces:**

- Consumes: the seven reviewed implementation commits.
- Produces: fresh deterministic evidence for formatting, lint, strict types, focused and full offline tests, build, diff hygiene, scope, secret-scan availability, and live-test status.

- [ ] **Step 1: Prove the expected commit and file scope**

Run:

```powershell
git status --short
git log --oneline -8
git diff --name-status HEAD~7..HEAD
```

Expected: the worktree is clean; the latest seven implementation commits correspond to Tasks 1–7; only the target production/test/authority files changed. If an approved task required a corrective follow-up commit, record the exact reason and compare from the commit immediately before Task 1 instead of assuming `HEAD~7`.

- [ ] **Step 2: Run the complete focused remediation slice**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run src/datahub/mcp/mcp-boundary-policy.test.ts src/datahub/mcp/mcp-tool-result-budget.test.ts src/datahub/mcp/decode-tool-result.test.ts src/datahub/mcp/schemas.test.ts src/datahub/mcp/datahub-mcp-catalog.test.ts src/domain/resolve-dataset.test.ts src/app/run-impact-analysis.test.ts src/cli.test.ts src/artifacts/write-run-artifacts.test.ts scripts/capture-datahub-fixtures.test.ts
```

Expected: exactly these ten files pass. Evidence covers all four reads, startup/normal cleanup, raw results, schemas, identity resolution, terminal publication, CLI mapping, unchanged writer semantics, and fixture-capture reuse of `DataHubMcpCatalog`.

- [ ] **Step 3: Prove the offline inventory before the broad suite**

Run:

```powershell
$offlineTests = @(
  rg --files -g "*.test.ts" |
    Where-Object { ($_ -replace "\\", "/") -notlike "tests/integration/*" } |
    Sort-Object
)
$offlineTests
if ($offlineTests.Count -ne 20) {
  throw "Expected exactly 20 offline test files, found $($offlineTests.Count)."
}
```

Expected: exactly 20 offline test files after adding the policy, result-budget, and schema tests; `tests/integration/datahub-mcp.integration.test.ts` is absent from the list.

- [ ] **Step 4: Run repository gates with fresh exit evidence**

Run each command separately and inspect its exit code:

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

Expected: formatting, lint, strict TypeScript, all 20 offline test files, and the CLI build pass without credentials or live services.

- [ ] **Step 5: Check secrets, diff hygiene, and prohibited scope**

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

Then:

```powershell
git diff --check HEAD~7..HEAD
git diff --stat HEAD~7..HEAD
git status --short --branch
```

Inspect the complete seven-task diff and confirm:

- no dependency, lockfile, CI, environment, custom transport, mutation, SQL, retry, fixture, example-report, Next.js, OpenAI, or browser change;
- no raw MCP payload, abort reason, dependency exception, token, private native path, or secret-bearing test artifact;
- no success trace before decode/schema validation;
- no incomplete alias reaches downstream work;
- no report is published before successful close; and
- no live or skipped check is described as passing.

- [ ] **Step 6: Report optional live integration truthfully**

Do not run live integration merely to satisfy mandatory acceptance. If the documented pinned local DataHub environment and non-secret configuration are already available and the project owner authorizes the live check, run:

```powershell
pnpm test:integration
```

Report exactly one of `PASSED`, `FAILED`, or `NOT RUN`. `NOT RUN` is the default and is not a blocker for this approved offline remediation.

- [ ] **Step 7: Request two-stage review before any push**

Use `superpowers:requesting-code-review` for spec compliance, then `pr-self-review-handoff` for senior engineering review. Require reviewers to inspect:

1. all 20 corrective acceptance criteria;
2. first-wins cancellation and late-settlement behavior;
3. exact byte/depth/node semantics and absence of unbounded MCP schema declarations;
4. startup and normal close ownership;
5. complete versus incomplete resolution behavior;
6. final publication linearization;
7. error/secret redaction;
8. tests and command evidence; and
9. the exact seven-task diff.

Do not push, merge, create/update a pull request, or remove the worktree until the project owner separately authorizes that external action.

---
