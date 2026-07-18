/**
 * Video responsive ad video management — pure helpers.
 *
 * Context: the VIDEO channel is campaign-level locked in the Google Ads API,
 * but AD-level `video_responsive_ad.videos` updates ARE allowed (verified
 * live 2026-07-18 on the Forcepoint Safeguard AI reach ads). These helpers
 * back the google_ads_update_video_ad_videos tool.
 */
import { describe, expect, it } from "vitest";

import {
  buildVideoAdUpdateResource,
  checkYoutubeVisibility,
  parseYoutubeVideoId,
  planVideoUpdate,
  validateYoutubeVideoInputs,
} from "./videoAdVideos.js";

describe("parseYoutubeVideoId", () => {
  it("accepts a bare 11-char video ID", () => {
    expect(parseYoutubeVideoId("6XHNF8-FOi0")).toBe("6XHNF8-FOi0");
  });

  it("parses youtu.be short links", () => {
    expect(parseYoutubeVideoId("https://youtu.be/A-hBSgV5EVc")).toBe("A-hBSgV5EVc");
  });

  it("parses youtu.be links with tracking params", () => {
    expect(parseYoutubeVideoId("https://youtu.be/A-hBSgV5EVc?si=abc123")).toBe("A-hBSgV5EVc");
  });

  it("parses /shorts/ URLs", () => {
    expect(parseYoutubeVideoId("https://youtube.com/shorts/6XHNF8-FOi0")).toBe("6XHNF8-FOi0");
  });

  it("parses watch?v= URLs", () => {
    expect(parseYoutubeVideoId("https://www.youtube.com/watch?v=iEV7VR65btU")).toBe("iEV7VR65btU");
  });

  it("parses /embed/ URLs", () => {
    expect(parseYoutubeVideoId("https://www.youtube.com/embed/iEV7VR65btU")).toBe("iEV7VR65btU");
  });

  it("rejects garbage, wrong-length IDs, and empty input", () => {
    expect(parseYoutubeVideoId("not a video")).toBeNull();
    expect(parseYoutubeVideoId("abc")).toBeNull();
    expect(parseYoutubeVideoId("")).toBeNull();
    expect(parseYoutubeVideoId("https://vimeo.com/12345")).toBeNull();
  });
});

describe("validateYoutubeVideoInputs", () => {
  it("resolves a mix of URLs and bare IDs", () => {
    const r = validateYoutubeVideoInputs([
      "https://youtube.com/shorts/6XHNF8-FOi0",
      "A-hBSgV5EVc",
    ]);
    expect(r.valid).toBe(true);
    expect(r.ids).toEqual(["6XHNF8-FOi0", "A-hBSgV5EVc"]);
    expect(r.errors).toEqual([]);
  });

  it("flags the same video supplied via two URL forms as a duplicate", () => {
    const r = validateYoutubeVideoInputs([
      "https://youtu.be/6XHNF8-FOi0",
      "https://youtube.com/shorts/6XHNF8-FOi0",
    ]);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/duplicate/i);
  });

  it("names the offending entry on parse failure", () => {
    const r = validateYoutubeVideoInputs(["6XHNF8-FOi0", "nope"]);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toContain("nope");
  });

  it("rejects an empty list", () => {
    const r = validateYoutubeVideoInputs([]);
    expect(r.valid).toBe(false);
  });
});

describe("planVideoUpdate", () => {
  const current = ["customers/1/assets/111", "customers/1/assets/222"];

  it("append keeps current order first and adds only new assets", () => {
    const plan = planVideoUpdate(current, ["customers/1/assets/222", "customers/1/assets/333"], "append");
    expect(plan.videos).toEqual([
      "customers/1/assets/111",
      "customers/1/assets/222",
      "customers/1/assets/333",
    ]);
    expect(plan.added).toEqual(["customers/1/assets/333"]);
    expect(plan.skipped_existing).toEqual(["customers/1/assets/222"]);
    expect(plan.unchanged).toBe(false);
  });

  it("append of only already-present assets is a no-op", () => {
    const plan = planVideoUpdate(current, ["customers/1/assets/111"], "append");
    expect(plan.videos).toEqual(current);
    expect(plan.added).toEqual([]);
    expect(plan.unchanged).toBe(true);
  });

  it("replace produces exactly the requested list", () => {
    const plan = planVideoUpdate(current, ["customers/1/assets/333"], "replace");
    expect(plan.videos).toEqual(["customers/1/assets/333"]);
    expect(plan.unchanged).toBe(false);
  });

  it("replace with a list equal to current is a no-op", () => {
    const plan = planVideoUpdate(current, [...current], "replace");
    expect(plan.unchanged).toBe(true);
  });

  // Shape invariants: no duplicates ever, added is always disjoint from current.
  it("never emits duplicate assets and keeps added disjoint from current", () => {
    const plan = planVideoUpdate(current, [
      "customers/1/assets/333",
      "customers/1/assets/333",
      "customers/1/assets/111",
    ], "append");
    expect(new Set(plan.videos).size).toBe(plan.videos.length);
    for (const rn of plan.added) expect(current).not.toContain(rn);
  });
});

describe("buildVideoAdUpdateResource", () => {
  it("targets the ads resource (NOT adGroupAds) with an asset list", () => {
    const resource = buildVideoAdUpdateResource("4948252953", "815638860130", [
      "customers/4948252953/assets/111",
      "customers/4948252953/assets/222",
    ]);
    expect(resource).toEqual({
      resource_name: "customers/4948252953/ads/815638860130",
      video_responsive_ad: {
        videos: [
          { asset: "customers/4948252953/assets/111" },
          { asset: "customers/4948252953/assets/222" },
        ],
      },
    });
  });

  it("strips dashes from the customer ID", () => {
    const resource = buildVideoAdUpdateResource("494-825-2953", "1", ["customers/4948252953/assets/1"]);
    expect(resource.resource_name).toBe("customers/4948252953/ads/1");
  });
});

describe("checkYoutubeVisibility", () => {
  const okFetch = async () =>
    ({ ok: true, status: 200, json: async () => ({ title: "My Video" }) }) as any;
  const forbiddenFetch = async () => ({ ok: false, status: 403 }) as any;
  const failingFetch = async () => {
    throw new Error("network down");
  };

  it("returns visible + title when oEmbed responds 200", async () => {
    const r = await checkYoutubeVisibility("6XHNF8-FOi0", okFetch);
    expect(r.visible).toBe(true);
    expect(r.title).toBe("My Video");
  });

  it("returns visible=false for 401/403 (private video fingerprint)", async () => {
    const r = await checkYoutubeVisibility("6XHNF8-FOi0", forbiddenFetch);
    expect(r.visible).toBe(false);
    expect(r.reason).toMatch(/private|unavailable/i);
  });

  it("is indeterminate (visible=null) on network failure, never throws", async () => {
    const r = await checkYoutubeVisibility("6XHNF8-FOi0", failingFetch);
    expect(r.visible).toBeNull();
  });
});
