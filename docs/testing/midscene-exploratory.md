# Midscene Visual Exploration

## Purpose

The repository includes one local visual exploratory check using exactly `@midscene/web` 1.10.7.
It supplements deterministic Playwright assertions when a human wants a model-assisted opinion
about visual readability. Its result is non-authoritative and is never a substitute for mandatory
offline acceptance.

## Explicit Configuration

Run the workflow only with `LINEAGEGUARD_MIDSCENE_EXPLORATORY=1` and these preferred variables:

- `MIDSCENE_MODEL_BASE_URL`
- `MIDSCENE_MODEL_NAME`
- `MIDSCENE_MODEL_FAMILY`
- `MIDSCENE_MODEL_API_KEY`, except when the base URL is exactly `codex://app-server`

Set values in the current shell or another untracked secret store. Never place credentials in the
repository, screenshots, reports, logs, or command arguments.

## Running the Check

Run `pnpm test:exploratory`. The guarded runner passes only allowlisted operating-system values
and approved Midscene configuration to a separate Playwright process. Deterministic Playwright
actions navigate the REPLAY application and complete the supported workflow; Midscene performs
only one visual assertion.

The run is bounded to Chromium, one worker, zero retries, a 90-second test timeout, a 120-second
Playwright global timeout, a 180-second outer process deadline, a 60-second model timeout, zero
provider retries, and three replanning cycles.

## Isolation

Generated output stays under the ignored `.tmp/midscene/` root, including
`.tmp/midscene/run`. The exploratory command is excluded from `verify:offline`, ordinary tests,
and GitHub Actions. Reports are not uploaded, and the runner performs no GitHub operation.

Treat a successful visual exploration as advisory evidence only. Deterministic Playwright tests,
the approved specification, and the offline gate remain authoritative.
