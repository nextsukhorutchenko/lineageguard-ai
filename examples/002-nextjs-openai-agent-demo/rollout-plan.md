# Rollout Plan

**Classification:** NON_EXECUTABLE_TEMPLATE

**DataHub dataset:** ` ORDER_DETAILS `

**Decision:** BLOCK_DIRECT_RENAME

**Evidence:** ` datahub:target-dataset `, ` datahub:source-column:customer_id `, ` datahub:downstream:001 `, ` datahub:downstream:002 `, ` datahub:downstream:003 `, ` datahub:downstream:004 `, ` datahub:downstream:005 `, ` datahub:downstream:006 `, ` datahub:downstream:007 `, ` datahub:downstream:008 `, ` datahub:downstream:009 `, ` datahub:downstream:010 `, ` datahub:downstream:011 `, ` datahub:downstream:012 `, ` datahub:downstream:013 `, ` datahub:downstream:014 `, ` datahub:downstream:015 `, ` datahub:downstream:016 `, ` datahub:downstream:017 `, ` datahub:downstream:018 `, ` datahub:downstream:019 `, ` datahub:downstream:020 `, ` datahub:downstream:021 `, ` datahub:downstream:022 `, ` datahub:downstream:023 `, ` datahub:downstream:024 `

## PR Review Summary

- DataHub decision: BLOCK_DIRECT_RENAME.
- Impact scope: 24 visible downstream assets.
- Package state: the physical Snowflake name is unconfirmed, so no SQL is executable.

## Reviewer Gates

- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:chart:(powerbi,b2fd91.pages.66666666-7777-8888-9999-000000000000.217abe0d5c1cd421c384) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:chart:(powerbi,b2fd91.pages.66666666-7777-8888-9999-000000000000.3f48c0bf859b2d14dcd0) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:chart:(powerbi,b2fd91.pages.66666666-7777-8888-9999-000000000000.83a9aaa3207edd6c721e) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:chart:(powerbi,b2fd91.pages.66666666-7777-8888-9999-000000000000.85e432543b30346a0507) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dashboard:(powerbi,b2fd91.reports.66666666-7777-8888-9999-000000000000) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:dbt,b2fd91.ORDER_ENTRY_DB.analytics.order_history,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:looker,b2fd91.order-entry-looker.view.order_details,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:looker,b2fd91.order-entry.explore.order_details,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Customer_Analytics_Measures,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Essential_KPI_Measures,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Geographic_Measures,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.ORDER_DETAILS,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Product_Perfromance_Measures,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:powerbi,b2fd91.datahub_order_entries.Time_Inteligence_Measures,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details_replica,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_history,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.37fcfb15-34ae-973a-5ae3-cf63691d48e3,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.4a3af1dd-fd0c-7077-d5fd-aa2fdf87cb23,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.8bfe7483-1c9a-a0e1-ec84-57207dd37a15,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.b980a8c5-28eb-119e-f6ca-4da32732e5be,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.c067553a-127e-a871-14a0-5f32cb032c78,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.f32082e5-06b8-f46e-9047-4611fffe66b0,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.f8fb6a0b-7be6-690b-cc45-3c6e0fd2bcde,PROD) `; DataHub returned no owner.
- [ ] Assign or confirm an owner for inspected downstream asset ` urn:li:dataset:(urn:li:dataPlatform:tableau,b2fd91.fadbf744-48be-0929-a47c-5786327a3343,PROD) `; DataHub returned no owner.

1. Confirm the physical Snowflake `DATABASE.SCHEMA.TABLE`.
2. Preserve ` customer_id ` and add ` customer_key `.
3. Backfill and validate the target column.
4. Coordinate the 24 visible downstream assets.
5. Migrate readers and writers before retiring the source column.
6. Require human approval before every breaking step.
7. Trigger rollback on mismatched values, unexpected nulls, or downstream errors.
8. Complete only after validation passes, all ownership gaps are resolved, and required approvals are recorded.
