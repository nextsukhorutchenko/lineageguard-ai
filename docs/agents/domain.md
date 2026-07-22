# Domain Docs

This repository uses a single-context domain documentation layout.

## Before Exploring or Changing the Codebase

Read the following when they exist:

- `CONTEXT.md` at the repository root
- Relevant architectural decision records under `docs/adr/`

If these files do not exist, proceed without treating their absence as a blocker. They are created when domain terminology or architectural decisions need to be recorded.

## Domain Vocabulary

Use terms exactly as defined in `CONTEXT.md` when naming domain concepts, issues, tests, modules, and architectural proposals.

If a required concept is missing, note it as a documentation gap instead of silently introducing competing terminology.

## Architectural Decisions

If proposed work conflicts with an existing ADR, surface the conflict explicitly. Do not silently override an accepted architectural decision.
