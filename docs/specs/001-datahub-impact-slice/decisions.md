# Approved Decisions for 001 DataHub Impact Slice

**Date:** 2026-07-22

**Status:** Approved at the architecture level

## Delivery Architecture

- Use one TypeScript codebase managed by pnpm.
- Do not create a monorepo for the MVP.
- Deliver the first vertical slice through a CLI entrypoint.
- Keep domain logic, the DataHub adapter, impact and risk logic, and artifact writing behind independent module boundaries.
- Run the official Python DataHub MCP Server as a pinned `uvx` subprocess.
- Reuse the proven modules from the CLI when adding the Next.js UI.
- Store local run artifacts in the filesystem.

## Development Process

- Use SDD-lite for major features.
- Keep the project brief separate from feature specifications.
- Use one numbered specification directory per feature or vertical slice.
- Require user approval of `spec.md` before creating `plan.md`.
- Require user approval of the technical plan before implementation.
- Break implementation into small tasks with explicit verification commands.
- Use test-driven development for deterministic core domain logic.
- Do not mark work complete without running the relevant verification commands.

## Current Gate

The specification and `plan.md` are approved. Application implementation may proceed task-by-task under the approved plan.
