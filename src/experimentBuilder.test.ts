import { describe, it, expect } from "vitest";
import { enums } from "google-ads-api";
import {
  buildExperimentPayload,
  buildControlArmPayload,
  buildTreatmentArmPayload,
  experimentIdFromResourceName,
  campaignIdFromResourceName,
  formatDate,
} from "./experimentBuilder.js";

describe("buildExperimentPayload", () => {
  it("sets SEARCH_CUSTOM type and SETUP status", () => {
    const payload = buildExperimentPayload({
      base_campaign_id: "12345",
      name: "DLP Trial LP Test",
    });
    expect(payload.type).toBe(enums.ExperimentType.SEARCH_CUSTOM);
    expect(payload.status).toBe(enums.ExperimentStatus.SETUP);
  });

  it("arms must be created together in one batch call (API validates sum=100 at mutation time)", () => {
    // Documented constraint: traffic_split values across all arms must sum to 100.
    // The API validates this on every mutation, so both arms must be passed in a
    // single create call — sequential creates would fail (50 alone ≠ 100).
    const expRN = "customers/123/experiments/456";
    const control = buildControlArmPayload(expRN, "customers/123/campaigns/789", 50);
    const treatment = buildTreatmentArmPayload(expRN, 50);
    expect(control.traffic_split + treatment.traffic_split).toBe(100);
  });

  it("defaults suffix to ' [EXP]'", () => {
    const payload = buildExperimentPayload({
      base_campaign_id: "12345",
      name: "My Test",
    });
    expect(payload.suffix).toBe(" [EXP]");
  });

  it("uses custom suffix when provided", () => {
    const payload = buildExperimentPayload({
      base_campaign_id: "12345",
      name: "My Test",
      suffix: " [TRIAL]",
    });
    expect(payload.suffix).toBe(" [TRIAL]");
  });

  it("omits description when not provided", () => {
    const payload = buildExperimentPayload({
      base_campaign_id: "12345",
      name: "My Test",
    });
    expect((payload as any).description).toBeUndefined();
  });

  it("includes description when provided", () => {
    const payload = buildExperimentPayload({
      base_campaign_id: "12345",
      name: "My Test",
      description: "Testing trial LP",
    });
    expect(payload.description).toBe("Testing trial LP");
  });

  it("includes start_date and end_date when provided", () => {
    const payload = buildExperimentPayload({
      base_campaign_id: "12345",
      name: "My Test",
      start_date: "2026-06-05",
      end_date: "2026-07-05",
    });
    expect(payload.start_date).toBe("2026-06-05");
    expect(payload.end_date).toBe("2026-07-05");
  });

  it("omits dates when not provided", () => {
    const payload = buildExperimentPayload({
      base_campaign_id: "12345",
      name: "My Test",
    });
    expect((payload as any).start_date).toBeUndefined();
    expect((payload as any).end_date).toBeUndefined();
  });
});

describe("buildControlArmPayload", () => {
  const expRN = "customers/4948252953/experiments/111";
  const baseCampaignRN = "customers/4948252953/campaigns/22923427830";

  it("sets control=true and assigns campaigns to base campaign", () => {
    const arm = buildControlArmPayload(expRN, baseCampaignRN, 50);
    expect(arm.control).toBe(true);
    expect(arm.campaigns).toEqual([baseCampaignRN]);
    expect(arm.name).toBe("Control");
  });

  it("reflects the traffic_split value", () => {
    const arm = buildControlArmPayload(expRN, baseCampaignRN, 40);
    expect(arm.traffic_split).toBe(40);
  });

  it("sets the experiment resource name", () => {
    const arm = buildControlArmPayload(expRN, baseCampaignRN, 50);
    expect(arm.experiment).toBe(expRN);
  });
});

describe("buildTreatmentArmPayload", () => {
  const expRN = "customers/4948252953/experiments/111";

  it("sets control=false and empty campaigns (Google auto-creates)", () => {
    const arm = buildTreatmentArmPayload(expRN, 50);
    expect(arm.control).toBe(false);
    expect(arm.campaigns).toEqual([]);
    expect(arm.name).toBe("Treatment");
  });

  it("reflects the traffic_split value", () => {
    const arm = buildTreatmentArmPayload(expRN, 60);
    expect(arm.traffic_split).toBe(60);
  });

  it("control + treatment splits sum to 100 for symmetric 50/50", () => {
    const control = buildControlArmPayload(expRN, "customers/123/campaigns/456", 50);
    const treatment = buildTreatmentArmPayload(expRN, 50);
    expect(control.traffic_split + treatment.traffic_split).toBe(100);
  });
});

describe("experimentIdFromResourceName", () => {
  it("extracts numeric id from resource name", () => {
    expect(experimentIdFromResourceName("customers/4948252953/experiments/98765")).toBe("98765");
  });

  it("returns empty string for empty input", () => {
    expect(experimentIdFromResourceName("")).toBe("");
  });
});

describe("campaignIdFromResourceName", () => {
  it("extracts numeric id from campaign resource name", () => {
    expect(campaignIdFromResourceName("customers/4948252953/campaigns/22923427830")).toBe("22923427830");
  });
});

describe("formatDate", () => {
  it("returns YYYY-MM-DD format for a given date", () => {
    const d = new Date("2026-06-05T12:00:00Z");
    expect(formatDate(d)).toBe("2026-06-05");
  });

  it("returns today's date when no argument passed", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(formatDate()).toBe(today);
  });
});
