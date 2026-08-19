# ASO Handoff Schema 1

`aso-handoff.json` transfers four approved Apple App Store version fields from `$app-store-aso` to `$ios-appstore-release-manager`.

```json
{
  "schema_version": 1,
  "source_locale": "en-US",
  "generated_at": "2026-08-14T12:00:00Z",
  "approval_status": "approved",
  "sources": [
    "https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information"
  ],
  "fields": {
    "description": {"value": "...", "approval_status": "approved"},
    "promotional_text": {"value": "...", "approval_status": "approved"},
    "keywords": {"value": "...", "approval_status": "approved"},
    "whats_new": {"value": "...", "approval_status": "approved"}
  },
  "app_information_recommendations": {
    "name": "Optional recommendation",
    "subtitle": "Optional recommendation"
  }
}
```

Rules:

- `schema_version` is exactly `1`.
- `source_locale` must be an App Store Connect locale used by the release form.
- `generated_at` is an ISO 8601 timestamp.
- `sources` contains at least one HTTP(S) evidence URL.
- The top-level status and each of the four field statuses must independently be `approved`.
- Description and What's New are at most 4,000 characters; Promotional Text is at most 170 characters; Keywords are at most 100 UTF-8 bytes, use ASCII commas, and contain only terms longer than two characters.
- Values cannot contain Markdown fence delimiters or release-form locale markers because those tokens would corrupt the Markdown transport.
- Name and Subtitle are App Information recommendations only. The release importer never applies them.
- Import failure leaves the release form unchanged.
