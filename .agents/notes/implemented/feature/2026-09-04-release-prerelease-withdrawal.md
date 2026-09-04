# Agent Note: Release prerelease withdrawal

Status: implemented

English | [中文](2026-09-04-release-prerelease-withdrawal.zh.md)

## Problem

The desktop updater previously accepted GitHub Releases marked as prereleases whenever the installed client version contained an alpha or release-candidate suffix. Changing a faulty Release from Latest to prerelease therefore did not stop affected clients from discovering and downloading it.

## Decision

The GitHub `prerelease` field is an unconditional publication control for in-app updates. Drafts and prereleases are excluded for every installed channel. Semantic prerelease tags remain valid for prerelease clients only when their GitHub Release remains published without the prerelease flag. Starting a download refreshes discovery first, and the tag metadata request rejects a Release changed to draft or prerelease between discovery and asset resolution.

This lets a maintainer withdraw a faulty update by changing its GitHub Release to prerelease without deleting the tag or assets. The next six-hour background refresh or a manual check removes that version from discovery, while a download attempt does not trust stale visible state.

## Alternatives considered

Using GitHub's `/releases/latest` endpoint would also exclude prereleases, but it exposes only one candidate and prevents semantic selection across the accepted community and legacy tag prefixes. Adding a separate withdrawal manifest would offer more states but would add another hosted availability dependency for a binary safety control that GitHub already provides.

## Consequences

An alpha or release-candidate build intended for in-app distribution must be published as a normal GitHub Release even though its tag contains a semantic prerelease suffix. GitHub Releases intentionally marked pre-release remain available for manual testers but never appear in the desktop updater.
