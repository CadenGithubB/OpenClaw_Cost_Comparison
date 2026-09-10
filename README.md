# OpenClaw Cost Comparison

A local calculator for comparing OpenClaw usage with hosted model prices and hardware costs. It estimates **cost at the same token volume**, not the bill or quality another model would produce for the same work.

[Live site](https://cadengithubb.github.io/OpenClaw_Cost_Comparison/) · [OpenClaw](https://github.com/openclaw/openclaw)

## Use it

Open `index.html` directly in a modern browser, or serve the repository with `python3 -m http.server 8080`. The delivered HTML has no runtime dependencies, network requests, API keys or build requirement.

1. Export JSON from **OpenClaw Control UI → Usage**, then choose, drop or paste it (10 MB maximum). The Gateway `sessions.usage` response also includes `aggregates.byModel`. `gateway usage-cost` alone lacks the per-model detail needed here.
2. Confirm the inclusive observation interval. Idle days count. Changing dates changes the denominator; it does not filter aggregate tokens. Import the interval you want to analyze.
3. Identity matches populate automatically. For an unmatched local model, accept a **priced alternative**, search the bundled catalog by model/provider, or set custom rates. Selecting an alternative is an explicit different-model scenario. Search is local and returns up to 100 results; narrow the query to find more. The dialog copies the selected offer's current rates, not a historical name-only suggestion. Include checkboxes and the role filter explicitly control scope; merely assigning a role excludes nothing.
4. Choose a context pricing scenario. **Show cost range** is the default. **Use my context limit** accepts an exact maximum input-token count per request (270,000 is prefilled for this user's setup). A limit at or below a model's standard-pricing threshold resolves its estimate to standard rates; a higher limit keeps the range. The setting applies to every compared request and model, including all prompt/history/tool content, and does not configure your local runner or verify past requests.
5. Select already-owned or new-purchase hardware, electricity and allocation to the selected workload. Totals update immediately.
6. Export a report containing normalized usage, sources, coverage, assumptions and projections. Review model names, usage and costs before sharing it.

The synthetic demo deliberately includes an unknown model to demonstrate incomplete price coverage.

## Estimate boundaries

- Unknown price is not zero. The app shows a priced subtotal, token coverage and missing-price reasons. Comparison conclusions and projections require complete selected pricing, a complete source and a valid interval.
- OpenClaw input, output, cache-read and cache-write buckets are disjoint. Missing input/output splits or inconsistent totals stay unpriced. Optional cache buckets in older exports default to zero. Total-only exports are not guessed into a split.
- Choose **reuse observed cache counts** or **no API cache discount**. Cache behavior may differ at another provider. Missing cache rates stay unknown.
- Unknown request sizes do not remove usage from pricing. Context-tiered models show a standard-to-long-context scenario envelope for groups whose aggregate input exceeds the threshold. Groups whose entire input fits the threshold stay standard, even in the high-cost scenario. A whole export is never treated as one request. The envelope is not a confidence interval or a guaranteed invoice bound: tokenizer, caching, service-tier and other exclusions still apply.
- **Assume standard context**, **Assume long context**, and **Use my context limit** are explicit alternatives to the range. Long context applies high rates to unresolved groups, not to groups known to fit standard context. A declared maximum above the threshold does not imply all requests were long. Exact counts matter: 270,000 is below 272,000, while 270 × 1,024 = 276,480 is above it.
- OpenClaw's `contextWeight` character-count snapshots are not per-request token history or the configured context limit. They are not used to infer billing tiers. The importer uses aggregated token buckets; request count averages cannot prove a maximum request size.
- Ranges propagate through model rows, alternative comparisons, role totals, savings and projections. If the range crosses or touches equal hardware/hosted cost, the app does not declare a consistent winner. Missing token splits or unknown rates still produce incomplete subtotals, and incomplete sources still suppress conclusions.
- A sessions-only fallback may be limited or overlap historical sessions; it is treated as incomplete. Prefer full aggregates. Identical model names from different providers remain separate.
- Recorded costs, including zero, are retained as OpenClaw-recorded values that may be estimates. They are not overwritten with current rates or represented as verified invoices.
- Different tokenizers, reasoning output, retries, quantization and serving behavior can change actual costs. Same-model labels describe identity/family and size, not identical performance.
- Text-token charges only: tools, taxes, subscriptions, media billing, cache storage, batch/priority discounts and negotiated rates are excluded. Custom rates are user-supplied flat scenarios.

## Hardware assumptions

**Already owned** excludes the past purchase price and includes entered electricity. **Buying** either counts a purchase once or spreads it over useful life, with cumulative depreciation capped at purchase price. Months use 365.25 / 12 days. There is no automatic replacement or resale value.

Electricity uses active watts × active hours plus idle watts × remaining hours, multiplied by kWh price and calendar days. Zero prices and zero active hours are valid. Use measured wall power attributable to the workload; GPU ratings are not whole-system measurements. Allocation scales hardware and electricity together and does not change automatically with role filters.

Projections hold usage and selected rates constant, starting hardware ownership at day zero. They are scenarios, not predictions of future prices or utilization. Known scheduled price changes apply after their effective date when the page calculates, but projections do not simulate future rate changes.

## Pricing maintenance

The application bundles a one-time snapshot; users do not download catalogs or provide API keys. `data/pricing.json` preserves the reviewed mappings and rates. `data/catalog-snapshot.json` adds screened records from Models.dev, OpenRouter and LiteLLM. The build merges them and overlays current OpenRouter catalog rates on matching older OpenRouter entries while retaining reviewed local aliases. Other reviewed provider-specific offers take precedence over duplicate community records. Exported reports record source URLs, retrieval hashes, dates and curated rate updates.

Each offer identifies the model, provider, source, date and four rates in **USD per million tokens**. `verified` means individually reviewed; `catalog` means observed in a normalized snapshot, not independently verified billing. Missing rates remain `null`. A catalog's retrieval date is not the effective date of the price or proof of current endpoint availability. Routing offers, provider variants and different tokenizers are not equivalent services. Source disagreements are flagged, not averaged; conflicted generic entries do not auto-match. Exact reviewed aliases can retain a newer authoritative OpenRouter observation with the disagreement warning visible.

Every context-tiered offer includes a standard threshold and per-bucket `longContextMultipliers` (at least 1). Missing long-context cache multipliers stay `null` and block pricing only when those buckets are used in that scenario. Endpoint capacity is stored separately from a billing threshold; one is never inferred from the other. Unsupported/contradictory multi-tier structures are excluded rather than flattened. A declared limit exceeding an endpoint's capacity produces a compatibility warning, not a claim the workload will fit.

Report schema version 2 adds `lowCost`, `highCost` and `hasRange` to summaries, per-model `estimatedCostRange`, context assumptions, and projection bounds. Scalar `cost`/`estimatedCost` values are `null` when an estimate is a range; use coverage and the range fields to distinguish that from missing prices. `summary.winnerDetermined` distinguishes a usable comparison from a consistent cheaper option.

The September 10, 2026 snapshot recognizes `qwen3.6:35B` and `qwen3.6:35b`. Ollama names this release 35B; hosted providers name the corresponding model Qwen3.6 35B A3B. A3B describes roughly 3B active parameters within the 35B model. The default mapping assumes the official Ollama library release, not a locally retagged model. Its mapping source is stored with the offer.

Qwen 3.6 offers include OpenRouter's advertised starting rates and explicitly labeled Alibaba US (Virginia) rates. A starting rate is not a guaranteed routing price. Verify endpoint availability, region, limits and conditions at the linked provider source.

Older mappings remain recognizable but are marked **needs review** and excluded from pricing until you choose a verified offer or provide current custom rates. `llm_api_pricing_april_2026.json` is a historical research archive, not a runtime dataset. Its old rates are not used.

To update individual reviewed offers, verify the exact provider/model and conditions from official sources, edit the curated file, update its verification date, test and rebuild. To refresh public catalogs once as a maintainer, run `npm run catalog:refresh`, inspect `data/catalog-audit.json`, then test and rebuild. Refreshing is never a runtime/browser action. Selected rates older than 90 days get a warning; expired offers stay unpriced.

### Catalog safety and audit

The maintainer importer fetches only three fixed HTTPS URLs, refuses redirects, caps each response at 32 MB and times out. It uses JSON parsing, never eval or source-provided commands/packages/links. Only allowlisted scalar fields survive; remote descriptions, instructions, environment fields and provider URLs are discarded. Source hashes preserve provenance without shipping raw metadata.

Record scanning flags common instruction-injection, script/handler, bidirectional-control and prototype-key patterns. Tests include adversarial synthetic records. **This heuristic cannot prove a catalog is free of prompt injection or pricing mistakes.** The primary safety boundary is treating all imported values as inert data, rendering with text APIs, using only fixed source URLs and a hashed CSP with no network connections.

The audit also screens invalid/non-finite/negative rates, unit conversion, price outliers, suspicious cache ratios, unknown currencies, deprecations, non-text output, free/local/subscription offers, unsupported fees and pricing tiers. Excluded zero-priced records are not assumed to be free paid APIs. Duplicate identities use OpenRouter over Models.dev over LiteLLM; unsupported authoritative OpenRouter records cannot be silently restored using weaker flat-rate data. Conflicts and exclusions remain counted in the in-page audit and JSON report. Quarantine references are opaque hashes rather than copies of suspicious payloads.

See `THIRD_PARTY_NOTICES.md` for catalog attribution and the included MIT notices. Those notices are also embedded in the distributable HTML.

## Develop and verify

Node 22+ is required only for development. Runtime functionality is bundled into one HTML file.

```sh
node scripts/build.mjs
node --test tests/core.test.mjs tests/catalog.test.mjs
node scripts/build.mjs --check
```

For browser regression tests, install the locked development dependency with pnpm 11.19.0:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run test:browser
```

`BROWSER_EXECUTABLE` may point to an installed Chromium-family browser; `PLAYWRIGHT_MODULE` may point to an existing Playwright package. Tests use synthetic inputs in an isolated browser, block network requests and verify direct file opening, CSP, injection resistance, calculations, imports, exports, selection and mobile overflow.

Edit `src/index.html`, `src/styles.css`, `src/core.mjs` and `src/app.js`, then rebuild the tracked root HTML. The build embeds the merged catalog, audit summary, attribution and demo, and hashes the exact script and stylesheet for CSP. Do not edit generated HTML or add unsafe-inline to bypass CSP. GitHub Actions validates the catalog, calculations, generated output and browser behavior.

GitHub Pages can keep serving root `index.html`; no hosting migration is required.

## Privacy and security

Processing occurs in the page, with no analytics, remote font/script loading, browser storage or automatic uploads. CSP blocks network connections and permits the build's hashed script and style. Imported/custom strings are rendered through text DOM APIs rather than interpreted as markup. File sizes and numeric inputs are bounded.

Normalized reports omit irrelevant metadata such as session names, phone numbers, paths and contacts. Reports still contain model/provider names, usage and costs; review them before sharing. Reset clears imported data and settings. Raw import content remains visible in the textarea until reset or page close.

Keep machine-specific `.claude/` settings untracked. Before publishing commits, use a GitHub noreply identity if you do not want a personal email in Git metadata. An update branch can descend from the sanitized public history without rewriting or force-pushing it.

## License

MIT. See [LICENSE](LICENSE).
