# Issue Tracker: GitHub

Issues and PRDs for this repository live as GitHub Issues. Use the `gh` CLI for all operations.

## Prerequisites

- The local repository must have a GitHub remote.
- The `gh` CLI must be installed and authenticated.
- Infer the repository from `git remote -v`.

## Conventions

- Create an issue: `gh issue create --title "..." --body "..."`
- Read an issue: `gh issue view <number> --comments`
- List issues: `gh issue list --state open`
- Comment on an issue: `gh issue comment <number> --body "..."`
- Add a label: `gh issue edit <number> --add-label "..."`
- Remove a label: `gh issue edit <number> --remove-label "..."`
- Close an issue: `gh issue close <number> --comment "..."`

## Skill Instructions

When a skill says "publish to the issue tracker", create a GitHub issue.

When a skill says "fetch the relevant ticket", run:

`gh issue view <number> --comments`
