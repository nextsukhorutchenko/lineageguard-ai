# Schema Change Impact Report

## Target

- Entity name:
- Full dataset URN:
- Platform and environment:

## Proposed Change

- Change kind: `rename_column`
- Source column:
- Target column:

## Facts

- List only validated DataHub facts and deterministic findings.
- Cite a full evidence URN for each material fact.

## Inferences

- Separate recommendations or interpretations from facts.
- State the evidence supporting each inference.

## Scope and Limitations

- Read boundary: two downstream hops.
- Collection bounds reached:
- Lower-bound labels:

## Evidence Completeness

| Dimension      | Complete | Pages | Unique items | Incomplete reason |
| -------------- | -------- | ----: | -----------: | ----------------- |
| Dataset search |          |       |              |                   |
| Schema         |          |       |              |                   |
| Table lineage  |          |       |              |                   |
| Column lineage |          |       |              |                   |

## Collected Impact

- Table-level downstream count:
- Column-confirmed downstream count:
- Deterministic score and level:
- Advisory decision:

## Context Coverage

- Relevant assets:
- Inspected assets:
- Retrieval coverage:
- Context Coverage:
- Missing metadata:
- Unknown metadata:

## Unknowns

- List ambiguous, incomplete, bounded, or uninspected evidence.
- Missing context does not prove low impact.

## Recommendation

- State a staged compatibility or non-executable recommendation consistent with deterministic
  policy.
- Do not include executable SQL.

## Human Approval Gates

- [ ] Dataset and source/target columns confirmed.
- [ ] Evidence completeness and lower bounds reviewed.
- [ ] Downstream owners and unknown ownership coordinated.
- [ ] Migration and rollback decisions receive human approval.

## Evidence URNs

Replace the example row with one row per cited entity. Every row must pair a human-readable entity
name with its full URN.

<!-- prettier-ignore -->
| Entity name | Evidence URN | Evidence kind |
| --- | --- | --- |
| _Human-readable entity name_ | `urn:li:<entity-type>:<identifier>` | _Target, schema, table lineage, column lineage, or context_ |
