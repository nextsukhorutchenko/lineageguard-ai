# DataHub Demo Scenario

This fixed scenario uses the official `showcase-ecommerce` datapack with DataHub Core v1.6.0, DataHub CLI 1.6.0.15, and DataHub MCP Server 0.6.0.

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

## Datapack Source and Reproduction

Official datapack index: <https://github.com/datahub-project/static-assets/blob/main/datapacks/showcase-ecommerce/index.json>

On Windows, use the exact Python 3.11 / CLI 1.6.0.15 container path below after starting local DataHub Core v1.6.0 and running `datahub init` locally. It uses the generated local auth configuration read-only, changes only the in-container GMS host, and leaves no persistent container or mounted repository data.

```powershell
docker run --rm --network datahub_network --mount "type=bind,source=$env:USERPROFILE\.datahubenv,target=/tmp/source-datahubenv,readonly" --env PYTHONUTF8=1 python:3.11-slim /bin/sh -c 'set -eu; pip install --no-cache-dir --quiet "acryl-datahub==1.6.0.15"; cp /tmp/source-datahubenv /root/.datahubenv; sed -i "s#http://localhost:8080#http://datahub-gms:8080#g" /root/.datahubenv; datahub check server-config >/dev/null; datahub datapack load showcase-ecommerce'
```

Then run:

```powershell
$env:DATAHUB_GMS_URL = "http://localhost:8080"
$env:DATAHUB_GMS_TOKEN = "<local token>"
pnpm test:integration
pnpm tsx scripts/capture-datahub-fixtures.ts
```
