# Agent Note: Upstream ancestry and functional integration

Status: implemented

English | [中文](2026-10-27-upstream-history-alignment.zh.md)

## Problem

GitHub compares the fork's default branch with upstream master, while community releases integrate fixed official tags. Pushing a release or fix branch alone leaves the default-branch comparison stale. Recording ancestry without importing source also changes Git's inferred merge base and can conceal pending functional changes from a later ordinary merge.

## Decision

The [integration record](../../../upstream-integration.json) distinguishes the reviewed official tag from the upstream master revision acknowledged only for history. The latter is the numbered parent of the merge identified by its exact `mergeSubject`, not the moving upstream ref. The functional baseline advances only after source integration and validation. A user-authorized history alignment uses an `ours` merge and verifies identical tree IDs immediately before and after that merge; it changes ancestry without claiming functional integration.

Major upstream-version pushes fetch both remotes, compare `origin/master...upstream/master` using `git rev-list --left-right --count`, and inspect missing commits before choosing content integration or authorized history alignment. After pushing master, re-read its remote SHA and compare again. Report the remaining behind count and the actual functional baseline separately; a release-branch push alone does not complete this check.

When history alignment extends past the functional baseline, the next source integration compares the complete delta from the resolved `functionalBaseline.ref` to its fixed target. Git's automatic merge base is insufficient. An explicit-base `git merge-tree --write-tree --merge-base=<functional-baseline> HEAD <target>` retains the skipped delta for conflict review. The integration record updates alongside the resulting source changes.

## Alternatives considered

**Automatically merge latest upstream content to clear the count.** Rejected because the requested ancestry repair preserves community source and does not authorize adopting unreviewed upstream features.

**Record ancestry without retaining the functional baseline.** Rejected because later merges could silently omit changes acknowledged only for history.

## Consequences

A zero behind count establishes ancestry, not feature parity. History alignment requires explicit-base source review for the next upstream integration. Tree-identity verification covers the history-only merge, not earlier intentional fixes in the same push. Published tags and artifacts remain unchanged.
