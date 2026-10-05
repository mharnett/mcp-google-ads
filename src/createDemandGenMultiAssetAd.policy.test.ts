/**
 * Wiring test: createDemandGenMultiAssetAd writes the CLIENT'S declared
 * asset-automation policy, not a hardcoded OFF.
 *
 * The policy module (assetAutomationPolicy.ts) is tested on its own; this
 * drives the real create method so a create path that forgets to call it --
 * or calls it after the ad already exists, so a broken policy file leaves an
 * ad behind -- fails here. Same Object.create() + fake-customer pattern as
 * createResponsiveSearchAd.labels.test.ts.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { GoogleAdsManager } from "./index.js";
import { POLICY_RELATIVE_PATH } from "./assetAutomationPolicy.js";

const CID = "123-456-7890";
const AD_RN = "customers/1234567890/adGroupAds/111~222";

const INPUT = {
  ad_group_id: "111",
  final_urls: ["https://example.com/"],
  business_name: "Example Org",
  call_to_action: "LEARN_MORE",
  marketing_image_asset_ids: ["123"],
  headlines: ["Headline 1", "Headline 2"],
  long_headlines: ["A longer headline that still fits within ninety characters for a DG ad."],
  descriptions: ["Description 1", "Description 2"],
};

function clientFolder(policy?: string) {
  const dir = mkdtempSync(join(tmpdir(), "dgmcp-"));
  if (policy !== undefined) {
    mkdirSync(join(dir, "google_ads", "config"), { recursive: true });
    writeFileSync(join(dir, POLICY_RELATIVE_PATH), policy);
  }
  return dir;
}

function makeManager(folder: string) {
  const ops: any[] = [];
  const customer = {
    async query() {
      return [{ ad_group: { id: 111 }, campaign: { advertising_channel_type: 14 } }];
    },
    async mutateResources(batch: any[]) {
      ops.push(...batch);
      if (batch[0]?.operation === "create") {
        return { mutate_operation_responses: [{ ad_group_ad_result: { resource_name: AD_RN } }] };
      }
      return { mutate_operation_responses: batch.map(() => ({ ad_group_ad_result: { resource_name: AD_RN } })) };
    },
  };
  const mgr: any = Object.create(GoogleAdsManager.prototype);
  mgr.config = {
    google_ads: { mcc_customer_id: "" },
    clients: { c: { customer_id: CID, name: "C", folder } },
    defaults: { create_paused: true, label_prefix: "claude-", require_approval_for_enable: true },
  };
  mgr.getCustomer = () => customer;
  mgr.autoLabelCreated = async () => {};
  mgr.applyCustomLabels = async () => {};
  mgr.ensureLabelExists = async () => "customers/1234567890/labels/1";
  mgr.labelAdGroupAds = async () => {};
  return { mgr, ops };
}

const updates = (ops: any[]) => ops.filter((o) => o.operation === "update");
const written = (op: any) =>
  op.resource.ad_group_ad_asset_automation_settings.map((s: any) => [s.asset_automation_type, s.asset_automation_status]);

describe("createDemandGenMultiAssetAd asset-automation policy", () => {
  it("writes the client's declared mixed policy in ONE update operation", async () => {
    const { mgr, ops } = makeManager(
      clientFolder('google_ads:\n  demand_gen:\n    auto_video: "on"\n    adaptive_layouts: "off"\n')
    );
    const res = await mgr.createDemandGenMultiAssetAd(CID, INPUT);
    const ups = updates(ops);
    expect(ups).toHaveLength(1);
    // AssetAutomationType: 12 = video, 10 = image. Status: 2 = OPTED_IN, 3 = OPTED_OUT.
    expect(written(ups[0]).sort()).toEqual([[10, 3], [12, 2]]);
    expect(res.asset_automation_policy.source).toBe("policy-file");
  });

  it("keeps default-off for a client with no policy file, and says so", async () => {
    const { mgr, ops } = makeManager(clientFolder());
    const res = await mgr.createDemandGenMultiAssetAd(CID, INPUT);
    expect(written(updates(ops)[0]).sort()).toEqual([[10, 3], [12, 3]]);
    expect(res.asset_automation_policy).toMatchObject({ source: "default-off", path: null });
    expect(res.asset_automation_opt_out).toBe("OPTED_OUT");
  });

  it("refuses to create the ad when the policy file is malformed", async () => {
    const { mgr, ops } = makeManager(clientFolder("google_ads:\n  demand_gen:\n    auto_video: maybe\n"));
    await expect(mgr.createDemandGenMultiAssetAd(CID, INPUT)).rejects.toThrow(/policy/i);
    expect(ops).toEqual([]);
  });

  it("writes nothing when both settings are unmanaged", async () => {
    const { mgr, ops } = makeManager(
      clientFolder('google_ads:\n  demand_gen:\n    auto_video: "unmanaged"\n    adaptive_layouts: "unmanaged"\n')
    );
    const res = await mgr.createDemandGenMultiAssetAd(CID, INPUT);
    expect(updates(ops)).toEqual([]);
    expect(res.asset_automation_opt_out).toBe("unmanaged");
  });
});
