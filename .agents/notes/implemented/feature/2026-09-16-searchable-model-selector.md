# Agent Note: Searchable model selector

Status: implemented

English | [中文](2026-09-16-searchable-model-selector.zh.md)

## Problem

The model selector can contain many providers and models, making visual scanning slow and making similarly named entries difficult to distinguish. Provider grouping alone does not help a user who knows part of the model or provider name.

## Decision

The open selector presents one search field above its model list. Matching is case-insensitive across model names, model identifiers, provider display names, and provider identifiers. Filtering preserves provider grouping and the existing selection; an empty result remains inside the selector with localized guidance, and closing the selector clears the transient query.

The search field receives focus when the selector opens. Keyboard and pointer selection continue to use the existing model rows, and the search control does not change catalog ordering, model identity, or selection persistence.

## Alternatives considered

**Search only model display names.** Rejected because custom providers often expose opaque model identifiers, while users may remember the provider or identifier rather than the display label.

**Persist the query between openings.** Rejected because the query is navigation state for one selection operation, not a model preference; reopening should show the complete catalog.

## Consequences

Large catalogs become directly searchable without changing their source or order. The selector gains localized placeholder and empty-state strings in every shipped community locale, plus component coverage for matching, empty results, clearing, and selection from a filtered list.
