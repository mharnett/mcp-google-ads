# Backlog

## Open

### config.json's per-client `mcc_customer_id` can be structurally correct and still break login-customer-id
**Found:** 2026-08-07 (Forcepoint session; every google-ads MCP call failed with `USER_PERMISSION_DENIED` / "must set login-customer-id")
**Severity:** High while live — every read/write call to the affected client account failed. Resolved for Forcepoint; the underlying footgun is still open for any other client.
**Root cause:** `config.json`'s `mcc_customer_id` for a client is documentation of the account's real manager in the Google Ads hierarchy (e.g. Forcepoint's own branded MCC, `444-016-4705`) — but the Google Ads API requires `login-customer-id` to be an account the **calling credential has a direct user grant on**, not merely a true ancestor in the hierarchy. Neither `google-ads-admin-drak` nor `google-ads-ro-drak` has a direct grant at `444-016-4705`: `admin-drak` is directly linked to `494-825-2953` itself and to the top Drak Marketing MCC `676-139-6070`; `ro-drak` (created 08-05, see Done section) is directly linked only to `676-139-6070`. Routing through `444-016-4705` failed for both, even though it's the structurally correct manager.
**Fix applied (Forcepoint):** changed `mcc_customer_id` to `676-139-6070` (the top MCC both credentials do have a direct grant on) — verified live via raw REST calls (`customers:listAccessibleCustomers` + a GAQL search with each `login-customer-id` candidate) that this correctly cascades down the manager hierarchy to reach `494-825-2953`, for both the admin and read-only credential. `config.json` is gitignored (local machine config), so this fix isn't in version control — it's local to this machine only.
**Still open:** every other client entry in `config.json` has the same latent risk — a `mcc_customer_id` that looks right on paper but that the active credential can't actually log in as. No systemic fix yet; the pattern to apply if another client breaks the same way is: run `customers:listAccessibleCustomers` for the credential in question and use one of the returned IDs (preferring the one closest to the target account) as `mcc_customer_id`, don't assume the account's on-paper manager is usable.
**Test gap:** nothing in the suite exercises real login-customer-id resolution against the live API (reasonably — it needs live credentials), so this class of bug is invisible to CI by construction. Worth a documented manual-verification step (like the "prove a write fails" step for the RO token below) whenever a client's `mcc_customer_id` changes.

### run-mcp.sh has no startup preflight for the Keychain entries it requires
**Found:** 2026-08-05 (fallout from the `1e6f323` Keychain rename — see Done section)
**Severity:** Medium — turns a one-line config gap into an opaque reconnect failure.
**Symptom:** When a required Keychain account is absent, `run-mcp.sh` prints `[FATAL] GOOGLE_ADS_REFRESH_TOKEN is empty — Keychain lookup failed.` and suggests `security add-generic-password -U -a google-ads-mcp -s GOOGLE_ADS_REFRESH_TOKEN ...` — which names the **wrong account** (`google-ads-mcp`), not the one actually looked up (`google-ads-admin-drak` / `google-ads-ro-drak` depending on `GOOGLE_ADS_MCP_WRITE`). From the client side all you see is "MCP won't reconnect."
**Proposed fix:** Have the fail-fast branch echo the resolved `$GOOGLE_ADS_REFRESH_TOKEN_ACCOUNT` and the exact `security add-generic-password` command for it. Optionally warn when `google-ads-drak` (pre-rename name) exists but the new one doesn't — that's the signature of an unmigrated machine.
**Test gap that let this ship:** `run-mcp.wrapper.test.mjs` asserts only *which account name is selected* for a given `GOOGLE_ADS_MCP_WRITE` value. It never asserts the entry exists or that the wrapper produces an actionable message when it doesn't — so CI stayed green while every consumer broke.

### ~~run-mcp.sh Keychain rename shipped without a migration — `google-ads-ro-drak` unset~~ → RESOLVED 2026-08-05, see Done
**Found:** 2026-08-05 (Forcepoint session; MCP failed to reconnect)
**Severity:** High — every read-only consumer of this MCP currently fails to start.
**Symptom:** `1e6f323` (#30) renamed the refresh-token Keychain account from `google-ads-drak` to `google-ads-admin-drak` (when `GOOGLE_ADS_MCP_WRITE=true`) / `google-ads-ro-drak` (otherwise). The commit shipped `run-mcp.sh` + `run-mcp.wrapper.test.mjs` but **nothing that creates either entry**. On a machine still holding only the old `google-ads-drak`, `GOOGLE_ADS_REFRESH_TOKEN` resolves empty, `run-mcp.sh`'s fail-fast loop prints `[FATAL] GOOGLE_ADS_REFRESH_TOKEN is empty` and exits 1 before `exec node`. The MCP never connects.

**Partially resolved 2026-08-05:** `google-ads-admin-drak` created by copying the existing `google-ads-drak` token (that token *is* the admin/write credential). Write-context sessions (client dirs with `GOOGLE_ADS_MCP_WRITE=true`) work again.

**Still open:** `google-ads-ro-drak` is unset, so every context *without* the write flag — the monorepo-root autonomous poller, `weekly-search-term-review`, `motion-task-poller`, and any non-client session — starts without google-ads tools available. This degrades silently: the job runs, the tools are simply absent.

**Why it wasn't just filled in:** the Google Ads API exposes exactly one OAuth scope (`https://www.googleapis.com/auth/adwords`), which is read **and** write. A genuine read-only credential therefore requires a *separate Google identity* holding **Read only** access level in the MCC (444-016-4705) — it cannot come from scope restriction. Copying the admin token into the `-ro-` slot would make that slot's name assert something untrue.

**Mitigating control (important):** `src/writeGate.ts` (`mcp-write-gate`) already hides and refuses 60+ write tools unless `GOOGLE_ADS_MCP_WRITE=true`. That is the primary enforcement. The read-only token is defense-in-depth against a misconfigured env var or an API call made outside the MCP tool layer — not the only thing standing between a read-only context and a write.

**Blocked on:** creating the separate Google identity. Google Workspace seat quota is full; Cloud Identity Free (free, up to 50 users, no Gmail/Drive) was the intended route but provisioning stalled 2026-08-05. A free Gmail is an equivalent fallback — `+` aliases and Workspace aliases do **not** work (Ads keys on the Google account, and rejects them as already having access).

**To resume:**
1. Create the identity — Cloud Identity Free user on `drakmarketing.com`, or a free Gmail.
2. Google Ads → MCC 444-016-4705 → Admin → Access and security → Users → invite, access level **Read only**. Accept the invite before step 3 or the token will be valid but see no accounts.
3. `cp` the existing `~/Library/Preferences/mcp-google-ads-nodejs/credentials.json` aside — `dist/auth-cli.js` **overwrites** it. Run `node dist/auth-cli.js --customer-id 494-825-2953` in an incognito browser signed in as the read-only account.
4. `security add-generic-password -U -a google-ads-ro-drak -s GOOGLE_ADS_REFRESH_TOKEN -w "$(node -p "require('<cred path>').refresh_token")"`, then restore the backed-up `credentials.json`.
5. **Verify the boundary by proving a write fails**, not that reads work — attempt a campaign rename with the RO token and confirm `USER_PERMISSION_DENIED`. Reads succeeding proves nothing; an admin token reads fine too.

**RESOLVED 2026-08-05.** Both slots now populated and verified:
- `google-ads-admin-drak` ← copy of the pre-existing `google-ads-drak` token (that token *is* the admin/write credential).
- `google-ads-ro-drak` ← **new, genuinely read-only** refresh token. Identity: `ads-readonly@drakmarketing.com` (Cloud Identity Free — no seat consumed), granted **Read only** access, reaching Forcepoint - NAM (494-825-2953) via Drak Marketing MCC (676-139-6070).

**Boundary proven, not assumed** — with the RO token: `SELECT campaign.name ... ` succeeded; `campaigns.update()` was rejected with `authorization_error: ACTION_NOT_PERMITTED`. Campaign verified unchanged afterward. A read-only check alone would have proven nothing — an admin token reads fine too.

**Gotchas hit, for next time:**
- Cloud Identity Free users have **no Gmail**, so the Ads invitation can't be received at that address. Route the invite elsewhere (Workspace default routing) or use an address with a mailbox.
- `dist/auth-cli.js` on an `embedded=false` build requires `GOOGLE_ADS_CLIENT_ID` / `CLIENT_SECRET` / `DEVELOPER_TOKEN` in env — source them from the `google-ads-mcp` Keychain account first.
- The CLI auto-opens the default browser (signed in as the admin user). Paste the printed consent URL into an incognito window instead, or you silently mint an admin token into the read-only slot.
- `credentials.json` and the Keychain hold **different** tokens by design (two credential paths). Back up `credentials.json` before running the CLI and fingerprint it after restoring.

The follow-up preflight/error-message improvement is tracked as its own Open item above.

### apply_label cannot target keyword criteria
**Found:** 2026-07-17 (Forcepoint INDIA pause-batch sync)
**Severity:** Low-medium — breaks the "label every keyword change" audit rule for *existing* keywords.
**Symptom:** `google_ads_apply_label` accepts `campaign_ids` / `ad_group_ids` / `ad_ids` only. There is no way to label existing ad-group criteria (keywords) through any exposed tool, so status changes made via `google_ads_pause_keywords` / `google_ads_enable_keywords` can't be tagged `claude-MM-DD-YY` afterward. The internal plumbing already exists (`labelAdGroupCriteria`, used by `create_keywords` and `applyCustomLabels(assetType: "keyword")`) — the tool handler just never routes to it.
**Proposed fix:** Add `criterion_resource_names` (or `keyword_ids` + `ad_group_ids`) to the `apply_label` schema and route to `labelAdGroupCriteria`. Alternatively add an optional `label` param to `pause_keywords` (mirroring `enable_keywords`, which already accepts `labels`).
**Workaround used:** one-off Node script calling `customer.adGroupCriterionLabels.create` directly with Keychain creds (session scratchpad `label-india-pause-batch.mjs`, 2026-07-17).

## Done

### create_responsive_search_ad silently drops `labels` parameter
**Found:** 2026-04-22 (Forcepoint NAM Week 7 ad swap)
**Fixed:** 2026-07-03 (branch `fix/custom-labels-dropped`)
**Root cause:** `createResponsiveSearchAd` called `autoLabelCreated` (the `claude-MM-DD-YY` auto-label) but never called `applyCustomLabels` with the caller's `ad.labels`, so custom labels were silently dropped after a successful create.
**Fix:** Added `await this.applyCustomLabels(customerId, adRNs, "ad", ad.labels)` immediately after `autoLabelCreated` in `createResponsiveSearchAd` (runs after creation, so the ad resource names exist).
**Sibling audit result:** Of the 4 suspected siblings, NONE were affected — none exposes a custom-label parameter that reaches the handler:
- `create_ad_group` — no `labels`/`label` param in the tool schema.
- `create_keywords` — exposes `label` (singular); the handler applies it correctly via `ensureLabelExists` + `labelAdGroupCriteria`.
- `create_shared_set` — no `labels` param (`createSharedSet(customerId, name)`).
- `create_sitelink` — no `labels` param.
Adding label support to those would be a new feature, not a bug fix.
**Regression test:** `src/createResponsiveSearchAd.labels.test.ts` (drives the real `createResponsiveSearchAd` with a fake customer; asserts the aggregate set of labels attached to the created ad includes both the auto label and all caller-supplied labels).

<details><summary>Original report</summary>

**Severity:** Medium — breaks audit-trail labeling and ad-group filter workflows.
**Symptom:** Pass `labels: ["my-tag", "my-other-tag"]` to `google_ads_create_responsive_search_ad`. Tool accepts it, reports success, auto-applies `Claude-MM-DD-YY`, but the custom labels never attach. Confirmed via `ad_group_ad_label` GAQL query — only the auto label is present.
**Workaround:** Call `google_ads_apply_label` after create (one call per label, passing the new `ad_ids`). Works end-to-end.
**Root cause hypothesis:** The create handler either never calls `applyCustomLabels`, or calls it before the ad resource is returned by the mutate, or calls it with the wrong resource name format. Suspect the path goes via `autoLabelCreated` only (which handles the `Claude-MM-DD-YY` auto-label) and skips the user-supplied `labels` array entirely.

</details>
