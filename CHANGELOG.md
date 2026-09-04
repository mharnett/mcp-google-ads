# Changelog

## [1.11.0](https://github.com/mharnett/mcp-google-ads/compare/v1.10.0...v1.11.0) (2026-09-04)


### Features

* add google_ads_update_campaign_selective_optimization ([#47](https://github.com/mharnett/mcp-google-ads/issues/47)) ([034baac](https://github.com/mharnett/mcp-google-ads/commit/034baac2697c6ce0c1eeb8bb4a0c10741c70d11b))
* add google_ads_update_responsive_search_ad_text (in-place AdService edit) ([#44](https://github.com/mharnett/mcp-google-ads/issues/44)) ([d78dc7d](https://github.com/mharnett/mcp-google-ads/commit/d78dc7d45d854b3189d452c7f9f723659bc4f432))


### Bug Fixes

* **gaql:** backfill omitted BOOL leaves in google_ads_gaql_query results ([#46](https://github.com/mharnett/mcp-google-ads/issues/46)) ([2c76bf2](https://github.com/mharnett/mcp-google-ads/commit/2c76bf2d66a9d7276f1dcd5741f056bd305111e9))

## [1.10.0](https://github.com/mharnett/mcp-google-ads/compare/v1.9.0...v1.10.0) (2026-09-03)


### Features

* **assets:** add customer-level callout/structured-snippet/link tools ([#32](https://github.com/mharnett/mcp-google-ads/issues/32)) ([0edef8c](https://github.com/mharnett/mcp-google-ads/commit/0edef8c5dc09efb8617d84a12df3ec7c8f84ec8e))
* **scripts:** add git-history secret scanner for credential-hygiene audit ([#36](https://github.com/mharnett/mcp-google-ads/issues/36)) ([0d8be28](https://github.com/mharnett/mcp-google-ads/commit/0d8be28117dc3c3d55eec2ec574ec92e39ae47ac))
* **scripts:** add pass/fail verdict helper for privatize-or-scrub decision ([#39](https://github.com/mharnett/mcp-google-ads/issues/39)) ([d04c106](https://github.com/mharnett/mcp-google-ads/commit/d04c10613ec72cc313d846e9d672083901df1618))
* **scripts:** add verdict helper for Forcepoint asset-refresh Acceptance check ([#41](https://github.com/mharnett/mcp-google-ads/issues/41)) ([d60e02d](https://github.com/mharnett/mcp-google-ads/commit/d60e02dca9d7744c3ef1a938c51c5aac5f64ed2b))


### Bug Fixes

* **campaign:** set upgraded_targeting=false on DEMAND_GEN campaigns ([#38](https://github.com/mharnett/mcp-google-ads/issues/38)) ([a119d35](https://github.com/mharnett/mcp-google-ads/commit/a119d358782aac8a8ba3b2a05951088479cda861))
* **replaceSitelinkUrl:** skip asset links whose parent campaign/ad group is REMOVED ([#35](https://github.com/mharnett/mcp-google-ads/issues/35)) ([79ae0e3](https://github.com/mharnett/mcp-google-ads/commit/79ae0e3ec76a5403fee75c5c5d91617e4d294d18))
* **rsa:** clone-and-swap must not require path1/path2 on the clone ([#37](https://github.com/mharnett/mcp-google-ads/issues/37)) ([335e080](https://github.com/mharnett/mcp-google-ads/commit/335e0803a3a9a6fb34ae483bbb7a221b00b97e57))
* **scripts:** distinguish real history rewrite from ordinary merges ([#42](https://github.com/mharnett/mcp-google-ads/issues/42)) ([dc1c691](https://github.com/mharnett/mcp-google-ads/commit/dc1c691d72656e3d2ac180c9c3b1cc11d32096ab))

## [1.9.0](https://github.com/mharnett/mcp-google-ads/compare/v1.8.0...v1.9.0) (2026-08-01)


### Features

* add google_ads_update_campaign_ad_rotation tool ([#25](https://github.com/mharnett/mcp-google-ads/issues/25)) ([205c83e](https://github.com/mharnett/mcp-google-ads/commit/205c83e7466959a8069b7ee6fd97c41db475331d))
* add google_ads_update_video_ad_videos — ad-level VIDEO channel video management ([6a79491](https://github.com/mharnett/mcp-google-ads/commit/6a79491cd01623d6eb6938e35a963a1077fd3063))
* **bidding:** add magnitude-ceiling guard to updateCampaignBidding ([#29](https://github.com/mharnett/mcp-google-ads/issues/29)) ([1e63b65](https://github.com/mharnett/mcp-google-ads/commit/1e63b65250c90b6962665bdf6e38958292323e00))
* **demand-gen:** support video_asset_ids on DG multi-asset ad creation ([#27](https://github.com/mharnett/mcp-google-ads/issues/27)) ([5c8a68b](https://github.com/mharnett/mcp-google-ads/commit/5c8a68bd346df3193e0febd0a9f359eda409228c))
* **gaql:** warn on campaign_shared_set queries without an ENABLED filter ([f548b9f](https://github.com/mharnett/mcp-google-ads/commit/f548b9fd60ad0b8fe60cc76ae9b2654007498fa5))
* **gaql:** warn when campaign_shared_set is queried without an ENABLED filter ([895c7ae](https://github.com/mharnett/mcp-google-ads/commit/895c7aede55cbbbff978e5e8e0361c09ecec27ba))
* google_ads_update_video_ad_videos — ad-level VIDEO channel video management ([b3b7dab](https://github.com/mharnett/mcp-google-ads/commit/b3b7dab85a178e376171e0fe4bb2370bb8add71b))
* **guards:** canonical claude-MM-DD-YY[-desc] audit-label format ([#22](https://github.com/mharnett/mcp-google-ads/issues/22)) ([a3d075c](https://github.com/mharnett/mcp-google-ads/commit/a3d075c5776c2f656aaa6390937b75f1496e04ea))
* **labels:** thread label_descriptor into the auto claude label ([#23](https://github.com/mharnett/mcp-google-ads/issues/23)) ([6241206](https://github.com/mharnett/mcp-google-ads/commit/62412060fd0d0e361cdcc9471d05b00cfb671f55))


### Bug Fixes

* **bidding:** block silent portfolio-strategy detach, add explicit detach tool ([#26](https://github.com/mharnett/mcp-google-ads/issues/26)) ([f2e1c24](https://github.com/mharnett/mcp-google-ads/commit/f2e1c2464393ea2da3e8417b76fd318e72ce1654))
* **bidding:** correct BIDDING_TYPE_ENUM_TO_NAME against real BiddingStrategyType enum ([91ff035](https://github.com/mharnett/mcp-google-ads/commit/91ff035fdffaf4ed714c3baa21b3652d0969e270))
* **bidding:** stop update_campaign_bidding silently no-opping target-less MaxConv/MCV switches ([#24](https://github.com/mharnett/mcp-google-ads/issues/24)) ([04cce8b](https://github.com/mharnett/mcp-google-ads/commit/04cce8b3d7d0c500be326dc8e5cfd8819cdd9ed1))
* **geo:** force positive_geo_target_type=PRESENCE on campaign creation ([#28](https://github.com/mharnett/mcp-google-ads/issues/28)) ([7d0b090](https://github.com/mharnett/mcp-google-ads/commit/7d0b0901587755241f27e668a795740ece04ca14))
* uniform return shape for updateVideoAdVideos no-op path (TS18048) ([70aa59c](https://github.com/mharnett/mcp-google-ads/commit/70aa59cd7fd56bdc51d8e9b5e3e436fe66288987))

## [1.8.0](https://github.com/mharnett/mcp-google-ads/compare/v1.7.0...v1.8.0) (2026-07-12)


### Features

* **dg-ad:** support ad.name at creation (create tool) ([12b2087](https://github.com/mharnett/mcp-google-ads/commit/12b20871656793cfe1f444676a4dfaf9f1c791fb))


### Bug Fixes

* **ci:** pass EMBEDDED_* to the npm publish step ([8891a16](https://github.com/mharnett/mcp-google-ads/commit/8891a16546d8f08aec6b2ef0954827b9b21dce8d))
* **ci:** pass EMBEDDED_* to the npm publish step ([638e2ff](https://github.com/mharnett/mcp-google-ads/commit/638e2ff43542e482d6dab7e1c183b75dd33093bc))
* **ci:** pin npm@11 for OIDC publish (npm@latest=12 dropped Node 20) ([32dd7c7](https://github.com/mharnett/mcp-google-ads/commit/32dd7c7c6c6dc81ec871afcc0353f203698f237d))
* **ci:** pin npm@11 for OIDC publish (npm@latest=12 dropped Node 20) ([c00fbea](https://github.com/mharnett/mcp-google-ads/commit/c00fbeacd7469fb779b2b64915d7c0a21d485669))
* **dg-ad:** correct numeric-ID resolver + document multi-asset immutability ([f371496](https://github.com/mharnett/mcp-google-ads/commit/f3714969d5d4276bfc83e67a17759f2b2f2d4d20))
* **dg-ad:** correct numeric-ID resolver + document multi-asset immutability ([36a7b67](https://github.com/mharnett/mcp-google-ads/commit/36a7b671f6723a22b08abe57d6c7fafb4c211cc7))

## [1.7.0](https://github.com/mharnett/mcp-google-ads/compare/v1.6.0...v1.7.0) (2026-07-08)


### Features

* **oauth:** publishable PKCE refresh-token flow + scope-from-config (decouple pilot) ([#13](https://github.com/mharnett/mcp-google-ads/issues/13)) ([ae28883](https://github.com/mharnett/mcp-google-ads/commit/ae28883d91ce2b12ac6b635c02a025bc66e83f1e))
* **rsa:** skip length check for countdown / IF-function fields ([4a635df](https://github.com/mharnett/mcp-google-ads/commit/4a635df64d042f7b43f183b2650e639c3f03fce0))


### Bug Fixes

* create_responsive_search_ad now applies caller-supplied labels ([#12](https://github.com/mharnett/mcp-google-ads/issues/12)) ([b992395](https://github.com/mharnett/mcp-google-ads/commit/b9923959193a9aeaf41dea9346dc83dab0b681da))
* **critical:** use TimeoutStrategy.Aggressive to actually abort hung requests ([d641206](https://github.com/mharnett/mcp-google-ads/commit/d6412062e0dce447e23280ea2da200c7dd6afe21))
* **dg:** gate update_demand_gen tool as write + sync stale fixtures ([aeaf6f3](https://github.com/mharnett/mcp-google-ads/commit/aeaf6f368788be64171835506e78cf5189d7cbde))
* Remove long_headlines from update payload (API doesn't support updating) ([4b85a39](https://github.com/mharnett/mcp-google-ads/commit/4b85a3957a08fc72140ce2c77c14a21420773b9f))
* resolve import and export issues from cascade failure ([0f29924](https://github.com/mharnett/mcp-google-ads/commit/0f29924cb310b1e389d571224db633b10fed4d19))
* **rsa:** count LOCATION insertion by default text, not literal length ([69e101f](https://github.com/mharnett/mcp-google-ads/commit/69e101fe2fcb2d3a9c345326e6adc8312ad81a98))

## [1.6.0](https://github.com/mharnett/mcp-google-ads/compare/v1.4.4...v1.6.0) (2026-05-27)


### Features

* add experiment lifecycle tools + fix arm batching and schedule/end/promote API calls ([cc6cf6c](https://github.com/mharnett/mcp-google-ads/commit/cc6cf6c85c8c16eea569ce2946320ada8697bb98))
* add rename_ad_group and link_asset_to_campaign tools ([02297de](https://github.com/mharnett/mcp-google-ads/commit/02297de3c1196c8f6b6493212e5f23f769c9fa95))
* add update_ad_asset_automation tool for Demand Gen opt-outs ([bbd09b4](https://github.com/mharnett/mcp-google-ads/commit/bbd09b41967d4d015c7d5134f9abd4f539d34f22))
* auto opt-out new Demand Gen ads from auto-video and adaptive layouts ([7ebfbc3](https://github.com/mharnett/mcp-google-ads/commit/7ebfbc31c5ac23ab1647a5325d1d7e1cba258fa3))


### Bug Fixes

* add list_experiments and get_experiment to READ_TOOLS fixture; add experiment builder ([cf96a97](https://github.com/mharnett/mcp-google-ads/commit/cf96a97c4264a8802b46a0874ef49220d8a60d77))
* atomic portfolio-strategy detach when breaking shared budgets ([874cd47](https://github.com/mharnett/mcp-google-ads/commit/874cd47766952d09eed60b8cbac915be1c5fd32a))


### Miscellaneous Chores

* bootstrap release-please at 1.6.0 ([c452f99](https://github.com/mharnett/mcp-google-ads/commit/c452f99b235ba2200052c29fe39726595fab58a3))

## [Unreleased]

### Added
- **`google_ads_create_lead_form_asset`**: create a Google LeadFormAsset (the
  Google equivalent of a Meta Lead Gen Form). v1 supports standard fields
  only (FULL_NAME, EMAIL, WORK_EMAIL, PHONE_NUMBER, COMPANY_NAME, JOB_TITLE,
  etc.); custom questions, qualifying questions, and CRM `delivery_methods`
  (webhook for real-time lead sync to Pardot/HubSpot/Salesforce) are NOT yet
  supported — until they ship in a v2, leads must be downloaded as CSV from
  the Google Ads UI (Tools > Lead form submissions) or routed via Zapier.
  Validates required fields, enum membership, and Google's character limits
  (business_name ≤25, headline ≤30, description ≤200, etc.) before the API
  call. Auto-labels the created asset.
- **`google_ads_link_asset_to_campaign`**: extended `field_type` enum to
  include `LEAD_FORM`, allowing newly-created lead form assets to be linked
  to Demand Gen / Search campaigns.

## [1.4.5] - 2026-04-23

### Added
- **`google_ads_enable_keywords`**: flip paused keywords (ad group criteria)
  to ENABLED by criterion resource name. Mirrors the existing
  `pause_keywords` tool for the reverse direction, which `enable_items`
  doesn't cover (that tool only handles campaigns, ad groups, and ads).
  Auto-applies today's `Claude-MM-DD-YY` label and accepts optional custom
  labels for audit-trail discoverability, matching `enable_items` behavior.

## [1.4.4] - 2026-04-18

_(v1.4.3 was a stale pre-existing git tag; bumped past it.)_

### Added
- **`google_ads_create_sitelink`**: atomic sitelink Asset creation with
  `link_text` + `final_urls` + optional paired descriptions. Dry-run default.
- **`google_ads_replace_sitelink_url`**: create-new + re-link-everywhere +
  remove-old workflow for fixing broken sitelink URLs. Needed because
  `Asset.final_urls` is immutable on sitelinks -- `update_asset_urls` returns
  "The field cannot be set". Preserves `link_text` and descriptions from the
  old asset unless overridden. Dry-run default. Old Asset is preserved, only
  its ENABLED links are migrated.

### Fixed
- **`pauseAssetLinks` enum bug.** `AssetLinkStatus` is
  `UNSPECIFIED=0, UNKNOWN=1, ENABLED=2, REMOVED=3, PAUSED=4`. The old code set
  status to `2` intending PAUSED, which was actually ENABLED -- silent no-op.
  Now uses `enums.AssetLinkStatus.PAUSED` directly, with a regression guard
  test asserting the library values.

## [1.4.2] - 2026-04-18

### Added
- **`mcp-google-ads-doctor` now checks npm for a newer version.** New check
  queries `registry.npmjs.org/mcp-google-ads/latest` with a 5s timeout, compares
  against the installed version, and emits: pass when matched, warn with
  upgrade instructions when a newer version exists, warn when the registry is
  unreachable (never fail — offline use must still work). Closes the gap where
  alpha testers stayed on 1.3.0 for weeks without knowing a fix shipped. The
  fetcher is injectable for tests (4 new cases: up-to-date, outdated, network
  error, dev build ahead of latest).

### Changed
- **Bumped `__minimumSafeVersion` from `1.0.5` to `1.4.1`.** Every release
  before 1.4.1 crashes Claude Desktop on first launch (dotenv tip on stdout,
  #2). Running any 1.x before 1.4.1 now prints a deprecation warning to stderr
  at startup. New convention: bump this on every patch that fixes a critical
  transport-breaker.
- **Deprecated 1.3.0 and 1.4.0 on npm** with a pointer to 1.4.1. Anyone
  installing those versions now sees an upgrade warning from npm itself.

## [1.4.1] - 2026-04-18

### Fixed
- **dotenv tip line was contaminating stdout and breaking Claude Desktop on
  first launch.** Since dotenv v17, `config()` prints a `[dotenv@...] injecting
  env ... tip: ...` line to stdout (via `console.log`) unless `{ quiet: true }`
  is passed. stdout is reserved for MCP JSON-RPC, so that single line caused
  an `unrecognized_keys` / JSON parse error on every fresh install. Reported
  externally during alpha onboarding (gear emoji rendered as `◇` in some
  terminals). Fix: pass `{ quiet: true }` to the dotenv call in `src/index.ts`.
  New regression test `src/stdout-cleanliness.test.ts` spawns the bin with
  stripped credentials and asserts every non-empty line on stdout parses as
  JSON. Suite audit confirmed the other 6 marketing-suite packages do not
  import dotenv and are unaffected. Refs #2.

## [1.4.0] - 2026-04-18

### Changed (BREAKING for write users)
- **Read-only by default.** Mutating tools (`create_*`, `update_*`, `pause_*`,
  `enable_*`, `remove_*`, `apply_label`, `link_*`, `unlink_*`, plus all negative
  keyword writes) are hidden from the tool list and refused at call time unless
  `GOOGLE_ADS_MCP_WRITE=true` is set in the MCP server environment.
  Motivation: on 2026-04-17 a casual Slack request activated a live campaign
  with zero friction. Write-by-default is a foot-gun; end users cannot be
  expected to wire up permission gates. All 24 mutating tools now go through
  a single gate (`src/writeGate.ts`) with unit coverage that asserts every
  registered tool is classified as READ or WRITE (drift alarm on new tools).
- Read tools (`list_*`, `get_*`, `*_performance`, `gaql_query`, `validate_ad`,
  `search_term_*`, `keyword_volume`, `list_conversion_actions`) are unchanged.

## [1.3.0] - 2026-04-17

### Added
- **`mcp-google-ads-install` CLI** — writes the Claude Desktop config entry so
  non-technical users never hand-edit `claude_desktop_config.json`. Creates
  the file if missing, preserves sibling MCPs and unrelated top-level keys,
  refuses to clobber invalid JSON, idempotent. Accepts `--customer-id` to
  pin the account ID into the config (skips auth picker later). 9 tests
  cover fresh-create, nested-directory create, preserve-siblings, idempotency,
  update-existing, and corrupt-JSON refusal.
- **`mcp-google-ads-doctor` CLI** — runs a diagnostic check sequence against
  local state and prints pass/fail/warn per check with actionable next steps.
  Covers: Node version, Claude Desktop config presence + validity + registration,
  credentials file presence + required fields, and **MCC-terminal-selection
  warning** (flags when `customer_id === mcc_customer_id`, which is the exact
  foot-gun Kellie hit). Collect-all semantics — every check runs regardless of
  earlier failures. Exit code reflects whether any check failed. 9 tests cover
  each check's pass and fail path.
- **`./install-cli` and `./doctor-cli` subpath exports** for downstream stubs.

## [1.2.5] - 2026-04-17

### Added
- **`./auth-cli` subpath export.** Downstream packages (notably the new
  `mcp-google-ads-auth` stub) can now `import { run } from "mcp-google-ads/auth-cli"`
  to invoke the OAuth helper programmatically. Complements the existing `.`
  root export.

## [1.2.4] - 2026-04-17

### Changed
- **Account picker now forces drill-down past MCCs** so users can't accidentally
  terminate their selection on a Manager account. Top level shows direct-access
  leaves plus a "pick an MCC" entry for each MCC with enumerated children;
  selecting an MCC opens a second picker showing only its leaf clients.
  Previously the one-flat-list picker let users pick an MCC terminally, which
  most tools can't operate on — we hit this in production (user picked the
  Flowspace MCC 232-625-3482 instead of the child 745-851-7309).
- **Single-account auto-select now refuses MCCs.** If the only accessible
  account is a Manager, the CLI errors out with a clear message instead of
  silently picking the wrong thing.

### Added
- **`scripts/check-embedded.mjs` gates `npm publish`.** `prepublishOnly` now
  aborts if `EMBEDDED_CLIENT_ID / CLIENT_SECRET / DEVELOPER_TOKEN` aren't in
  env. Prevents a repeat of the v1.2.1 mistake where a plain `npm publish`
  from a shell without the release script shipped a credential-less build.
  Correct publishes still work via `scripts/release.sh`.

## [1.2.3] - 2026-04-17

### Fixed
- **Logger wrote to stdout under Claude Desktop, corrupting the MCP JSON-RPC
  stream.** The pino destination was gated on `process.stderr.isTTY`; when
  Claude Desktop launched the server as a subprocess, stderr was a pipe (not
  a TTY), the transport config was skipped, and pino defaulted to stdout.
  Claude Desktop's zod validator rejected every message with an
  `unrecognized_keys: level, time, pid, hostname, msg` schema error and the
  MCP showed disconnected. Now `pino.destination(2)` is passed unconditionally
  as the second arg so every run path ends up on stderr. Added a regression
  test that spawns a subprocess with piped stderr and asserts stdout is empty.

## [1.2.2] - 2026-04-17

### Fixed
- Re-release of 1.2.1 through `scripts/release.sh` so embedded OAuth client ID,
  client secret, and developer token are baked into `dist/embedded-secrets.js`
  at publish time. 1.2.1 was published via plain `npm publish` and shipped
  without embedded credentials, causing `mcp-google-ads-auth` to refuse to
  start with "This build of mcp-google-ads was published without embedded
  OAuth credentials." Users should upgrade to 1.2.2.

## [1.2.1] - 2026-04-17

### Fixed
- **`mcp-google-ads-auth` silently exited when invoked via npx / npm `.bin` symlink.**
  The entrypoint guard compared `process.argv[1]` (symlink path like
  `.bin/mcp-google-ads-auth`) to `import.meta.url` (resolved real path to
  `dist/auth-cli.js`), so `isMain` evaluated false and `run()` never executed —
  no browser opened, no error printed. Now compares `fs.realpathSync` of both
  sides. Added regression test that invokes `dist/auth-cli.js` via a symlink.

## [1.2.0] - 2026-04-17

### Added
- **Demand Gen campaign creation end-to-end.** Narrow DG v1; Display / Video /
  Performance Max remain in `backlog/`.
- `google_ads_create_campaign` extended with:
  - `channel_type`: "SEARCH" (default) | "DEMAND_GEN"
  - `bidding_strategy`: "MANUAL_CPC" | "MAXIMIZE_CLICKS" | "MAXIMIZE_CONVERSIONS" | "TARGET_CPA"
  - `target_cpa`, `target_cpc_cap` (dollars)
  - `geo_target_ids[]`, `language_id` (default "1000" = English)
  - `start_date`, `end_date` (YYYY-MM-DD)
- `google_ads_create_ad_group` extended with `type`: "SEARCH_STANDARD" (default)
  or "DEMAND_GEN_MULTI_ASSET_AD_GROUP" (routes through `mutateResources` because
  the v23 client enum map is missing the DG value).
- New tool **`google_ads_create_image_asset`** — upload a PNG/JPG/GIF image
  asset for use in Demand Gen ads. Validates mime type (magic bytes), size
  (≤5 MB), and minimum dimensions (600×314). Accepts either `file_path` or
  `base64_data`. Auto-labels the created asset.
- New tool **`google_ads_create_demand_gen_multi_asset_ad`** — create a DG
  multi-asset ad (PAUSED). Validates headlines ≤40 chars / long_headlines ≤90 /
  descriptions ≤90 and count caps (≤5 each) before the API call. Fails fast if
  the ad_group isn't a DG ad group. Auto-labels the created ad.

### Changed
- Back-compat preserved: existing `google_ads_create_campaign({name, daily_budget})`
  calls still produce the same SEARCH + MANUAL_CPC shape as v1.1.
- Back-compat preserved: existing `google_ads_create_ad_group({name, campaign_id})`
  calls still produce the same SEARCH_STANDARD ad group.

### Internal
- Pure payload/validation logic extracted to `campaignBuilder.ts`,
  `adGroupBuilder.ts`, `imageAsset.ts`, `validateDemandGenAd.ts` for unit
  testing without a live Google Ads client.
- Full test suite: 274 passed + 8 skipped (baseline was 231 + 8).

## [1.0.13] - 2026-04-04

### Security
- Error responses now pass through `safeResponse` to prevent oversized error payloads
- `safeResponse` deep-clones before truncation to avoid mutating original data

### Fixed
- Budget unit documentation clarified (dollars, not microcurrency) in tool descriptions

## [1.0.9] - 2026-04-09

### Added
- Published to npm
- CLI flags (--help, --version)
- SIGTERM/SIGINT graceful shutdown
- Env var trimming and validation

### Security
- GAQL injection fix in query parameters
- All logging to stderr (stdout reserved for MCP protocol)
- Auth errors not retried (fail fast on 401/403)
