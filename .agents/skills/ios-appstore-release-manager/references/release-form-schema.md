# Release Form Schema

## Source of Truth

Release data lives at:

```text
<repo>/docs/app-store-connect/releases/
├── index.md
├── _template.md
└── <version>.md
```

Complete release copy belongs in project forms, not in the global Skill.

## Schema Versions

- Schema 1 is retained for historical 12-language forms.
- Schema 2 is retained for historical forms that localized promotional text and What's New.
- Schema 3 is retained for historical forms that preserved descriptions for existing localizations.
- Schema 4 is retained for historical forms that always used simplified Chinese as their translation source.
- Schema 5 is retained for historical forms that added a configurable translation source but always replaced localized descriptions.
- Schema 6 is retained for historical forms that always prepared every selector language.
- Schema 7 is retained for historical forms that added current-session browser capability and localization-scope gates.
- Schema 8 is required for new forms. It adds Flutter/native Xcode project identity and version provenance while retaining all schema 7 approval, scope, conflict, readback, and submission boundaries.

## Schema 8 Frontmatter

Every new version file requires:

| Field | Example | Meaning |
| --- | --- | --- |
| `schema_version` | `8` | Current form schema. |
| `app_version` | `1.8.0` | App Store marketing version. |
| `build_number` | `296` | Apple build number. |
| `previous_version` | `1.6.0` | Inheritance source. |
| `source_commit` | Git SHA or `not_recorded` | Source snapshot. |
| `project_type` | `flutter`, `xcode`, or `unknown` | Detected project type; `unknown` is allowed only with an explicit version/build in a repository without either project marker. |
| `version_source` | `pubspec.yaml`, `xcodebuild`, or `explicit` | Version/build provenance. |
| `xcode_container` | `App.xcworkspace` or `none` | Repository-relative Xcode container. |
| `xcode_scheme` | `App` or `none` | Selected shared scheme. |
| `xcode_configuration` | `Release` | Build-settings configuration. |
| `form_status` | `draft` | Draft, ready-to-fill, or historical state. |
| `source_locale` | `zh-Hans` or `en-US` | User-selected source language; defaults to simplified Chinese. |
| `source_locale_label` | `简体中文` or `英语（美国）` | Human-readable source-language label. |
| `promotional_text_status` | `pending_approval` | Source-language promotional-text gate. |
| `keywords_status` | `pending_approval` | Source-language keywords gate. |
| `whats_new_status` | `pending_approval` | Source-language What's New gate. |
| `description_status` | `pending_approval` | Source-language description gate. |
| `source_copy_status` | `pending_approval` | Aggregate gate; approved only when all four statuses are approved. |
| `localization_status` | `blocked_until_scope_and_source_copy_approved` | Scope and translation completeness. |
| `description_policy` | `translate_selected_scope_then_compare_existing` | Translates the confirmed scope, then compares with page content. |
| `existing_content_policy` | `ask_user_on_difference` | Prohibits silent inheritance or replacement. |
| `computer_use_availability` | `pending_check` | Current-run Computer Use check; later `available`, `unavailable_fallback_browser`, or `unavailable_blocked`. |
| `unlocalized_locale_policy` | `pending_user_choice` | Later `exclude_after_user_confirmation` or `include_after_user_confirmation`. |
| `build_processing_status` | `processed` | Apple build processing state. |
| `build_binding_status` | `bound` | Version/build association. |
| `review_status` | `not_added_for_review` | Submission boundary. |
| `localization_scope` | `pending_user_choice` | Later `app_store_connect_localized_languages` or `app_store_connect_all_languages`. |
| `locale_inventory_source` | `app_store_connect_ui` | Browser UI produced the inventory. |
| `locale_inventory` | `en-US,ar-SA,...` | Union of localized and unlocalized locale IDs. |

The validator rejects a schema 8 form marked `ready-to-fill` unless its project identity is valid, `source_locale` is declared in `locale_inventory`, all four source-copy statuses plus `source_copy_status` are `approved`, Computer Use availability is checked, and the unlocalized-language scope is explicitly confirmed. Page strategies may remain pending until browser comparison begins. When `localization_status` becomes `saved_and_read_back`, no in-scope page strategy may remain pending.

For native projects, the generator uses `xcodebuild -list -json` and `xcodebuild -showBuildSettings -json`. Multiple containers or schemes are errors until the caller supplies an explicit selection. `--version` and `--build` must be supplied together and take precedence over project-derived values. Existing schema 1–7 forms are validated in place and are never migrated automatically.

## Locales

At the start of every browser filling run:

1. Read both localized and unlocalized groups in App Store Connect.
2. Store their union in `locale_inventory`.
3. Mark each locale's `App Store Connect 清单状态` accurately.
4. Check whether `computer-use:computer-use` is available in the current run, report the result, and record `computer_use_availability`.
5. Show both group counts and ask whether to translate and create the unlocalized languages. Record the answer in `unlocalized_locale_policy` and `localization_scope`; do not infer it from an earlier release.
6. Confirm the source locale. The source locale section copies the approved source fields verbatim; all other in-scope locales are translated directly from it.
7. Prepare all four fields for every in-scope locale. For excluded unlocalized locales, set locale status `not_requested_by_user`, all four page strategies to `not_in_scope`, and retain `TODO_AFTER_SCOPE_CHOICE` instead of generating public copy.
8. Before editing, compare each current in-scope page field with its prepared value:
   - empty page value → `use_translation_page_was_empty`;
   - equal normalized value → `matches_translation`;
   - differing non-empty value and user chooses replacement → `replace_after_user_confirmation`;
   - differing non-empty value and user chooses inheritance → `inherit_after_user_confirmation`.
9. Save and read back description, promotional text, keywords, and What's New according to the recorded strategies.

The website is authoritative. The script's 50-language snapshot is only the checked baseline for generating a draft.

Precede each locale heading with `<!-- locale:<id> -->`. Every in-scope schema 8 locale section requires exactly one of each:

```text
- App Store Connect 清单状态：`localized`
- 状态：`pending_translation_after_source_approval`
- 描述页面策略：`pending_page_comparison`
- 描述：`TODO_AFTER_SOURCE_APPROVAL`
- 推广文本页面策略：`pending_page_comparison`
- 推广文本：`TODO_AFTER_SOURCE_APPROVAL`
- 关键词页面策略：`pending_page_comparison`
- 关键词：`TODO_AFTER_SOURCE_APPROVAL`
- 此版本的新增内容页面策略：`pending_page_comparison`
- 此版本的新增内容：`TODO_AFTER_SOURCE_APPROVAL`
```

For an unlocalized language that must be created:

```text
- App Store Connect 清单状态：`unlocalized_add_required`
- 描述页面策略：`pending_page_comparison`
- 描述：`TODO_AFTER_SOURCE_APPROVAL`
```

For an unlocalized language excluded by the user:

```text
- App Store Connect 清单状态：`unlocalized_add_required`
- 状态：`not_requested_by_user`
- 描述页面策略：`not_in_scope`
- 描述：`TODO_AFTER_SCOPE_CHOICE`
- 推广文本页面策略：`not_in_scope`
- 推广文本：`TODO_AFTER_SCOPE_CHOICE`
- 关键词页面策略：`not_in_scope`
- 关键词：`TODO_AFTER_SCOPE_CHOICE`
- 此版本的新增内容页面策略：`not_in_scope`
- 此版本的新增内容：`TODO_AFTER_SCOPE_CHOICE`
```

## Character and Keyword Rules

Count Unicode code points for text fields, including spaces and punctuation. Count the complete Keywords value as UTF-8 bytes, including commas. In Markdown locale values, `<br>` represents one newline when counting.

| 中文字段名 | App Store Connect field | Maximum |
| --- | --- | ---: |
| 推广文本 | Promotional Text | 170 |
| 描述 | Description | 4,000 |
| 此版本的新增内容 | What's New | 4,000 |
| 关键词 | Keywords | 100 UTF-8 bytes |
| 支持网址 | Support URL | 255 |
| 营销网址 | Marketing URL | 255 |

New schema 8 localized keywords must:

- use ASCII commas as separators;
- contain no leading, trailing, or repeated commas;
- contain no empty term;
- contain no case-insensitive duplicate term;
- contain only terms longer than two characters;
- contain no line break, full-width comma, ideographic comma, or semicolon;
- remain at or below 100 UTF-8 bytes.

Schema 1–7 records retain their historical minimum-term behavior while still receiving the existing separator, duplicate, and total-byte checks; validation never rewrites them.

## Source Copy and Description Translation

For schema 8, `description_policy` must be `translate_selected_scope_then_compare_existing`; `existing_content_policy` must be `ask_user_on_difference`.

- Generate locale translations with the active language model by default. The workflow must remain usable without network access or an external translation API. A third-party translation service may be used only when the user explicitly requests it.
- Every in-scope locale is translated directly from `source_locale`; do not use another locale as an intermediate translation source.
- `source_locale` may be any locale listed in `locale_inventory`. The generator validates it against the current App Store Connect baseline and defaults to `zh-Hans` only when omitted.
- The four source blocks contain the approved copy in `source_locale`; their Markdown headings remain the stable Chinese field labels used by the form schema.
- The source locale section must exactly equal the four approved source blocks after Markdown newline normalization. Every other locale is translated directly from that source.
- Every in-scope locale contains all four prepared values plus four independent page strategies. The page strategy controls writing; it does not remove the prepared translation.
- A differing non-empty page value requires showing the locale, field, existing value, and prepared translation to the user before recording either confirmation strategy.
- `inherit_after_user_confirmation` keeps the existing page field; `replace_after_user_confirmation` writes the prepared translation. Both require save/readback verification.
- An unlocalized locale cannot inherit a nonexistent field; `inherit_after_user_confirmation` is invalid while its inventory state remains `unlocalized_add_required`.
- Excluded unlocalized locales remain untranslated and are not created in App Store Connect.
- Schema 1–7 historical forms retain their original behavior. Do not silently migrate an already-filled historical form.

## Inheritance and Safety

- Description, promotional text, keywords, and What's New are translated from the selected source locale for the user-confirmed scope every release. Each in-scope page field is then either written or explicitly inherited according to its recorded comparison strategy.
- Support URL, marketing URL, copyright, screenshots, previews, and review notes inherit unless separately authorized.
- `REUSE_EXISTING_ASC_SAVED_INFORMATION` protects sensitive values.
- Placeholders are allowed only in drafts, except `TODO_AFTER_SCOPE_CHOICE` in schema 8 locales explicitly excluded by the user. A `ready-to-fill` form must contain final public copy for every in-scope locale.
- Never click Add for Review or Submit for Review as part of the default workflow.
