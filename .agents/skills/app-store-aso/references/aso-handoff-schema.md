# ASO Handoff Schema 1

The handoff contains a source locale, evidence URLs, generation time, four release fields, independent approval states, and optional App Information recommendations.

```json
{
  "schema_version": 1,
  "source_locale": "en-US",
  "generated_at": "2026-08-14T12:00:00Z",
  "approval_status": "approved",
  "sources": ["https://apps.apple.com/app/id000000000"],
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

The aggregate status may become `approved` only after all four fields are non-empty, compliant, and independently approved. Each comma-separated keyword must be at least three characters and the complete field must stay within 100 UTF-8 bytes. Name and Subtitle are never imported into a release form.
