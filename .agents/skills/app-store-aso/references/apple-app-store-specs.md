# Apple App Store Specifications

Verified against Apple Developer documentation on 2026-08-14. Re-check the linked pages before relying on device-specific dimensions or changed platform behavior.

## Version Metadata

| Field | Limit | Notes |
| --- | ---: | --- |
| App Name | 2–30 characters | App Information recommendation only in this bundle's handoff. |
| Subtitle | 30 characters | App Information recommendation only in this bundle's handoff. |
| Promotional Text | 170 characters | Appears above Description and can be updated without a new submission. |
| Description | 4,000 characters | Plain text; required and localizable. |
| Keywords | 100 UTF-8 bytes | Required and localizable. Each keyword must be longer than two characters. Apple says not to duplicate app/company names and disallows names of other apps or companies. |
| What's New | 4,000 characters | Required for updates after the first version and localizable. |

Sources: [Apple App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information), [Apple Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information).

## Screenshots and Previews

- Apple currently accepts one to ten screenshots in JPEG/JPG/PNG and disallows alpha/transparency.
- Exact required device families and pixel sizes are maintained in Apple's live table. Inspect it for the app's supported platforms instead of copying a stale dimension list.
- Apple allows up to three app previews per localization and device size.

Sources: [Apple Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications), [Apple Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information).

## Custom Product Pages

Apple currently describes up to 70 additional product-page versions, each with a unique URL. A page can vary screenshots, Promotional Text, and app previews. Apple also documents keyword assignment and deep links for supported OS versions. Custom page metadata requires review.

Source: [Apple Custom Product Pages](https://developer.apple.com/app-store/custom-product-pages/).

## Interpretation Boundary

These specifications describe allowed fields and product capabilities. They do not prove a general search-ranking formula. Keep ranking and conversion recommendations framed as hypotheses to test with App Store Connect analytics or Apple's product page optimization tools.
