# Advisory PR Impact Reporting

## Purpose

The PR impact layer explains which stable browser areas and scenario tags a pull request may
affect. It is advisory only: the complete Chromium suite always runs, and the report cannot select
tests or change Playwright's status.

## Local Workflow

On a pull-request checkout, set `GITHUB_EVENT_NAME`, `LINEAGEGUARD_PR_BASE_SHA`, and
`LINEAGEGUARD_PR_HEAD_SHA`, then run `pnpm prepare:pr-impact`. The command reads only filenames
from a bounded local Git comparison and writes `.tmp/pr-impact/context.json`.

The Playwright reporter writes the completed report to:

- `test-results/pr-impact/report.json`
- `test-results/pr-impact/report.md`

At the end of a new run, the reporter removes only its fixed stale generated directory and then
publishes the new final directory atomically. If that final path reappears during publication, the
write fails closed rather than mixing runs.

## Reason Codes

- `CRITICAL_TOOLING_CHANGE`: repository authority, CI, or toolchain files changed.
- `EMPTY_CHANGE_SET`: the comparison returned no filenames.
- `GIT_COMPARISON_UNAVAILABLE`: refs, Git execution, or comparison output was unavailable.
- `IMPACT_INPUT_INVALID`: a changed path was unsafe or malformed.
- `IMPACT_INPUT_LIMIT_REACHED`: a path count or byte limit was exceeded.
- `NON_PULL_REQUEST`: no pull-request comparison applies.
- `UNMAPPED_PATH`: at least one path has no approved mapping.

Unknown, invalid, empty, unavailable, or unmapped input produces `FULL_SUITE_REQUIRED`. This is
guidance only because the full suite is mandatory in every case.

## Limits and Safety

Input is limited to 2,000 repository-relative paths, 512 UTF-8 bytes per path, and 256 KiB in
aggregate. JSON output is limited to 256 KiB and Markdown to 32 KiB. Reports contain only
normalized paths, allowlisted identifiers, stable tags, fixed reason codes, and aggregate counts.
They never contain changed-file contents, raw errors, stacks, output streams, attachments,
credentials, provider traces, or native paths.

Only pull-request CI runs append the validated Markdown to `GITHUB_STEP_SUMMARY`. The workflow
does not create PR comments, Check Runs, labels, or other GitHub state; it does not call GitHub
APIs or request write permissions. Missing reports are skipped, while rejected inputs and writes
use fixed unavailable messages.
