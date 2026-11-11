# Video targeting tools (2026-11-11)

Six write tools for fixing YouTube reach targeting without the UI:

| Tool | API surface | Label |
|---|---|---|
| `google_ads_set_campaign_languages` | CampaignCriterion LANGUAGE (replace set) | auto `claude-MM-DD-YY` on campaign |
| `google_ads_add_youtube_channel_exclusions` | CustomerNegativeCriterion or CampaignCriterion (negative) YOUTUBE_CHANNEL | campaign level: auto label; account level: none (no label surface) |
| `google_ads_add_ad_group_targeting` | AdGroupCriterion TOPIC / CUSTOM_AUDIENCE | auto label on the new criteria |
| `google_ads_create_custom_audience` | CustomAudienceService (SEARCH / AUTO / INTEREST / PURCHASE_INTENT; keyword + URL members) | none (no label surface) |
| `google_ads_create_lookalike_user_list` | UserList with lookalike_user_list (NARROW / BALANCED / BROAD) | none (no label surface) |
| `google_ads_update_video_inventory` | Campaign video_campaign_settings.video_ad_inventory_control leaves | auto label on campaign |

All six are dry-run by default (`confirm` omitted), and accept `validate_only: true` to send the mutate to Google with validate_only set. That lets each shape be proven against a real campaign before any live write.

## Verified before build

- Language constants (read back from `language_constant`): en 1000, de 1001, fr 1002, es 1003, it 1004, ja 1005, nl 1010, ko 1012, pt 1014, sv 1015, zh_CN 1017, ar 1019, hi 1023, id 1025, pl 1030, tr 1037.
- Topic constants: 5 Computers & Electronics, 77 Computers & Electronics > Enterprise Technology, 12 Business & Industrial, 13 Internet & Telecom.
- Live lookalikes all read `expansion_level: 3`, and the UI default is Balanced. 3 = BALANCED is therefore consistent but not proven; NARROW = 2 and BROAD = 4 are from the enum ordering. Prove it with a validate_only create, then a real create read back, before relying on it.
- Existing custom audience types read 2 (Competitors, a URL list), 3, 4 and 5 (Top AI Searchers). This matches CustomAudienceType AUTO=2, INTEREST=3, PURCHASE_INTENT=4, SEARCH=5.

## Not verified (probe through the MCP after deploy, validate_only first)

1. Video Target CPM reach campaigns accept ad-group TOPIC and CUSTOM_AUDIENCE criteria after creation.
2. `allow_shorts` is mutable after creation on these campaigns.
3. The account may create lookalike user lists and SEARCH custom audiences through the API.
4. Campaign-level negative YOUTUBE_CHANNEL is still accepted. Google has been moving exclusions to account-level exclusion lists.

## Pre-mortem: it failed in two weeks — why?

1. **The approach is wrong.** Language and topic layers cut reach so far that the campaigns can't spend the plan, and CPM jumps above $10.
   - **Early signal:** impressions per day fall >60% within 3 days of the change.
   - **Mitigation:** apply to NAM first, compare 7 days before and after, then roll to the other theaters. The tools don't decide scope; the caller does.
2. **Google accepts the write and then ignores it.** This already happened with video geo writes through Scripts, and with Demand Gen video assets.
   - **Early signal:** read-back shows the criterion, but placements a week later still show the excluded channels or off-language inventory.
   - **Mitigation:** every tool reads back what it wrote in the same call. The verify task also checks group_placement_view after 7 days.
3. **An enum mapping is off by one** (the lookalike expansion level), so a "NARROW" list is created BROAD.
   - **Early signal:** the new list's size is larger than the BALANCED original.
   - **Mitigation:** run validate_only first. After a real create, the tool returns the read-back expansion_level, and the caller compares sizes after the list populates (~24–48h).
4. **The language set is replace-not-add, and wipes a deliberate language set** on a campaign the caller didn't mean to touch.
   - **Early signal:** the dry run lists removals the caller didn't expect.
   - **Mitigation:** the dry-run output names every language to be added and removed. The real write needs `confirm: true`, and `expected_old` can pin the current set.
5. **Third party: Google retires campaign-level channel exclusions** or rejects them on video, leaving half-applied batches.
   - **Early signal:** API error on the campaign-level path.
   - **Mitigation:** account level is the default. Mutates run with partial_failure off, so a batch is all-or-nothing, and the error is surfaced with the campaign name.
