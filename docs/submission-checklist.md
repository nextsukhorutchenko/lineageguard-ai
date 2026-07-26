# Hackathon Submission Checklist

All checkboxes below are manual submission gates and remain unchecked until a person verifies the
named evidence or completes the external account action.

## Dates and freeze

- [ ] Confirm the submission deadline:
      `August 10, 2026 at 5:00 PM EDT / August 11, 2026 at 12:00 AM Europe/Kyiv`.
- [ ] Confirm free judging access through:
      `August 31, 2026 at 5:00 PM EDT / September 1, 2026 at 12:00 AM Europe/Kyiv`.
- [ ] Record an immutable submission commit or tag after every repository gate passes.

## Public Apache-2.0 repository

- [ ] Publish and verify the **Public repository URL**.
- [ ] Verify Devpost detects the repository's **Apache License 2.0**.
- [ ] Configure GitHub About only as a manual external action using the repository owner's account.

## New-project and pre-existing software disclosure

- [ ] State that LineageGuard AI is the new hackathon project.
- [ ] Complete the **Pre-existing software disclosure** for the deterministic impact-analysis slice
      and clearly identify the browser/agent/submission work added for the event.

## Third-party and AI tools disclosure

- [ ] Complete the third-party dependency and **AI tools disclosure** using
      `docs/resources-and-attribution.md`.
- [ ] Verify the completed **Dataset provenance** row, actual License or terms, and lawful
      **Redistribution permission** review.
- [ ] Verify third-party music, image, font, logo, and trademark permissions for every published
      submission asset.

## Free judging access

- [ ] Provide an easy-access **Project URL** that points judges to the no-key Fixture replay/test
      build path and remains free through the judging-access end.
- [ ] Verify the Project URL does not require DataHub, OpenAI, personal credentials, or a paid
      account.

## Devpost project copy and category

- [ ] Select **Metadata-Aware Code Generation & Development**.
- [ ] Copy the concise project description, disclosures, links, and judging evidence into Devpost.
- [ ] Include the DataHub Community tag `#agent-hackathon` where the current rules request it.
- [ ] Submit Devpost only as a manual external account action.

## Sub-three-minute public video

- [ ] Record the seven-beat script in `docs/demo-scenario.md` at no more than 2:55.
- [ ] Publish through **YouTube** as the recommended public host, or another host explicitly allowed
      by the current rules.
- [ ] Verify public/unlisted judging access, captions, audio permissions, and duration.
- [ ] Treat video publication as a manual external account action.

## Screenshots and thumbnail

- [ ] Capture a legible thumbnail and screenshots without credentials, native paths, private
      profiles, or raw traces.
- [ ] Verify the visuals distinguish LIVE/REPLAY and do not imply an unperformed live check.

## Sample outputs

- [ ] Review `examples/002-nextjs-openai-agent-demo/README.md` and the four allowlisted public
      artifacts.
- [ ] Confirm the sample remains `NON_EXECUTABLE_TEMPLATE`, cites 24/11/90 and
      `BLOCK_DIRECT_RENAME`, and contains no private run-envelope fields.

## Live and replay verification

- [ ] **Live operator preflight**: verify GMS health using the
      [GMS health row](live-verification.md#gms-health).
- [ ] Open the DataHub UI at `http://localhost:9002`; visibly locate `order_details`, confirm
      `customer_id`, **visible lineage**, and **ownership** using the
      [DataHub UI row](live-verification.md#datahub-ui-asset-schema-lineage-owners).
- [ ] Run `pnpm test:integration` using the pinned read-only contract and record only sanitized
      evidence in the
      [MCP row](live-verification.md#pinned-read-only-mcp-integration-contract).
- [ ] Run the opt-in live provider check only after the earlier live gates and record it in the
      [OpenAI row](live-verification.md#openai-live-smoke-and-validated-package).
- [ ] In replay, show **Runtime proof** as replay evidence and the exact
      `analyze_rename_change` and `generate_migration_package` application tools.
- [ ] Show the literal boundary **Mutations are disabled** and confirm no SQL execution.
- [ ] Verify `docs/live-verification.md` remains truthful: live-only boxes stay unchecked unless
      their matching row is `PASSED`.

## Secret and personal-data scan

- [ ] Run `pnpm security:scan` over tracked and not-ignored untracked files.
- [ ] Run `pnpm security:scan:history` over the working tree and reachable repository history.
- [ ] Confirm the final public artifacts contain no credentials, personal data, private traces, or
      unrestricted native paths.

## Optional DataHub Community Slack outreach and Devpost feedback survey

- [ ] Optionally join or post to DataHub Community Slack using the owner's account; this is not a
      submission requirement and is not evidence of a contribution.
- [ ] Optionally complete the Devpost feedback survey using the owner's account.

## Post-deadline submission freeze

Submission must not be changed after the deadline unless the Sponsor or Devpost explicitly permits
a narrow correction.

- [ ] Freeze the Devpost Submission, repository commit/tag, Project URL, and public video after the
      deadline.
- [ ] Keep later portfolio work separate from the frozen Submission.
- [ ] Open any upstream DataHub PR only after separate approval; it remains a manual external action
      and must not be described as completed here.
