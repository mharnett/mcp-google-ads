import { describe, it, expect } from "vitest";
import {
  LANGUAGE_CONSTANTS,
  resolveLanguageCodes,
  planLanguageChanges,
  buildYouTubeChannelExclusions,
  buildAdGroupTargetingCriteria,
  buildCustomAudience,
  buildLookalikeUserList,
  LOOKALIKE_EXPANSION_LEVEL,
  buildVideoInventoryUpdate,
} from "./videoTargeting.js";

const CID = "9876543210";
const CAMP = `customers/${CID}/campaigns/111`;
const AG = `customers/${CID}/adGroups/222`;
const ARY = "UC4JCksJF76g_MdzPVBJoC3Q";

describe("resolveLanguageCodes", () => {
  it("maps verified codes to languageConstants resource names", () => {
    expect(resolveLanguageCodes(["en", "de", "ar"])).toEqual([
      "languageConstants/1000",
      "languageConstants/1001",
      "languageConstants/1019",
    ]);
  });
  it("accepts a raw numeric constant id", () => {
    expect(resolveLanguageCodes(["1037"])).toEqual(["languageConstants/1037"]);
  });
  it("de-duplicates", () => {
    expect(resolveLanguageCodes(["en", "EN", "1000"])).toEqual(["languageConstants/1000"]);
  });
  it("rejects an unknown code instead of guessing", () => {
    expect(() => resolveLanguageCodes(["xx"])).toThrow(/xx/);
  });
  it("rejects an empty list (an empty set would mean all languages)", () => {
    expect(() => resolveLanguageCodes([])).toThrow();
  });
  it("pins the verified constants", () => {
    expect(LANGUAGE_CONSTANTS.en).toBe(1000);
    expect(LANGUAGE_CONSTANTS.pt).toBe(1014);
    expect(LANGUAGE_CONSTANTS.tr).toBe(1037);
  });
});

describe("planLanguageChanges", () => {
  const existing = [
    { resource_name: `customers/${CID}/campaignCriteria/111~5`, language_constant: "languageConstants/1003" },
    { resource_name: `customers/${CID}/campaignCriteria/111~6`, language_constant: "languageConstants/1000" },
  ];
  it("creates missing and removes extra languages (replace semantics)", () => {
    const p = planLanguageChanges(CAMP, existing, ["languageConstants/1000", "languageConstants/1001"]);
    expect(p.create).toEqual([{ campaign: CAMP, language: { language_constant: "languageConstants/1001" } }]);
    expect(p.remove).toEqual([`customers/${CID}/campaignCriteria/111~5`]);
  });
  it("is a no-op when the set already matches", () => {
    const p = planLanguageChanges(CAMP, existing, ["languageConstants/1003", "languageConstants/1000"]);
    expect(p.create).toEqual([]);
    expect(p.remove).toEqual([]);
  });
  it("from no languages (all languages) creates every wanted one and removes nothing", () => {
    const p = planLanguageChanges(CAMP, [], ["languageConstants/1000"]);
    expect(p.create).toHaveLength(1);
    expect(p.remove).toEqual([]);
  });
});

describe("buildYouTubeChannelExclusions", () => {
  it("account level builds customer negative criteria with no campaign field", () => {
    const ops = buildYouTubeChannelExclusions({ level: "account" }, [ARY], []);
    expect(ops).toEqual([{ youtube_channel: { channel_id: ARY } }]);
  });
  it("campaign level builds negative campaign criteria", () => {
    const ops = buildYouTubeChannelExclusions({ level: "campaign", campaign: CAMP }, [ARY], []);
    expect(ops).toEqual([{ campaign: CAMP, negative: true, youtube_channel: { channel_id: ARY } }]);
  });
  it("skips channels already excluded and duplicates in the input", () => {
    const other = "UCEeEQxm6qc_qaTE7qTV5aLQ";
    const ops = buildYouTubeChannelExclusions({ level: "account" }, [ARY, other, other], [ARY]);
    expect(ops).toEqual([{ youtube_channel: { channel_id: other } }]);
  });
  it("rejects a malformed channel id", () => {
    expect(() => buildYouTubeChannelExclusions({ level: "account" }, ["ARY Digital"], [])).toThrow(/channel id/i);
  });
  it("accepts the 90_ prefixed id from group_placement_view and strips the prefix", () => {
    const ops = buildYouTubeChannelExclusions({ level: "account" }, [`90_${ARY}`], []);
    expect(ops).toEqual([{ youtube_channel: { channel_id: ARY } }]);
  });
  it("campaign level without a campaign throws", () => {
    expect(() => buildYouTubeChannelExclusions({ level: "campaign" } as any, [ARY], [])).toThrow();
  });
});

describe("buildAdGroupTargetingCriteria", () => {
  it("builds ENABLED topic and custom audience criteria", () => {
    const ops = buildAdGroupTargetingCriteria(AG, CID, { topic_ids: ["77"], custom_audience_ids: ["1006445559"] });
    expect(ops).toEqual([
      { ad_group: AG, status: 2, topic: { topic_constant: "topicConstants/77" } },
      { ad_group: AG, status: 2, custom_audience: { custom_audience: `customers/${CID}/customAudiences/1006445559` } },
    ]);
  });
  it("requires at least one criterion", () => {
    expect(() => buildAdGroupTargetingCriteria(AG, CID, {})).toThrow();
  });
  it("rejects non-numeric ids", () => {
    expect(() => buildAdGroupTargetingCriteria(AG, CID, { topic_ids: ["Enterprise"] })).toThrow();
  });
});

describe("buildCustomAudience", () => {
  it("builds a SEARCH audience with keyword members", () => {
    const a = buildCustomAudience({ name: "DLP buyers", type: "SEARCH", keywords: ["data loss prevention", "dspm"] });
    expect(a).toEqual({
      name: "DLP buyers",
      type: 5,
      status: 2,
      members: [
        { member_type: 2, keyword: "data loss prevention" },
        { member_type: 2, keyword: "dspm" },
      ],
    });
  });
  it("builds AUTO with keywords and URLs", () => {
    const a = buildCustomAudience({ name: "x", type: "AUTO", keywords: ["casb"], urls: ["netskope.com"] });
    expect(a.type).toBe(2);
    expect(a.members).toEqual([
      { member_type: 2, keyword: "casb" },
      { member_type: 3, url: "netskope.com" },
    ]);
  });
  it("rejects URLs on a SEARCH audience (search segments are search terms only)", () => {
    expect(() => buildCustomAudience({ name: "x", type: "SEARCH", keywords: ["a"], urls: ["b.com"] })).toThrow(/SEARCH/);
  });
  it("requires a name and at least one member", () => {
    expect(() => buildCustomAudience({ name: "", type: "SEARCH", keywords: ["a"] })).toThrow();
    expect(() => buildCustomAudience({ name: "x", type: "SEARCH", keywords: [] })).toThrow();
  });
  it("rejects an unknown type", () => {
    expect(() => buildCustomAudience({ name: "x", type: "BOGUS" as any, keywords: ["a"] })).toThrow();
  });
});

describe("buildLookalikeUserList", () => {
  it("builds a NARROW lookalike from seed lists", () => {
    const u = buildLookalikeUserList(CID, { name: "NAM Strong Fit LaL Narrow", seed_user_list_ids: ["9374900393"], expansion_level: "NARROW", country_codes: ["us", "CA"] });
    expect(u).toEqual({
      name: "NAM Strong Fit LaL Narrow",
      lookalike_user_list: {
        // v24 LookalikeUserListInfo.seed_user_list_ids is int64[]; an unknown key
        // (e.g. seed_user_lists) is dropped by the client and Google sees zero seeds.
        seed_user_list_ids: [9374900393],
        expansion_level: 2,
        country_codes: ["US", "CA"],
      },
    });
  });
  it("maps the three expansion levels", () => {
    expect(LOOKALIKE_EXPANSION_LEVEL).toEqual({ NARROW: 2, BALANCED: 3, BROAD: 4 });
  });
  it("rejects a bad country code and an empty seed", () => {
    expect(() => buildLookalikeUserList(CID, { name: "x", seed_user_list_ids: ["1"], expansion_level: "NARROW", country_codes: ["USA"] })).toThrow();
    expect(() => buildLookalikeUserList(CID, { name: "x", seed_user_list_ids: [], expansion_level: "NARROW", country_codes: ["US"] })).toThrow();
  });
});

describe("buildVideoInventoryUpdate", () => {
  it("emits only the leaves passed (field mask safety)", () => {
    const u = buildVideoInventoryUpdate(CAMP, { allow_shorts: false });
    expect(u).toEqual({ resource_name: CAMP, video_campaign_settings: { video_ad_inventory_control: { allow_shorts: false } } });
  });
  it("requires at least one setting", () => {
    expect(() => buildVideoInventoryUpdate(CAMP, {})).toThrow();
  });
  it("refuses turning every format off", () => {
    expect(() => buildVideoInventoryUpdate(CAMP, { allow_shorts: false, allow_in_feed: false, allow_in_stream: false })).toThrow(/at least one/i);
  });
  it("rejects non-boolean values", () => {
    expect(() => buildVideoInventoryUpdate(CAMP, { allow_shorts: "no" as any })).toThrow();
  });
});
