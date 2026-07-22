# LineageGuard AI Impact Report

## Request

| Run ID | Created at | Original request |
| --- | --- | --- |
| 20260722T120000Z-0123abcd | 2026-07-22T12:00:00.000Z | Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details |

## Resolved Change Intent

| Change | Dataset hint | Source column | Target column |
| --- | --- | --- | --- |
| Rename column | snowflake:b2fd91.order_entry_db.analytics.order_details | customer_id | customer_key |

## Selected Dataset

| URN | Name | Platform | Source column | Native type | Nullable |
| --- | --- | --- | --- | --- | --- |
| urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD) | ORDER_DETAILS | Not available | customer_id | NUMBER(38,0) | Yes |

## Evidence Summary

| Evidence level | Downstream assets | Column-affected assets | Inspection bound |
| --- | --- | --- | --- |
| column | 24 | 11 | 2 hops |

## Affected Downstream Assets

| URN | Name | Platform | Hop | Evidence |
| --- | --- | --- | --- | --- |
| urn:li:chart:(powerbi,b2fd91.pages.66666666-7777-8888-9999-000000000000.217abe0d5c1cd421c384) | Not available | powerbi | 2 | Table |
| urn:li:chart:(powerbi,b2fd91.pages.66666666-7777-8888-9999-000000000000.3f48c0bf859b2d14dcd0) | Not available | powerbi | 2 | Table |
| urn:li:chart:(powerbi,b2fd91.pages.66666666-7777-8888-9999-000000000000.83a9aaa3207edd6c721e) | Not available | powerbi | 2 | Table |
| urn:li:chart:(powerbi,b2fd91.pages.66666666-7777-8888-9999-000000000000.85e432543b30346a0507) | Not available | powerbi | 2 | Table |
| urn:li:dashboard:(powerbi,b2fd91.reports.66666666-7777-8888-9999-000000000000) | Not available | powerbi | 2 | Table |
| urn:li:dataset:(urn:li:dataPlatform:dbt,b2fd91.ORDER_ENTRY_DB.analytics.order_history,PROD) | order_history | dbt | 1 | Column |
| urn:li:dataset:(urn:li:dataPlatform:looker,b2fd91.order-entry-looker.view.order_details,PROD) | order_details | looker | 1 | Column |
| urn:li:dataset:(urn:li:dataPlatform:looker,b2fd91.order-entry.explore.order_details,PROD) | Order Details | looker | 2 | Column |
| urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Customer_Analytics_Measures,PROD) | Customer Analytics Measures | powerbi | 1 | Column |
| urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Essential_KPI_Measures,PROD) | Essential KPI Measures | powerbi | 1 | Column |
| urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Geographic_Measures,PROD) | Geographic Measures | powerbi | 1 | Column |
| urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.ORDER_DETAILS,PROD) | ORDER_DETAILS | powerbi | 1 | Column |
| urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Product_Perfromance_Measures,PROD) | Product Perfromance Measures | powerbi | 1 | Column |
| urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Time_Inteligence_Measures,PROD) | Time Inteligence Measures | powerbi | 1 | Column |
| urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details_replica,PROD) | ORDER_DETAILS_REPLICA | snowflake | 1 | Column |
| urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_history,PROD) | ORDER_HISTORY | snowflake | 1 | Column |
| urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.37fcfb15-34ae-973a-5ae3-cf63691d48e3,PROD) | Custom SQL Query | tableau | 1 | Table |
| urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.4a3af1dd-fd0c-7077-d5fd-aa2fdf87cb23,PROD) | Custom SQL Query | tableau | 1 | Table |
| urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.8bfe7483-1c9a-a0e1-ec84-57207dd37a15,PROD) | Custom SQL Query | tableau | 1 | Table |
| urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.b980a8c5-28eb-119e-f6ca-4da32732e5be,PROD) | Promotions | tableau | 2 | Table |
| urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.c067553a-127e-a871-14a0-5f32cb032c78,PROD) | Order Mode | tableau | 2 | Table |
| urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.f32082e5-06b8-f46e-9047-4611fffe66b0,PROD) | Custom SQL Query | tableau | 1 | Table |
| urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.f8fb6a0b-7be6-690b-cc45-3c6e0fd2bcde,PROD) | Orders By Day | tableau | 2 | Table |
| urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.fadbf744-48be-0929-a47c-5786327a3343,PROD) | Top Product Category | tableau | 2 | Table |

## Deterministic Impact Assessment

| Score | Risk level | Confidence |
| --- | --- | --- |
| 90 | critical | medium |

| Factor            | Points | Explanation                                          |
| ----------------- | -----: | ---------------------------------------------------- |
| Rename severity   |     25 | A column rename is a breaking schema change.         |
| Downstream assets |     30 | 24 downstream assets are visible.                    |
| Lineage depth     |     10 | The deepest visible dependency is 2 hops away.       |
| Confirmed columns |     20 | 11 downstream assets have column-level evidence.     |
| Metadata gap      |      5 | Some downstream column relationships remain unknown. |

## Facts

- Selected dataset urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD) was returned by DataHub.
- Source column customer_id is present in schema for urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD).
- Downstream asset urn:li:chart:(powerbi,b2fd91.pages.66666666-7777-8888-9999-000000000000.217abe0d5c1cd421c384) was returned at hop 2.
- Downstream asset urn:li:chart:(powerbi,b2fd91.pages.66666666-7777-8888-9999-000000000000.3f48c0bf859b2d14dcd0) was returned at hop 2.
- Downstream asset urn:li:chart:(powerbi,b2fd91.pages.66666666-7777-8888-9999-000000000000.83a9aaa3207edd6c721e) was returned at hop 2.
- Downstream asset urn:li:chart:(powerbi,b2fd91.pages.66666666-7777-8888-9999-000000000000.85e432543b30346a0507) was returned at hop 2.
- Downstream asset urn:li:dashboard:(powerbi,b2fd91.reports.66666666-7777-8888-9999-000000000000) was returned at hop 2.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:dbt,b2fd91.ORDER_ENTRY_DB.analytics.order_history,PROD) was returned at hop 1.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:looker,b2fd91.order-entry-looker.view.order_details,PROD) was returned at hop 1.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:looker,b2fd91.order-entry.explore.order_details,PROD) was returned at hop 2.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Customer_Analytics_Measures,PROD) was returned at hop 1.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Essential_KPI_Measures,PROD) was returned at hop 1.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Geographic_Measures,PROD) was returned at hop 1.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.ORDER_DETAILS,PROD) was returned at hop 1.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Product_Perfromance_Measures,PROD) was returned at hop 1.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Time_Inteligence_Measures,PROD) was returned at hop 1.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details_replica,PROD) was returned at hop 1.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_history,PROD) was returned at hop 1.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.37fcfb15-34ae-973a-5ae3-cf63691d48e3,PROD) was returned at hop 1.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.4a3af1dd-fd0c-7077-d5fd-aa2fdf87cb23,PROD) was returned at hop 1.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.8bfe7483-1c9a-a0e1-ec84-57207dd37a15,PROD) was returned at hop 1.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.b980a8c5-28eb-119e-f6ca-4da32732e5be,PROD) was returned at hop 2.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.c067553a-127e-a871-14a0-5f32cb032c78,PROD) was returned at hop 2.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.f32082e5-06b8-f46e-9047-4611fffe66b0,PROD) was returned at hop 1.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.f8fb6a0b-7be6-690b-cc45-3c6e0fd2bcde,PROD) was returned at hop 2.
- Downstream asset urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.fadbf744-48be-0929-a47c-5786327a3343,PROD) was returned at hop 2.
- Column-level lineage links customer_id to downstream asset urn:li:dataset:(urn:li:dataPlatform:dbt,b2fd91.ORDER_ENTRY_DB.analytics.order_history,PROD).
- Column-level lineage links customer_id to downstream asset urn:li:dataset:(urn:li:dataPlatform:looker,b2fd91.order-entry-looker.view.order_details,PROD).
- Column-level lineage links customer_id to downstream asset urn:li:dataset:(urn:li:dataPlatform:looker,b2fd91.order-entry.explore.order_details,PROD).
- Column-level lineage links customer_id to downstream asset urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Customer_Analytics_Measures,PROD).
- Column-level lineage links customer_id to downstream asset urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Essential_KPI_Measures,PROD).
- Column-level lineage links customer_id to downstream asset urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Geographic_Measures,PROD).
- Column-level lineage links customer_id to downstream asset urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.ORDER_DETAILS,PROD).
- Column-level lineage links customer_id to downstream asset urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Product_Perfromance_Measures,PROD).
- Column-level lineage links customer_id to downstream asset urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Time_Inteligence_Measures,PROD).
- Column-level lineage links customer_id to downstream asset urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details_replica,PROD).
- Column-level lineage links customer_id to downstream asset urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_history,PROD).

## Assumptions

- Dataset resolution required one exact URN, name, or platform-qualified name match.
- Downstream lineage inspection was bounded to two hops.

## Unknowns

- Column-level impact remains unknown for some table-level downstream assets.
- Selected dataset platform metadata was not available.
- Selected dataset environment metadata was not available.

## DataHub Tool Trace

| Call ID | Tool | Status | Arguments |
| --- | --- | --- | --- |
| mcp-001 | search | ok | {"filter":"entity_type = dataset","num_results":50,"offset":0,"query":"/q snowflake+b2fd91+order_entry_db+analytics+order_details"} |
| mcp-002 | list_schema_fields | ok | {"limit":100,"offset":0,"urn":"urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)"} |
| mcp-003 | get_lineage | ok | {"column":null,"max_hops":2,"max_results":100,"offset":0,"upstream":false,"urn":"urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)"} |
| mcp-004 | get_lineage | ok | {"column":"customer_id","max_hops":2,"max_results":100,"offset":0,"upstream":false,"urn":"urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)"} |

## Final Status

COMPLETED
