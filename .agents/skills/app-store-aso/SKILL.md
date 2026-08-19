---
name: app-store-aso
description: Audit and optimize Apple App Store product pages using evidence-backed metadata, competitor comparisons, visual asset recommendations, and independently approved release copy. Use for App Store ASO audits, keyword and listing optimization, screenshot or preview strategy, custom product pages, competitor reviews, and approved handoff to ios-appstore-release-manager. Do not use for Google Play.
---

# App Store ASO

Optimize Apple App Store listings without presenting industry folklore as Apple-confirmed ranking behavior. Read [references/apple-app-store-specs.md](references/apple-app-store-specs.md) for current Apple constraints, [references/audit-framework.md](references/audit-framework.md) for analysis structure, and [references/aso-handoff-schema.md](references/aso-handoff-schema.md) before creating a handoff.

## Workflow

1. Establish the app, storefront, source locale, audience, business goal, release context, and provided evidence. Ask for a public App Store URL when available.
2. Use current Codex web or browser capabilities to inspect public Apple product pages, Apple documentation, and explicitly named competitor pages. Record direct URLs and the retrieval date. Never use legacy `WebFetch` instructions.
3. Separate evidence into observed facts, Apple-documented requirements, and recommendations or hypotheses that require testing.
4. If a page, field, screenshot set, performance metric, or competitor cannot be inspected, add it to an **Evidence gaps** section. Do not silently fabricate missing data.
5. Audit positioning, relevance, differentiation, metadata clarity, screenshot narrative, previews, localization, ratings/reviews context, and conversion experiments. Use the scorecard in `audit-framework.md` only as a planning aid, not an Apple ranking formula.
6. Draft source-locale recommendations for App Name, Subtitle, Description, Promotional Text, Keywords, and What's New. Enforce Apple limits. Each keyword must be longer than two characters, use ASCII commas, and keep the complete value at most 100 UTF-8 bytes.
7. Review screenshots and previews against Apple's current specifications. Recommend a message sequence and testable hypotheses; do not invent device dimensions from memory when the current Apple table can be checked.
8. Compare competitors only from pages actually inspected. Present a compact matrix of positioning, metadata, proof, visual story, and gaps. Label any inference.
9. Present recommendations in priority order with expected mechanism, effort, evidence, and a measurable validation plan. Do not describe a speculative ranking factor as Apple-confirmed.
10. Ask the user to approve Description, Promotional Text, Keywords, and What's New separately. App Name and Subtitle are recommendations under App Information and are never part of the automatic release import.
11. A pending `aso-handoff.json` template may be created at any time with `scripts/aso_handoff.py new`. Finalize it as `approval_status: approved` only after all four release fields are complete and independently approved. Then hand off to `$ios-appstore-release-manager`.

## Evidence Rules

- Use Apple primary sources for field limits, localization behavior, screenshots, previews, product page optimization, and custom product pages.
- Cite each current product page and competitor page used. Include the date accessed.
- Treat claims about indexed fields, ranking weights, keyword repetition, update cadence, or conversion impact as unconfirmed unless Apple explicitly documents them.
- Industry conversion data is non-official. Name its source and methodology when known, and add a verification date. If not verified for the current task, omit the number.
- Apple may publish its own product-page metrics; identify those as Apple-published observations, not universal forecasts.
- Never infer search ranking or conversion performance from metadata alone.

## Output

Use this order:

1. Executive finding
2. Evidence and evidence gaps
3. Metadata audit and compliant drafts
4. Screenshot/preview narrative
5. Competitor comparison, when requested
6. Prioritized experiments and measurement plan
7. Field-by-field approval checklist
8. Handoff status

The report must be useful even when no handoff is requested. Never include Google Play limits, terminology, or recommendations.

## Handoff Commands

```bash
python3 <skill-dir>/scripts/aso_handoff.py new --source-locale en-US --output /path/to/aso-handoff.json
python3 <skill-dir>/scripts/aso_handoff.py finalize /path/to/aso-handoff.json
python3 <release-skill-dir>/scripts/release_form.py import-aso /path/to/aso-handoff.json /path/to/release-form.md
```

Finalization refuses incomplete, oversized, unapproved, or unsourced handoffs. It stamps `generated_at` and changes the aggregate status to `approved`; it does not modify App Store Connect.
