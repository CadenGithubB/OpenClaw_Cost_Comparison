# Bundled catalog audit

Snapshot retrieved: 2026-09-10T22:08:21.711Z.

11,972 records scanned; 7,978 normalized offers bundled, 3,287 excluded and 707 duplicate records merged. 60 cross-source price disagreements are flagged.

## Security result

Heuristic suspicious-text matches: 0. Prototype-key matches: 0. These results are not proof that every record is benign or every price is accurate.

The importer uses fixed HTTPS sources, bounded JSON parsing and an allowlist of retained fields. Descriptions, instructions, package/environment fields, commands and source-supplied links are not included in the runtime catalog. No downloaded content is executed. The app renders data with text APIs and a hashed content security policy; it never uploads usage or fetches catalog data at runtime.

Synthetic tests exercise instruction injection, script/handler payloads, bidirectional controls, prototype keys, invalid prices, unit conversions, source conflicts and unsupported billing structures.

## Exclusions

| Reason | Records |
| --- | ---: |
| nonstandard or local offer | 358 |
| unsupported pricing overrides | 49 |
| extra request or reasoning charge | 35 |
| invalid rate | 5 |
| zero price needs free local or subscription review | 536 |
| invalid context limit | 20 |
| deprecated | 448 |
| missing rate | 349 |
| non text or unknown modality | 1052 |
| conflicting tier definitions | 215 |
| invalid tier ratio | 11 |
| unsupported multiple or noncontext tiers | 27 |
| separate reasoning rate | 39 |
| invalid label | 4 |
| cache read above input | 1 |
| cache write outlier | 2 |
| rate outlier | 4 |
| unsupported tiered pricing | 49 |
| authoritative entry excluded | 83 |

## Sources and provenance

- modelsdev: https://models.dev/api.json
  - SHA-256: `1425547c95b51aa6639d8a87ad9e31c2e31478f0da17a4beca419aa74c2b24a0`
  - Download bytes: 4556341
- openrouter: https://openrouter.ai/api/v1/models
  - SHA-256: `b6c7568ecfad5476a6dc056f4f40eec012f034211526dc46a32eee69e8e508f4`
  - Download bytes: 720543
- litellm: https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
  - SHA-256: `3df965920d0ccecdf36f477aea971eed52ac1b30a611b68c4776b88a06f9d367`
  - Download bytes: 2363322

Source priority for duplicate catalog entries: OpenRouter, then Models.dev, then LiteLLM. Conflicting prices are not averaged. Excluded authoritative OpenRouter entries are not restored through weaker flat-rate data. Existing individually reviewed direct-provider offers remain preferred; current OpenRouter observations update older OpenRouter offers.

3 older curated OpenRouter rate entries were updated from the downloaded snapshot. Exact old/new rates and retained mapping provenance are included in exported reports.

## Limits

These are provider/model offers, not unique models or guaranteed purchasable endpoints. A retrieval date is not a historical price effective date. Tier structures that cannot be safely represented, non-text billing, deprecated entries, zero-price/local/subscription records and outliers are excluded. Unknown cache rates remain unknown. Matching a model name does not prove equivalent quantization, quality or tokenizer behavior.

The complete machine-readable findings are in data/catalog-audit.json. Source attribution and MIT notices are in THIRD_PARTY_NOTICES.md and embedded in the HTML.
