# VIDEO (YouTube) campaign creation — NOT FEASIBLE via API; Scripts-generator workaround

**Status:** Closed as infeasible (2026-07-04) for campaign-level. **2026-07-18 amendment: AD-level
video management IS feasible and is now shipped** as `google_ads_update_video_ad_videos`
(src/videoAdVideos.ts) — the "read-only VIDEO channel" rule turned out to be campaign-scoped.

## 2026-07-18 finding: ad-level `video_responsive_ad.videos` updates ARE allowed

Verified live on Forcepoint (customer 494-825-2953): `AdService`-style update via
GoogleAdsService mutate, entity `ad` (`customers/X/ads/Y`), field mask
`video_responsive_ad.videos`, succeeded against all 5 Safeguard AI YouTube reach ads —
in-place edit (same ad IDs), 3 → 5 videos each. YouTube video asset creation via
`AssetService` also works. Campaign-level mutates (pause, targeting, frequency caps,
bidding) remain MUTATE_NOT_ALLOWED. Constraint: source videos must be Public or Unlisted;
private videos are rejected (oEmbed 401/403 is the cheap preflight fingerprint).
**Original ask:** Extend google-ads MCP to create Video campaigns with YouTube video responsive ads.

## Finding: the Google Ads API cannot create or modify Video campaigns

Verified 2026-07-04 against Google's primary docs:

> "You cannot create new Video campaigns or update existing ones using the Google Ads API."
> "The Google Ads API only supports fetching and reporting on existing Video campaigns and their criteria."
> — https://developers.google.com/google-ads/api/docs/video/overview

The `google-ads-api` library (v23) DOES surface `AdvertisingChannelType.VIDEO`, video ad-group
types, and `VideoResponsiveAdInfo` — but those are for **reading/reporting** and for Demand Gen,
NOT for mutating a VIDEO-channel campaign. The API server rejects the create. **No MCP code can
work around this** — the ceiling is Google's, not ours.

⚠️ The previous version of this backlog item (spec'd `channel_type: "VIDEO"`,
`create_youtube_video_asset`, `create_video_responsive_ad` + TDD cycles) was based on a false
premise. Do not implement it — the mutate will be rejected by the API. Kept here only as a record.

## The only programmatic paths (Google's stated alternatives)

1. **Demand Gen** (already supported by the MCP) — serves video on YouTube, but optimizes to
   conversions, not unique reach at Target CPM. Not equivalent to a true Video Reach campaign.
2. **Google Ads Scripts** — cannot create the campaign *shell* either, but CAN populate an existing
   video campaign (ad groups, video ads, geo, language, audiences, exclusions).
   https://developers.google.com/google-ads/scripts/docs/campaigns/video-campaigns

## Candidate MCP feature: `google_ads_generate_video_reach_script` (script generator)

A **workaround method** — the MCP cannot execute a Google Ads Script, but it can *generate* one
deterministically and hand it back to the operator to paste into Google Ads → Scripts.

- **Inputs:** `customer_id`, `campaigns[]` (each: theater/name, `geo_target_ids[]`,
  `audience_user_list_id`, `excluded_user_list_ids[]`, `youtube_video_ids[]`, ad-group type).
- **Output:** the ready-to-run `.ads.js` text + paste-and-run instructions. **Does not mutate**;
  route OUTSIDE the write-gate and label clearly as "returns an artifact, not a success."
- **Testable in TS** (this is the value vs. a static script): shape tests asserting the emitted
  script contains the right campaign names, geo IDs, audience IDs, video IDs, DRY_RUN scaffold,
  and N campaigns. Template versioned so a Scripts-API change is a one-file fix.
- **Prior art:** a hand-written instance of exactly this script lives in the Forcepoint repo at
  `google_ads/scripts/youtube_reach_populate.ads.js` (5 Safeguard AI TOFU reach campaigns).
  Generalize that into the template.

### Open questions before building
- A few Scripts builder signatures for the VIDEO channel are under-documented (user-list binding on
  `VideoAudienceBuilder`; the efficient-reach video-ad builder). The generated script must carry
  `VERIFY` markers + DRY_RUN default until confirmed in a live Preview.
- Build only if video-campaign spin-up becomes **recurring** (more theaters/products/clients).
  For one-offs, the static script + a runbook are sufficient — a whole MCP tool is over-engineering.

**Recommendation:** Leave as an opt-in backlog item. Do NOT resurrect the original
"create Video campaign via API" scope — it is impossible.
