---
description: "Carries Playwright and DevTools connectors; selecting this bundle enables Playwright with a local browser."
kind: "package-bundle"
---

# @deepseek-ai/dsh-browser-use-bundle

English | [中文](README.zh.md)

## Summary

Carries Playwright and DevTools connectors; selecting this bundle enables Playwright with a local browser. It is shipped but never selected by a default CLI profile. Desktop capability controls select one provider through their existing candidate transaction.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Add this optional bundle to a custom Profile to opt in. Desktop uses Tools & capabilities to configure providers instead; do not combine that configuration with this bundle. Preinstallation alone does not start an MCP process or enable native Computer Use.

## Understand the implementation

[`cordis.patch.yml`](cordis.patch.yml) selects the provider. Declared dependencies carry its offline closure. The Desktop startup candidate may select Playwright once when a local Chrome or Chromium is available; existing choices remain intact.

## Further Exploration

- [Provider](../browser-use-playwright-mcp/README.md)
- [Provider](../browser-use-chrome-devtools-mcp/README.md)

## Model Experience

### Selected provider contributions

#### What the model sees

Selecting the bundle exposes the [Playwright provider](../browser-use-playwright-mcp/README.md#model-experience) browser tools named `mcp__playwright-mcp__<tool>` and admitted screenshots. DevTools is delivered but is not mounted by this patch. Neither provider is mounted by a default CLI template.

#### Token effect

The selected provider owns its tool definitions, guidance, and results. Their tokens are added only while that provider is mounted or its calls contribute results.

#### KV Cache effect

Provider selection or removal changes the tool and guidance prefix. Keeping the same provider leaves that prefix stable; tool results append to history.

## Known Limitations and Deferred Work

- Browser modes require an installed Chrome or Chromium. Native Computer Use requires supported platform resources and system permissions.
- Final offline installers need platform-specific packaging acceptance; unit tests do not substitute for it.

### Dev Note

This layer preserves the optional bundle installation boundary; it does not promote experimental providers to default product services.
