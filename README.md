# LineageGuard AI

LineageGuard AI is a deterministic, CLI-first impact-analysis proof for DataHub. It answers one deliberately constrained question: before renaming a column, which downstream assets are visible within two lineage hops, how strong is the available column evidence, and what explainable risk score follows from those facts?

This vertical slice supports only requests in this form:

```text
Rename column <source> to <target> in dataset <platform>:<dataset-name>
```

The pinned demo analyzes `customer_id` to `customer_key` on the official DataHub `showcase-ecommerce` sample. A verified output is committed at [examples/001-customer-id-rename/impact-report.md](examples/001-customer-id-rename/impact-report.md).

## Architecture and Safety Boundary

The project is one TypeScript package with a thin CLI, an application orchestrator, pure domain modules, a typed DataHub catalog port, an MCP stdio adapter, and a Markdown artifact writer. Generated values are stored as strict immutable JSON envelopes directly beneath a trusted runs root. Public artifacts such as `impact-report.md` are virtual filenames inside those envelopes; application responses never return a native storage path.

`LINEAGEGUARD_RUNS_DIR` is a deployment trust boundary. Before starting LineageGuard, pre-create it as a real directory, make it writable by the application account, and use operating-system permissions to prevent untrusted writers from replacing its contents. The application rejects a root that is missing, a symbolic link, or a Windows junction, and it never creates the configured root. It does not claim to defend against a process that can rename or replace this trusted root.

For the Windows example in `.env.example`, prepare the non-secret path before running the demo:

```powershell
New-Item -ItemType Directory -Path C:\lineageguard-runs
$env:LINEAGEGUARD_RUNS_DIR = "C:\lineageguard-runs"
```

The flat envelope format has not shipped as a supported storage format, so no migration from the previous development-only layout is required.

DataHub access is read-only. The adapter launches the official pinned command:

```text
uvx mcp-server-datahub@0.6.0 --transport stdio
```

It exposes only `search`, `list_schema_fields`, `get_lineage`, and `get_entities` through an application-owned read-only allowlist. The subprocess explicitly disables mutation and document tools. Traces contain normalized, redacted arguments rather than raw MCP payloads, authentication values, process stderr, or wall-clock durations.

## Windows Prerequisites

- Windows PowerShell and Docker Desktop.
- `uv` and `uvx` 0.11.21 available on `PATH`; `uv` provisions Python 3.11 below.
- Node.js 22.23.1.
- pnpm 10.10.0.
- DataHub CLI 1.6.0.15, DataHub Core v1.6.0, and DataHub MCP Server 0.6.0, installed by the commands below.

Clone the repository, enter its root, and install the exact JavaScript dependency graph:

```powershell
pnpm install --frozen-lockfile
```

## Start the Pinned Local DataHub

Create a workspace-local Python environment, install the exact CLI version, start DataHub Core v1.6.0, and create local authentication configuration:

```powershell
uv --version
uvx --version
uv venv --seed --python 3.11 .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip wheel setuptools
.\.venv\Scripts\python.exe -m pip install acryl-datahub==1.6.0.15
.\.venv\Scripts\python.exe --version
.\.venv\Scripts\datahub.exe version
.\.venv\Scripts\datahub.exe docker quickstart --version v1.6.0 --pull-images
Invoke-RestMethod http://localhost:8080/health
$env:PYTHONUTF8 = "1"
.\.venv\Scripts\datahub.exe init --username datahub --password datahub
```

The pinned Windows CLI cannot ingest this datapack through its local-file loader. Load it through an ephemeral Python 3.11 container instead. This command mounts the user-level DataHub authentication file read-only; it does not mount the repository, backup, Docker socket, or package cache.

```powershell
$gmsContainers = @(docker ps --filter "label=io.datahubproject.datahub.component=gms" --filter "ancestor=acryldata/datahub-gms:v1.6.0" --format '{{.ID}}')
if ($gmsContainers.Count -ne 1) { throw "Expected exactly one pinned DataHub GMS container." }
$gmsContainer = $gmsContainers[0]
$gmsServiceName = "datahub-gms"
$networks = docker inspect $gmsContainer --format '{{json .NetworkSettings.Networks}}' | ConvertFrom-Json
$matchingNetworks = @($networks.PSObject.Properties | Where-Object { @($_.Value.DNSNames) -contains $gmsServiceName })
if ($matchingNetworks.Count -ne 1) { throw "Expected one GMS network with the datahub-gms DNS name." }
$network = $matchingNetworks[0].Name
$gmsInternalUrl = "http://${gmsServiceName}:8080"

docker run --rm --network $network --env "DATAHUB_GMS_INTERNAL_URL=$gmsInternalUrl" python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93 python -c 'import os, urllib.request; response = urllib.request.urlopen(os.environ["DATAHUB_GMS_INTERNAL_URL"] + "/health"); assert response.status == 200; print("GMS internal health: 200")'

docker run --rm --network $network --mount "type=bind,source=$env:USERPROFILE\.datahubenv,target=/tmp/source-datahubenv,readonly" --env PYTHONUTF8=1 --env "DATAHUB_GMS_INTERNAL_URL=$gmsInternalUrl" python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93 /bin/sh -c 'set -eu; pip install --no-cache-dir --quiet "acryl-datahub==1.6.0.15"; datahub version; cp /tmp/source-datahubenv /root/.datahubenv; sed -i "s#http://localhost:8080#$DATAHUB_GMS_INTERNAL_URL#g" /root/.datahubenv; datahub check server-config >/dev/null; datahub datapack load showcase-ecommerce'
```

See [docs/demo-scenario.md](docs/demo-scenario.md) for the pinned scenario facts and official datapack source.

## Provide the Token Without Persisting It

Keep the local GMS token only in the current process environment. The extraction command reads the user-level DataHub configuration in memory without printing the token or writing it beneath the repository:

```powershell
$env:DATAHUB_GMS_URL = "http://localhost:8080"
$env:DATAHUB_GMS_TOKEN = & .\.venv\Scripts\python.exe -c "from pathlib import Path; import yaml; config=yaml.safe_load(Path(r'$env:USERPROFILE\.datahubenv').read_text(encoding='utf-8')); find=lambda value: next((found for key,item in value.items() for found in ([item] if key.lower()=='token' and isinstance(item,str) else [find(item)] if isinstance(item,dict) else [] ) if found), None); token=find(config); assert token and isinstance(token,str); print(token)"
$env:DATAHUB_MCP_UVX_PATH = "uvx"
```

Never commit `.env`, `.datahubenv`, or `DATAHUB_GMS_TOKEN`. Remove the shell-local values when finished:

```powershell
Remove-Item Env:DATAHUB_GMS_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:DATAHUB_GMS_URL -ErrorAction SilentlyContinue
Remove-Item Env:DATAHUB_MCP_UVX_PATH -ErrorAction SilentlyContinue
```

## Run the Demo

```powershell
pnpm demo
```

To analyze another rename that follows the supported grammar, invoke the CLI directly and change the request values:

```powershell
pnpm tsx src/cli.ts --request "Rename column order_id to order_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details"
```

A successful run prints its status, run ID, and the virtual report filename:

```text
Status: COMPLETED
Run ID: 20260722T120000Z-0123abcd
Report: impact-report.md
```

Report-producing statuses are:

| Status                       | Meaning                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `COMPLETED`                  | Downstream tables and at least one exact-URN column confirmation are available; coverage gaps may remain.              |
| `COMPLETED_WITH_LIMITATIONS` | Downstream tables exist, but no column-lineage result confirms an exact downstream table URN.                          |
| `INSUFFICIENT_METADATA`      | No downstream lineage was returned within the two-hop boundary.                                                        |
| `INCOMPLETE_EVIDENCE`        | Search, schema, table-lineage, or column-lineage collection is incomplete; collected affected counts are lower bounds. |

`INCOMPLETE_EVIDENCE` still produces a report when enough validated evidence exists to continue. Incomplete search or schema cannot prove that a dataset or source column is absent, and incomplete lineage cannot justify a direct rename. The status changes execution policy without changing the deterministic impact formula. Entity-context gaps remain separate Context Coverage information and do not, by themselves, select `INCOMPLETE_EVIDENCE`.

Input, resolution, missing-column, DataHub/MCP, and artifact failures return actionable terminal guidance and do not fabricate a report.

## Verification

Run the complete offline gate:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run the live gate after exporting the local DataHub environment variables:

```powershell
pnpm test:integration
pnpm demo
```

Run the focused acceptance tests:

```powershell
pnpm vitest run src/artifacts/render-impact-report.test.ts
pnpm vitest run src/domain/resolve-dataset.test.ts
pnpm vitest run src/app/run-impact-analysis.test.ts
pnpm vitest run scripts/capture-datahub-fixtures.test.ts
pnpm vitest run src/security/redact.test.ts
pnpm vitest run src/artifacts/write-run-artifacts.test.ts
```

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

Verify that no tracked repository file contains the active token without printing the token itself:

```powershell
$leaks = git ls-files | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Where-Object { (Get-Content -LiteralPath $_ -Raw) -clike "*$env:DATAHUB_GMS_TOKEN*" }
if ($leaks) { $leaks; throw "The active DataHub token appears in tracked files." }
```

## Current Slice Limitations

- Only the constrained `rename_column` request grammar is supported.
- Lineage analysis is bounded to two downstream hops and depends on the metadata DataHub returns.
- The deterministic score is an explainable heuristic, not a substitute for owner review or runtime testing.
- This slice contains no LLM, mutation tool, SQL generation, UI, or GitHub automation.
