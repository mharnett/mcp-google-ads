// Pure planner for recommendation subscription (Recommendations > Auto-apply)
// mutations. A subscription is keyed by recommendation type: its resource name
// is customers/{cid}/recommendationSubscriptions/{RecommendationType enum}.
// "Untick" in the UI = status PAUSED; "tick" = ENABLED.
import { enums } from "google-ads-api";

export type SubscriptionStatus = "ENABLED" | "PAUSED";
const STATUS_ENUM: Record<SubscriptionStatus, number> = { ENABLED: 2, PAUSED: 3 };

export function recommendationTypeEnum(name: string): number {
  const v = (enums.RecommendationType as any)?.[name];
  if (typeof v !== "number" || name === "UNSPECIFIED" || name === "UNKNOWN") {
    throw new Error(`Unsupported recommendation type: ${name}`);
  }
  return v;
}

export interface SubscriptionPlan {
  updates: Array<{ resource_name: string; status: number }>;
  creates: Array<{ type: number; status: number }>;
  noops: Array<{ type: string; reason: string }>;
}

/** `existing` maps RecommendationType enum value -> current status name. */
export function planRecommendationSubscriptionChanges(
  customerIdClean: string,
  types: string[],
  status: SubscriptionStatus,
  existing: Map<number, string>
): SubscriptionPlan {
  if (!types || types.length === 0) throw new Error("At least one recommendation type is required.");
  if (!(status in STATUS_ENUM)) throw new Error(`status must be ENABLED or PAUSED, got ${status}`);
  const plan: SubscriptionPlan = { updates: [], creates: [], noops: [] };
  for (const name of types) {
    const t = recommendationTypeEnum(name);
    const current = existing.get(t);
    if (current === undefined) {
      if (status === "PAUSED") plan.noops.push({ type: name, reason: "no subscription exists" });
      else plan.creates.push({ type: t, status: STATUS_ENUM[status] });
    } else if (current === status) {
      plan.noops.push({ type: name, reason: `already ${status}` });
    } else {
      plan.updates.push({
        resource_name: `customers/${customerIdClean}/recommendationSubscriptions/${t}`,
        status: STATUS_ENUM[status],
      });
    }
  }
  return plan;
}
