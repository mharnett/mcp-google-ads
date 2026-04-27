import { enums } from "google-ads-api";

// ============================================
// TYPES
// ============================================

export interface ExperimentCreateInput {
  base_campaign_id: string;
  name: string;
  description?: string;
  /** Suffix appended to the auto-created treatment campaign name. Defaults to " [EXP]" */
  suffix?: string;
  /** Percent of traffic sent to treatment arm (1–99). Defaults to 50. */
  traffic_split_percent?: number;
  start_date?: string; // YYYY-MM-DD
  end_date?: string;   // YYYY-MM-DD
}

export interface ExperimentArmPayload {
  experiment: string;    // experiment resource name
  name: string;
  control: boolean;
  traffic_split: number;
  campaigns: string[];   // campaign resource names (base for control, empty for treatment)
}

export interface ExperimentPayload {
  name: string;
  description?: string;
  suffix: string;
  type: number;   // ExperimentType.SEARCH_CUSTOM
  status: number; // ExperimentStatus.SETUP
  start_date?: string;
  end_date?: string;
}

// ============================================
// PURE BUILDERS (testable without API client)
// ============================================

export function buildExperimentPayload(input: ExperimentCreateInput): ExperimentPayload {
  return {
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    suffix: input.suffix ?? " [EXP]",
    type: enums.ExperimentType.SEARCH_CUSTOM, // 7
    status: enums.ExperimentStatus.SETUP,     // 6
...(input.start_date ? { start_date: input.start_date } : {}),
    ...(input.end_date ? { end_date: input.end_date } : {}),
  };
}

export function buildControlArmPayload(
  experimentResourceName: string,
  baseCampaignResourceName: string,
  trafficSplit: number,
): ExperimentArmPayload {
  return {
    experiment: experimentResourceName,
    name: "Control",
    control: true,
    traffic_split: trafficSplit,
    campaigns: [baseCampaignResourceName],
  };
}

export function buildTreatmentArmPayload(
  experimentResourceName: string,
  trafficSplit: number,
): ExperimentArmPayload {
  return {
    experiment: experimentResourceName,
    name: "Treatment",
    control: false,
    traffic_split: trafficSplit,
    campaigns: [], // Google auto-creates a copy of the base campaign
  };
}

/** Format YYYY-MM-DD from a Date (or today). */
export function formatDate(d?: Date): string {
  const dt = d ?? new Date();
  return dt.toISOString().slice(0, 10);
}

/** Parse an experiment resource name and return the numeric experiment id. */
export function experimentIdFromResourceName(resourceName: string): string {
  return resourceName.split("/").pop() ?? "";
}

/** Parse a campaign resource name and return the numeric campaign id. */
export function campaignIdFromResourceName(resourceName: string): string {
  return resourceName.split("/").pop() ?? "";
}
