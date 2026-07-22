# DataHub Demo Scenario

This fixed scenario uses the official `showcase-ecommerce` datapack with DataHub Core v1.6.0, DataHub CLI 1.6.0.15, Python 3.11, and DataHub MCP Server 0.6.0.

## Prerequisites

- Docker Desktop running locally.
- Python 3.11 available through `py -3.11`.
- Node.js 22.23.1 and pnpm 10.10.0.
- `uvx` on `PATH` for `mcp-server-datahub@0.6.0`.

Install the repository dependencies:

```powershell
pnpm install --frozen-lockfile
```

## Start Pinned DataHub Core and Create Local Authentication

Run these commands from the repository root. They create a local Python 3.11 environment, install the exact CLI version, start DataHub Core v1.6.0, verify GMS health, and generate local authentication configuration. Do not commit `.venv` or `$env:USERPROFILE\.datahubenv`.

```powershell
py -3.11 -m venv .venv
\.venv\Scripts\python.exe -m pip install --upgrade pip wheel setuptools
\.venv\Scripts\python.exe -m pip install acryl-datahub==1.6.0.15
\.venv\Scripts\datahub.exe version
\.venv\Scripts\datahub.exe docker quickstart --version v1.6.0 --pull-images
Invoke-RestMethod http://localhost:8080/health
$env:PYTHONUTF8 = "1"
\.venv\Scripts\datahub.exe init --username datahub --password datahub
```

## Load the Official Datapack on Windows

The pinned Windows CLI cannot ingest the datapack through its local-file loader. Use the exact ephemeral Linux process below instead. It installs the exact same CLI package in Python 3.11, uses the generated local auth file read-only, mounts no repository, backup, cache, or Docker socket, and is removed automatically.

First discover the active GMS network and required service alias:

```powershell
$gmsContainer = "datahub-datahub-gms-quickstart-1"
$network = docker inspect $gmsContainer --format '{{range $name, $network := .NetworkSettings.Networks}}{{$name}}{{end}}'
$aliases = @(docker inspect $gmsContainer --format '{{range $name, $network := .NetworkSettings.Networks}}{{range $network.Aliases}}{{println .}}{{end}}{{end}}')
if ($network -ne "datahub_network") { throw "Expected the DataHub quickstart network." }
if ($aliases -notcontains "datahub-gms") { throw "Expected the DataHub GMS network alias." }
```

Then load the datapack using the immutable base-image reference:

```powershell
docker run --rm --network $network --mount "type=bind,source=$env:USERPROFILE\.datahubenv,target=/tmp/source-datahubenv,readonly" --env PYTHONUTF8=1 python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93 /bin/sh -c 'set -eu; pip install --no-cache-dir --quiet "acryl-datahub==1.6.0.15"; datahub version; cp /tmp/source-datahubenv /root/.datahubenv; sed -i "s#http://localhost:8080#http://datahub-gms:8080#g" /root/.datahubenv; datahub check server-config >/dev/null; datahub datapack load showcase-ecommerce'
```

## Run the Live MCP Proof and Capture Fixtures

Set the local token only in the current shell. The following command extracts it in memory from the local configuration without printing or writing it into the repository:

```powershell
$env:DATAHUB_GMS_URL = "http://localhost:8080"
$env:DATAHUB_GMS_TOKEN = & .\.venv\Scripts\python.exe -c "from pathlib import Path; import yaml; config=yaml.safe_load(Path(r'$env:USERPROFILE\.datahubenv').read_text(encoding='utf-8')); find=lambda value: next((found for key,item in value.items() for found in ([item] if key.lower()=='token' and isinstance(item,str) else [find(item)] if isinstance(item,dict) else [] ) if found), None); token=find(config); assert token and isinstance(token,str); print(token)"
$env:DATAHUB_MCP_UVX_PATH = "uvx"
pnpm test:integration
pnpm tsx scripts/capture-datahub-fixtures.ts
```

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

Official datapack index: <https://github.com/datahub-project/static-assets/blob/main/datapacks/showcase-ecommerce/index.json>
