# @deepseek-ai/dsh-client-ui-brand-community-desktop

English | [中文](README.zh.md)

This package fills the sidebar and conversation Hero brand slots only when `DSH_CLIENT_BUILD_PROFILE` is `community-desktop`. It keeps community desktop branding separate from the upstream official artifact profile and retains no runtime state.

## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The browser title is selected independently through `DSH_CLIENT_TITLE` at build time.
