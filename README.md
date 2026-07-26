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

The CLI has no runs-directory default. Supply an absolute pre-created root through `--runs-dir` or
`LINEAGEGUARD_RUNS_DIR`; the command-line flag takes precedence.

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
$env:PYTHONUTF8 = "1"
.\.venv\Scripts\datahub.exe docker quickstart --version v1.6.0 --pull-images
Invoke-RestMethod http://localhost:8080/health
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
$env:DATAHUB_MCP_UVX_PATH = (Get-Command uvx -ErrorAction Stop).Source
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
- The browser and optional live OpenAI flows generate virtual SQL and Markdown artifacts only;
  they do not execute SQL, mutate DataHub, perform GitHub operations, or bypass human approval.

## Browser Demo — Fixture Replay

```powershell
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
$runsRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "LineageGuard\replay-runs"
New-Item -ItemType Directory -Path $runsRoot -Force | Out-Null
$env:LINEAGEGUARD_RUNS_DIR = (Resolve-Path -LiteralPath $runsRoot).Path
$env:LINEAGEGUARD_DEMO_MODE = "REPLAY"
pnpm dev
```

Open <http://localhost:3000>. The operator-created runs root is absolute, pre-created, owned by the
application account, and retained across restarts; application runtime code never creates or
removes it. Replay is deterministic, offline, and explicitly labeled; it does not call DataHub or
OpenAI.

## Browser Demo — Live DataHub + OpenAI

Start the pinned DataHub stack and load the documented showcase datapack first.

DataHub Quickstart is local-development-only and requires Docker Compose v2. Its CLI supports a
Python 3.10 or newer baseline, while pinned MCP Server `0.6.0` requires Python 3.11 or newer;
LineageGuard standardizes live mode on Python 3.11. The tested local allocation is
2 CPU / 8 GB RAM / 2 GB swap / 13 GB disk. `datahub datapack` is experimental, so Fixture replay
is the deterministic fallback. Default credentials and exposed ports must never be published.
Repeat `datahub init` after an operator-approved local nuke or a signing-key change.

### Live Operator Preflight

1. Verify Python `3.11.x`, `acryl-datahub==1.6.0.15`, the pinned DataHub Core `v1.6.0` services, MCP Server `0.6.0`, and the tested Docker baseline of 2 CPU / 8 GB RAM / 2 GB swap / 13 GB disk.
2. Check ports `3306`, `8080`, `8081`, `9002`, `9092`, `9200`, and `2181`; each must be available before startup or owned by the expected pinned DataHub service.
3. Run `.\.venv\Scripts\datahub.exe docker check` and require success.
4. Run `Invoke-RestMethod http://localhost:8080/health` and require a healthy GMS response.
5. Open <http://localhost:9002>, use `datahub/datahub` only on an isolated localhost Quickstart, and verify `b2fd91.order_entry_db.analytics.order_details`, `customer_id`, visible lineage, ownership, the intended account, and available search-visibility scope. Never expose the default credentials or ports publicly.
6. Resolve and prewarm the pinned MCP executable before requesting a PAT. Then configure shell-local `DATAHUB_GMS_URL` and `DATAHUB_GMS_TOKEN` without printing or persisting the PAT and run the four-operation integration contract. Every path after token entry must remove the token:

   ```powershell
   $uvxPath = (Get-Command uvx -ErrorAction Stop).Source
   if (-not [System.IO.Path]::IsPathFullyQualified($uvxPath)) {
     throw "uvx did not resolve to an absolute path."
   }
   $env:DATAHUB_MCP_UVX_PATH = $uvxPath
   & $uvxPath mcp-server-datahub@0.6.0 --version
   if ($LASTEXITCODE -ne 0) { throw "Pinned MCP prewarm failed." }

   $env:DATAHUB_GMS_URL = "http://localhost:8080"
   $secureDataHubToken = Read-Host "DataHub PAT (input hidden)" -AsSecureString
   try {
     $env:DATAHUB_GMS_TOKEN = & {
       param([Security.SecureString]$secureToken)
       [Net.NetworkCredential]::new("", $secureToken).Password
     } $secureDataHubToken
     Remove-Variable secureDataHubToken
     pnpm test:integration
     if ($LASTEXITCODE -ne 0) { throw "Pinned MCP integration contract failed." }
   } finally {
     Remove-Variable secureDataHubToken -ErrorAction SilentlyContinue
     Remove-Item Env:DATAHUB_GMS_TOKEN -ErrorAction SilentlyContinue
   }
   ```

7. Only after Steps 1–6 pass, configure OpenAI and start the live browser workflow with a fresh hidden PAT. Keep the long-running process inside the same cleanup boundary:

   ```powershell
   if (-not $env:OPENAI_API_KEY) { throw "OPENAI_API_KEY is not configured in this shell." }
   $runsRoot = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "LineageGuard\live-runs"
   New-Item -ItemType Directory -Path $runsRoot -Force | Out-Null
   $env:LINEAGEGUARD_RUNS_DIR = (Resolve-Path -LiteralPath $runsRoot).Path
   $env:OPENAI_MODEL = "gpt-5.6-sol"
   $env:OPENAI_AGENTS_DISABLE_TRACING = "1"
   $env:LINEAGEGUARD_DEMO_MODE = "LIVE"

   $secureDataHubToken = Read-Host "DataHub PAT for live demo (input hidden)" -AsSecureString
   try {
     $env:DATAHUB_GMS_TOKEN = & {
       param([Security.SecureString]$secureToken)
       [Net.NetworkCredential]::new("", $secureToken).Password
     } $secureDataHubToken
     Remove-Variable secureDataHubToken
     pnpm dev
     if ($LASTEXITCODE -ne 0) { throw "Live browser workflow failed." }
   } finally {
     Remove-Variable secureDataHubToken -ErrorAction SilentlyContinue
     Remove-Item Env:DATAHUB_GMS_TOKEN -ErrorAction SilentlyContinue
     Remove-Item Env:LINEAGEGUARD_RUNS_DIR -ErrorAction SilentlyContinue
   }
   ```

   The operator-owned live runs root remains in place after the shell variable is cleared. Do not
   recursively remove it as part of application shutdown.

The UI endpoint is `http://localhost:9002`; the MCP subprocess connects to the GMS endpoint at
`http://localhost:8080`.

`datahub/datahub` authenticates only the default local Quickstart frontend. A shell-local `DATAHUB_GMS_TOKEN` authenticates the MCP subprocess to GMS. `OPENAI_API_KEY` authenticates only the server-side OpenAI provider. These credentials are separate; default frontend credentials and directly exposed DataHub ports are allowed only on an isolated localhost Quickstart and must never be published.

UI ingestion, connector recipes, DataHub Secrets, ingestion schedules, user onboarding, custom
JAAS, and OIDC are not LineageGuard runtime dependencies and must not be enabled as a PAT or MCP
workaround. If PAT controls are unavailable, verify `METADATA_SERVICE_AUTH_ENABLED=true`
consistently for `datahub-gms` and `datahub-frontend`, restart the affected services, and verify
token-generation privileges; never disable authentication or enable mutations. Default-credential
changes and OIDC are future production-hardening references only.

Destructive recovery is separate from the golden path. Inspect expected containers and targeted
logs first. `datahub docker nuke` is an explicit data-loss action allowed only after backup and an
operator's choice; never use broad Docker pruning or manual database/index repair as routine
recovery.

The MCP server may advertise additional tools. LineageGuard AI invokes only `search`, `list_schema_fields`, `get_lineage`, and `get_entities` through an application-owned read-only allowlist. The OpenAI agent never receives raw MCP access.

Total advertised counts such as `22`, `10 read`, or `12 write` are version- and
configuration-dependent. Only the four-name application allowlist is contractual.

The current DataHub MCP guide is deployment, authentication, and troubleshooting guidance, not LineageGuard AI's executable contract. Certified local mode uses `uvx mcp-server-datahub@0.6.0 --transport stdio`; the pinned `v0.6.0` release and source, runtime discovery, and application contract tests define supported names and parameters. `@latest`, managed remote HTTP/OAuth, and newly advertised tools are not certified runtime authority.

The guide's `spawn uvx ENOENT` remedy is an absolute `uvx` path. On Windows, LineageGuard AI locates that path with `Get-Command uvx` and supplies it through its own `DATAHUB_MCP_UVX_PATH` configuration.

A service account's Default View scopes MCP searches. The live record must identify the intended account and search-visibility scope when available; a changed view invalidates comparison with certified search evidence. Effects on schema, lineage, or entity reads remain unclaimed until the pinned live contract test establishes them. Never disable the view or bypass DataHub authorization to recover an expected result.

Never use `@latest`, put a PAT in a URL, or persist either token. Set `OPENAI_API_KEY`,
`OPENAI_MODEL=gpt-5.6-sol`, `OPENAI_AGENTS_DISABLE_TRACING=1`,
`LINEAGEGUARD_DEMO_MODE=LIVE`, and `LINEAGEGUARD_RUNS_DIR` pointing to an absolute, pre-created,
application-account-owned directory in the same shell before running `pnpm dev`.

The application reads DataHub through the official read-only MCP server. It does not execute SQL,
mutate DataHub, or perform GitHub operations.

Expected: every check passes against the pinned local profile; `DATAHUB_MCP_UVX_PATH` is absolute;
no token is printed or persisted; the four-operation integration contract passes before OpenAI is
called. Any failure stops live mode and preserves replay.
