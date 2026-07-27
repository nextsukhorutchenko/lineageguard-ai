# Live Verification

- Overall status: `PASSED`
- Verified at: `2026-07-27T14:39:40Z`
- Commit: `47f9ce7acedaf0944f62b1aebfe826f4fcf2a6e0`
- DataHub account: `LOCAL QUICKSTART USER: datahub`
- Search visibility scope: `DEFAULT VIEW: enabled`

| Check                                     | Status   | Evidence                                                                           |
| ----------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| GMS health                                | `PASSED` | `HTTP 200 from localhost GMS health endpoint`                                      |
| DataHub UI asset, schema, lineage, owners | `PASSED` | `Snowflake order_details and customer_id schema lineage and owners visible`        |
| Pinned read-only MCP integration contract | `PASSED` | `pnpm test:integration 3 passed 1 optional skipped`                                |
| OpenAI live smoke and validated package   | `PASSED` | `pnpm test:openai 1 passed COMPLETED 24 downstream 11 column score 90 4 artifacts` |
