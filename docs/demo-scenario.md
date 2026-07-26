# DataHub Demo Scenario

This fixed scenario uses the official `showcase-ecommerce` datapack with DataHub Core v1.6.0, DataHub CLI 1.6.0.15, Python 3.11, and DataHub MCP Server 0.6.0.

## Prerequisites

- Docker Desktop running locally.
- `uv` and `uvx` 0.11.21 available on `PATH`; `uv` provisions Python 3.11 below.
- Node.js 22.23.1 and pnpm 10.10.0.

Install the repository dependencies:

```powershell
pnpm install --frozen-lockfile
```

## Start Pinned DataHub Core and Create Local Authentication

Run these commands from the repository root. They create a local Python 3.11 environment, install the exact CLI version, start DataHub Core v1.6.0, verify GMS health, and generate local authentication configuration. Do not commit `.venv` or `$env:USERPROFILE\.datahubenv`.

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

## Load the Official Datapack on Windows

The pinned Windows CLI cannot ingest the datapack through its local-file loader. Use the exact ephemeral Linux process below instead. It installs the exact same CLI package in Python 3.11, uses the generated local auth file read-only, mounts no repository, backup, cache, or Docker socket, and is removed automatically.

First discover the pinned GMS container, locate the network that publishes its stable internal DNS name, and verify that the constructed service URL is reachable without modifying DataHub:

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
```

Then load the datapack using the immutable base-image reference:

```powershell
docker run --rm --network $network --mount "type=bind,source=$env:USERPROFILE\.datahubenv,target=/tmp/source-datahubenv,readonly" --env PYTHONUTF8=1 --env "DATAHUB_GMS_INTERNAL_URL=$gmsInternalUrl" python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93 /bin/sh -c 'set -eu; pip install --no-cache-dir --quiet "acryl-datahub==1.6.0.15"; datahub version; cp /tmp/source-datahubenv /root/.datahubenv; sed -i "s#http://localhost:8080#$DATAHUB_GMS_INTERNAL_URL#g" /root/.datahubenv; datahub check server-config >/dev/null; datahub datapack load showcase-ecommerce'
```

## Run the Live MCP Proof and Capture a Fixture Candidate

Set the local token only in the current shell. The following command extracts it in memory from the local configuration without printing or writing it into the repository:

```powershell
$env:DATAHUB_GMS_URL = "http://localhost:8080"
$env:DATAHUB_GMS_TOKEN = & .\.venv\Scripts\python.exe -c "from pathlib import Path; import yaml; config=yaml.safe_load(Path(r'$env:USERPROFILE\.datahubenv').read_text(encoding='utf-8')); find=lambda value: next((found for key,item in value.items() for found in ([item] if key.lower()=='token' and isinstance(item,str) else [find(item)] if isinstance(item,dict) else [] ) if found), None); token=find(config); assert token and isinstance(token,str); print(token)"
$env:DATAHUB_MCP_UVX_PATH = (Get-Command uvx -ErrorAction Stop).Source
& $env:DATAHUB_MCP_UVX_PATH mcp-server-datahub@0.6.0 --version
if ($LASTEXITCODE -ne 0) { throw "Pinned MCP prewarm failed." }
pnpm test:integration
pnpm tsx scripts/capture-datahub-fixtures.ts
```

The capture command prints a repository-relative path beneath `tmp/datahub-fixture-captures/capture-*`. It never overwrites the committed replay fixtures. A complete candidate contains these five canonical strict `{ items, completeness }` fixtures plus an empty `.complete` marker created last:

| Fixture                                    | Purpose                                           |
| ------------------------------------------ | ------------------------------------------------- |
| `search-order-details.json`                | Exact dataset-search candidates.                  |
| `schema-order-details.json`                | Target schema fields.                             |
| `lineage-order-details-table.json`         | Two-hop downstream table lineage.                 |
| `lineage-order-details-customer-id.json`   | Two-hop downstream lineage for `customer_id`.     |
| `entity-context-order-details-impact.json` | Allowlisted target and downstream entity context. |

The candidate is replay-compatible review evidence rather than a current live-service claim. The entity-context schema rejects fields named `email`, `profile`, `relatedDocuments`, `rawSql`, `token`, and `diagnostics`, and rejects descriptions longer than 2,000 characters; serialization redacts the configured DataHub token literal. This does not claim a general content scan for every SQL or credential-shaped string. An unmarked candidate is untrusted even if its files look complete: do not manually create, copy, or add `.complete`; delete it and rerun capture. Promotion into `tests/fixtures/datahub/` is a separate owner-approved deterministic migration; the `.complete` marker is never promoted.

## Run the Live OpenAI Acceptance

Keep the DataHub variables from the MCP proof in the current shell. Supply the OpenAI key through hidden input, disable provider tracing explicitly, and remove both credentials when the test ends:

```powershell
$secureOpenAIKey = Read-Host "OpenAI API key (input hidden)" -AsSecureString
try {
  [Environment]::SetEnvironmentVariable(
    "OPENAI_API_KEY",
    [Net.NetworkCredential]::new("", $secureOpenAIKey).Password,
    "Process"
  )
  Remove-Variable secureOpenAIKey
  $env:RUN_LIVE_OPENAI_TEST = "1"
  $env:OPENAI_AGENTS_DISABLE_TRACING = "1"
  pnpm test:openai
  if ($LASTEXITCODE -ne 0) { throw "Live OpenAI acceptance failed." }
} finally {
  Remove-Variable secureOpenAIKey -ErrorAction SilentlyContinue
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:RUN_LIVE_OPENAI_TEST -ErrorAction SilentlyContinue
  Remove-Item Env:OPENAI_AGENTS_DISABLE_TRACING -ErrorAction SilentlyContinue
  Remove-Item Env:DATAHUB_GMS_TOKEN -ErrorAction SilentlyContinue
}
```

The passing acceptance requires status `COMPLETED`, deterministic impact 24 downstream assets / 11 column-confirmed assets / score 90, and exactly four validated artifacts. It does not execute SQL or mutate DataHub.

## Selected Change

- Dataset: `urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)`
- Source field: `customer_id` (`NUMBER(38,0)`)
- Request: `Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details`
- Lineage bound: two downstream hops

## Verified Fixture Facts

The sanitized fixtures record 24 table-level downstream assets within the two-hop bound. They contain 11 column-lineage assets, including 10 observed mappings for the source field (four returned as `customer_id` and six as the source-system case variant `CUSTOMER_ID`).

| Downstream asset               | Platform  | Hop | Observed lineage columns      |
| ------------------------------ | --------- | --: | ----------------------------- |
| `order_history`                | dbt       |   1 | `customer_id`                 |
| `order_details`                | looker    |   1 | `customer_id`                 |
| `ORDER_DETAILS`                | powerbi   |   1 | `CUSTOMER_ID`                 |
| `ORDER_HISTORY`                | snowflake |   1 | `customer_id`                 |
| `Customer Analytics Measures`  | powerbi   |   1 | `CUSTOMER_ID`, `Customer LTV` |
| `Essential KPI Measures`       | powerbi   |   1 | `CUSTOMER_ID`                 |
| `Geographic Measures`          | powerbi   |   1 | `CUSTOMER_ID`                 |
| `Product Perfromance Measures` | powerbi   |   1 | `CUSTOMER_ID`                 |
| `Time Inteligence Measures`    | powerbi   |   1 | `CUSTOMER_ID`                 |
| `ORDER_DETAILS_REPLICA`        | snowflake |   1 | `customer_id`                 |

These counts and mappings are verified fixture facts for the pinned datapack version. They can change if the official datapack changes.

The certified golden replay has complete search, schema, table-lineage, and column-lineage collections for the stated 24/11 facts. If any required collection is incomplete, LineageGuard uses `INCOMPLETE_EVIDENCE`: collected counts are lower bounds, incomplete search/schema cannot prove absence, and incomplete lineage cannot justify direct-rename guidance. Entity-context gaps are reported separately as Context Coverage and do not alone select that status.

Official datapack index: <https://github.com/datahub-project/static-assets/blob/main/datapacks/showcase-ecommerce/index.json>

## Three-Minute Video Script

1. 0:00–0:20 — Frame the Metadata-Aware Code Generation & Development problem and trigger.
2. 0:20–0:35 — Show the LIVE/REPLAY badge and state which evidence source is active.
3. 0:35–1:05 — Verify the DataHub dataset, schema, table lineage, column lineage, and ownership.
4. 1:05–1:30 — Show Evidence Completeness, Context Coverage, and Runtime Proof as separate panels.
5. 1:30–1:50 — Show 24 downstream, 11 column-confirmed, risk score 90, and BLOCK_DIRECT_RENAME.
6. 1:50–2:35 — Run analyze_rename_change and generate_migration_package; inspect four artifacts and the non-executable physical-name gate.
7. 2:35–2:55 — Close on mutations disabled, read-only/no-SQL behavior, human approval, and practical team value.

If DataHub or OpenAI is unavailable, restart in `REPLAY` mode. Replay is recorded fixture execution.
