# Changelog

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
