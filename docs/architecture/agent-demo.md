# Agent Demo Architecture

## Run Storage Boundary

LineageGuard stores each terminal run as one immutable, versioned JSON envelope directly beneath
`LINEAGEGUARD_RUNS_DIR`. The configured root is a deployment trust boundary and must:

- already exist as a real directory;
- be owned by the application account;
- be writable by that account;
- be protected from untrusted writers by operating-system permissions; and
- contain no symbolic-link or Windows-junction path components.

The application validates this boundary before every storage operation and never creates the
configured root. It does not attempt to defend against another process that can rename or replace
the trusted root itself.

Run publication is create-only. The complete bounded envelope is written to an exclusive temporary
file in the root and synchronized before an atomic hard link publishes `run-<run-id>.json`.
Successful link creation is the publication linearization point. Readers accept only strict,
bounded, regular-file envelopes with valid hashes and cross-field invariants.

Artifact filenames are virtual application values. The legacy impact-analysis CLI exposes only
`impact-report.md`; the agent demo exposes only the four approved migration-package filenames.
Application responses, CLI output, activity data, errors, and downloads never return the native
runs root, temporary filenames, or final envelope paths.

The flat envelope format replaces the previous development-only nested layout. No migration is
required because that layout was never shipped as a supported storage format.
