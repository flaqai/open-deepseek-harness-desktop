---
kind: upgrade-guide
description: Settings navigation saves a version-2 layout that older clients cannot read.
---

# Settings navigation layout

English | [中文](guide.zh.md)

## Change

The `ui-settings-general.sectionLayout` preference changes from version 1 grouped entries to version 2 ordered independent entries and groups. Older clients cannot read version 2. Session history, plugin activation and credentials are unchanged.

## Migration

1. Back up the Profile configuration before editing navigation with the new client. Existing version-1 values are read without being overwritten; ungrouped entries expand at their original position and collapsed members are retained.
2. Arrange settings normally. The first successful layout save writes version 2. Confirm that independent entries and custom groups remain in the expected order, including hidden-entry recovery.
3. To return to an older client, restore the backed-up `sectionLayout` value. Do not pass version-2 preferences to an older client or remove plugin configuration to repair navigation.
