---
kind: upgrade-guide
description: "The shipped composition no longer fixes a search provider, so web search in a conversation on a DeepSeek model runs legacy Messages search instead of the DeepSeek Search API."
---

# Search on DeepSeek models defaults to legacy Messages search

English | [中文](guide.zh.md)

## Change

Previously, base fixed `web.searchProvider` to `deepseek-search-api`. It now leaves the selection unset, and `dsh-web` selects per model route. The `deepseek-official` and `deepseek-account` model routes prefer `deepseek-official` search: an auxiliary Messages request billed as model tokens, without a per-search charge. It appends `web/deepseek-search-llm-request` to the Session log. Other routes and non-model searches prefer `deepseek-search-api` when usable. Otherwise Automatic requires exactly one usable alternative.

The Messages search endpoint does not follow the model provider's base URL: it is `web-search-deepseek.baseURL`, else `$DEEPSEEK_SEARCH_BASE_URL`, else `https://api.deepseek.com/anthropic/v1`, and outside an account conversation it receives the key under `web-search-deepseek.apiKeyEnv` (`DEEPSEEK_API_KEY` by default). A deployment whose DeepSeek model provider points at a gateway therefore sends that key to the official endpoint and its searches fail until step 2 or 3 is applied.

The Web search provider menu gains **Automatic**, selected when none is stored. A composition or profile that sets `web.searchProvider` itself, and `DSH_WEB_SEARCH_PROVIDER`, see no change. Fetch still defaults to `http`.

The community desktop keeps `web-deepseek-api.enabled` false by default. Independently billed Search and Fetch API requests require explicit enablement in the settings page or YAML. The switch changes neither a custom provider nor a saved Search/Fetch selection. A previously pinned API stays pinned and reports unavailable while disabled. When enabled, Search API may send the latest human prompt with whitespace collapsed and limited to 128 Unicode characters; set `sendOriginalQuestion: false` in `web-deepseek-api` to omit it. Search and Fetch API fees are separate from model-token charges.

## Migration

1. To accept the new default, change nothing. Confirm: the Web search provider menu shows Automatic, and a search in a conversation on a DeepSeek model appends a `web/deepseek-search-llm-request` event.
2. To use the DeepSeek Search API for every model, explicitly enable the independent APIs (`web-deepseek-api.enabled: true`), review the transmission and billing notice, then select DeepSeek Search API in that menu and save, or set `searchProvider: deepseek-search-api` beside `fetchProvider: http` in the `config` of the `@deepseek-ai/dsh-web` row. Confirm: the menu shows DeepSeek Search API, and a search appends no `web/deepseek-search-llm-request` event.
3. To use Messages search through a gateway, select DeepSeek server-side search in that menu and save the gateway's Anthropic-compatible base, which ends before `/messages`, as its Base URL, or set `web-search-deepseek.baseURL`; then select Automatic again if other models should prefer the Search API when it is explicitly enabled and usable. Confirm: a search on a DeepSeek model returns results, and its `web/deepseek-search-llm-request` event names the gateway endpoint.
4. If an existing fixed API selection reports unavailable after upgrading, either explicitly enable the APIs or choose another provider. An upgrade and the enable switch do not replace a custom provider or silently redirect a fixed selection.
