import { describe, it, expect } from "vitest";
import { sharedSetLinkWarning } from "./gaqlSharedSetGuard.js";

// GAQL `campaign_shared_set` returns REMOVED links too. A query that reads it
// without an ENABLED-status filter shows lists that were UNLINKED as if still
// attached. On 2026-07-23 that misled a verify agent into reporting a completed
// shared-set swap as "incomplete". This guard warns at query time.
describe("sharedSetLinkWarning", () => {
  it("warns on FROM campaign_shared_set with no status filter", () => {
    const q =
      "SELECT campaign.id, shared_set.name FROM campaign_shared_set WHERE shared_set.id = 12104031556";
    expect(sharedSetLinkWarning(q)).toMatch(/ENABLED/);
  });

  it("is silent when status = 'ENABLED' is present", () => {
    const q =
      "SELECT campaign.id FROM campaign_shared_set WHERE campaign_shared_set.status = 'ENABLED'";
    expect(sharedSetLinkWarning(q)).toBeNull();
  });

  it("is silent when status != 'REMOVED' is present", () => {
    const q =
      "SELECT campaign.id FROM campaign_shared_set WHERE campaign_shared_set.status != 'REMOVED'";
    expect(sharedSetLinkWarning(q)).toBeNull();
  });

  it("is silent for unrelated resources", () => {
    const q = "SELECT campaign.id, campaign.name FROM campaign WHERE campaign.status = 'ENABLED'";
    expect(sharedSetLinkWarning(q)).toBeNull();
  });

  it("is case- and whitespace-insensitive", () => {
    const q = "select campaign.id\n  from   campaign_shared_set\n  order by campaign.name";
    expect(sharedSetLinkWarning(q)).toMatch(/campaign_shared_set/);
  });

  it("accepts a status IN (...) filter that includes ENABLED", () => {
    const q =
      "SELECT campaign.id FROM campaign_shared_set WHERE campaign_shared_set.status IN ('ENABLED')";
    expect(sharedSetLinkWarning(q)).toBeNull();
  });

  it("does not false-positive on 'shared_set' text outside a campaign_shared_set FROM", () => {
    const q = "SELECT shared_set.id, shared_set.name FROM shared_set";
    expect(sharedSetLinkWarning(q)).toBeNull();
  });
});
