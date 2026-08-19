---
name: ios-appstore-release-manager
description: Prepare, validate, localize, and safely fill App Store Connect release metadata from project Markdown forms. Use when creating a new iOS release form, drafting or translating descriptions, promotional text, localized keywords, and What's New, checking App Store character limits or model names, binding an uploaded build, or filling a release draft in an existing Chrome login session without submitting it for review.
---

# iOS App Store Release Manager

Keep release-specific data in the project's `docs/app-store-connect/releases/` directory. Keep this Skill limited to workflow, schema, and tooling.

Read [references/release-form-schema.md](references/release-form-schema.md) before creating, validating, translating, or filling a release. Read [references/aso-handoff-schema.md](references/aso-handoff-schema.md) before importing ASO copy. Read [references/release-version-table.md](references/release-version-table.md) when comparing existing versions or adding a new version row.

## Workflow

1. Locate the repository root and determine whether it is Flutter or native Xcode. Prefer explicit `--version` plus `--build`, then Flutter `pubspec.yaml`, then Xcode build settings. Never guess among multiple workspaces, projects, or schemes; request `--workspace`, `--project`, or `--scheme`.
2. Choose the translation source locale with the user. Use any App Store Connect locale as the source; default to `zh-Hans` only when the user has no preference. Run `python3 <skill-dir>/scripts/release_form.py new --repo <repo> --source-locale <locale>` when a form does not exist. It reads the current version/build, finds the latest previous form, and creates a schema 8 draft.
3. If `$app-store-aso` produced an `aso-handoff.json`, import it only after validation with `python3 <skill-dir>/scripts/release_form.py import-aso <handoff> <form>`. Import only description, promotional text, keywords, and What's New. Keep App Name and Subtitle as App Information recommendations; never write them automatically.
4. Review Git changes and model configuration to draft four source-language fields: `描述`, `推广文本`, `关键词`, and `此版本的新增内容`.
5. Show all four drafts in the selected source language to the user. Track their approval independently. Do not translate or fill any public copy until all four are explicitly approved.
6. Open the App Store Connect language selector and inventory every language shown under both the localized and unlocalized groups. Record their union in `locale_inventory` and preserve each locale's current inventory state.
7. Before translating or filling any locale, perform both mandatory preflight confirmations:
   - Inspect the current session's available Skills and tools for `computer-use:computer-use`. Report whether it is available and record `computer_use_availability` in the form. Never assume availability from an earlier run.
   - Show the localized and unlocalized locale counts, then explicitly ask whether the user wants to translate and create the currently unlocalized languages. Do not infer the choice from a prior release. Record `unlocalized_locale_policy` and set `localization_scope` to either `app_store_connect_localized_languages` or `app_store_connect_all_languages`.
8. Generate all four localized fields only for the confirmed scope, including a translated description in every included locale. Mark excluded unlocalized locales `not_requested_by_user` with page strategy `not_in_scope`; do not create, translate, or edit them. Use the active language model's own multilingual capability by default; translation must not depend on an external translation API, browser translation feature, network access, or third-party account. Only use an external translation service when the user explicitly requests that service. Keywords must be localized ASCII-comma-separated search terms, not sentence translations.
9. Before editing each in-scope field, read its current App Store Connect value and compare normalized text. If the page is empty, write the translation; if it matches, keep it; if it contains different content, pause and ask the user whether to inherit the existing value or replace it with this translation. Never make that conflict choice silently.
10. Run `python3 <skill-dir>/scripts/release_form.py validate <form> --repo <repo>`. Resolve errors before browser automation and report warnings requiring human judgment.
11. When Computer Use is available, use it with the user's existing Chrome login. If it is unavailable, state that clearly and use an available supported browser-control capability only after recording the fallback. Re-read the page before every edit. For each in-scope locale, inspect description, promotional text, keywords, and What's New before typing. Resolve every differing non-empty value with the user, then apply the recorded per-field strategy, save, and read all four displayed values back.
12. Select only a build whose Apple processing is complete. Save the draft and verify the binding.
13. Stop before **Add for Review**, **Submit for Review**, or any equivalent submission control. Report completed fields, excluded unlocalized languages, and remaining manual checks.
14. Add or update the version row in `references/release-version-table.md`, recording field status and inheritance without copying sensitive information.

## Browser Safety

- Never store or echo review passwords, access tokens, phone numbers, signing material, receipts, or complete account identifiers.
- Reuse sensitive values already saved in App Store Connect; represent them in Markdown as `REUSE_EXISTING_ASC_SAVED_INFORMATION`.
- If the user operates any Chrome window while automation is active, pause. Re-read the current tab, URL, version, locale, and visible form before continuing.
- Never infer that a save succeeded from a click alone. Read the resulting page state.
- Never overwrite a non-empty public-copy field that differs from the prepared translation without explicit user confirmation. Show the locale, field, existing text, and prepared translation before asking whether to inherit or replace.
- Never upload a build, change certificates, edit agreements, answer compliance questions, or submit a version unless separately authorized.

## Copy, Keywords, and Description Rules

- Use the active language model directly for localization. Treat external translation APIs as optional user-requested tools, never as a prerequisite or automatic fallback.
- Translate each locale directly from the form's approved `source_locale`. Do not route the text through an external service or an intermediate language merely to automate bulk translation.
- After model-generated translation, review model names, URLs, feature claims, list structure, and locale-specific wording before validation and browser entry.
- Use the form's `source_locale` as the single translation source for description and the three release fields. It may be any language offered by App Store Connect; `zh-Hans` is only the default.
- Do not translate through simplified Chinese or another intermediate language when a different `source_locale` was selected. Preserve meaning directly from the approved source copy.
- Translate every locale in the user-confirmed `localization_scope`. Never translate or create an unlocalized locale until the user has explicitly opted in during the current run. The website is authoritative; the reference locale table is only a checked baseline.
- A locale is complete only after its localization exists, description plus all three release fields are saved, and all four displayed values are read back.
- Use the Chinese App Store Connect labels in Markdown: `推广文本`, `描述`, `此版本的新增内容`, `关键词`, `支持网址`, `营销网址`, `版权`, and `审核备注`.
- Keywords use ASCII commas with no trailing comma, empty term, or case-insensitive duplicate. Keep the complete field at or below 100 UTF-8 bytes, including commas; this is especially important for CJK text.
- Schema 8 contains project detection metadata and translations for all four fields in every in-scope locale. Excluded unlocalized locales remain recorded for inventory audit with `not_requested_by_user` and `not_in_scope`, without generated public copy.
- Each locale field records one page strategy: `pending_page_comparison`, `use_translation_page_was_empty`, `matches_translation`, `replace_after_user_confirmation`, `inherit_after_user_confirmation`, or `not_in_scope`.
- Empty page fields become `use_translation_page_was_empty`; identical fields become `matches_translation`. A differing non-empty field can become `replace_after_user_confirmation` or `inherit_after_user_confirmation` only after the user explicitly chooses.
- When `inherit_after_user_confirmation` is selected, keep the prepared translation in the form for auditability but do not overwrite the page field. Read the inherited page value back and record completion.
- The source locale is not machine-translated back into itself: copy its approved source values into that locale section verbatim, subject to field limits and keyword rules.
- Schema 1–7 forms remain readable historical records and retain their original source-language, scope, inheritance, description, and project semantics; do not silently migrate or rewrite an already-filled form.
- Support URL, marketing URL, copyright, screenshots, previews, and review notes inherit unless the user separately requests a change.
- Preserve product and model spelling from repository configuration. Do not introduce unconfirmed features from older drafts.
- Placeholders are allowed while `form_status: draft`, but not when `ready-to-fill`.

## Commands

```bash
python3 <skill-dir>/scripts/release_form.py new --repo /path/to/flutter-repo
python3 <skill-dir>/scripts/release_form.py new --repo /path/to/xcode-repo --project-type xcode --workspace App.xcworkspace --scheme App
python3 <skill-dir>/scripts/release_form.py new --repo /path/to/repo --version 2.0.0 --build 200
python3 <skill-dir>/scripts/release_form.py import-aso /path/to/aso-handoff.json /path/to/repo/docs/app-store-connect/releases/2.0.0.md
python3 <skill-dir>/scripts/release_form.py validate /path/to/repo/docs/app-store-connect/releases/2.0.0.md --repo /path/to/repo
python3 <skill-dir>/scripts/release_form.py summary --repo /path/to/repo
```
