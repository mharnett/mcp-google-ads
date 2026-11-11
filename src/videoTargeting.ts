// Pure builders for YouTube / video targeting mutates: campaign languages,
// YouTube channel exclusions, ad-group topic + custom-audience targeting,
// custom audiences, lookalike user lists, and video ad inventory controls.
// No I/O here; index.ts reads current state, calls these, and mutates.

/** Verified against language_constant on 2026-11-11. */
export const LANGUAGE_CONSTANTS: Readonly<Record<string, number>> = {
  en: 1000, de: 1001, fr: 1002, es: 1003, it: 1004, ja: 1005, nl: 1010, ko: 1012,
  pt: 1014, sv: 1015, zh_cn: 1017, ar: 1019, hi: 1023, id: 1025, pl: 1030, tr: 1037,
};

const NUMERIC = /^\d+$/;
const LANGUAGE_CODE_LIST = Object.keys(LANGUAGE_CONSTANTS).join(", ");

/** Language codes or raw numeric constant ids → languageConstants/N, de-duplicated. */
export function resolveLanguageCodes(codes: string[]): string[] {
  if (!Array.isArray(codes) || codes.length === 0) {
    throw new Error("At least one language is required (an empty set means all languages; to clear, remove the criteria instead).");
  }
  const out: string[] = [];
  for (const raw of codes) {
    const c = String(raw).trim();
    let id: number | undefined;
    if (NUMERIC.test(c)) id = Number(c);
    else id = LANGUAGE_CONSTANTS[c.toLowerCase()];
    if (id === undefined) {
      throw new Error(`Unknown language code "${c}". Use one of ${LANGUAGE_CODE_LIST} or a numeric languageConstant id.`);
    }
    const rn = `languageConstants/${id}`;
    if (!out.includes(rn)) out.push(rn);
  }
  return out;
}

export interface ExistingLanguageCriterion {
  resource_name: string;
  language_constant: string;
}

/** Replace semantics: create wanted-but-missing, remove present-but-unwanted. */
export function planLanguageChanges(
  campaignResourceName: string,
  existing: ExistingLanguageCriterion[],
  wanted: string[]
): { create: Record<string, any>[]; remove: string[] } {
  const have = new Set(existing.map((e) => e.language_constant));
  const want = new Set(wanted);
  return {
    create: wanted
      .filter((w) => !have.has(w))
      .map((w) => ({ campaign: campaignResourceName, language: { language_constant: w } })),
    remove: existing.filter((e) => !want.has(e.language_constant)).map((e) => e.resource_name),
  };
}

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

export type ExclusionTarget = { level: "account" } | { level: "campaign"; campaign: string };

/** Normalize a channel id; accepts the `90_` prefix group_placement_view uses. */
export function normalizeChannelId(raw: string): string {
  const id = String(raw).trim().replace(/^90_/, "");
  if (!CHANNEL_ID.test(id)) {
    throw new Error(`Invalid YouTube channel id "${raw}". Expected UC followed by 22 characters.`);
  }
  return id;
}

export function buildYouTubeChannelExclusions(
  target: ExclusionTarget,
  channelIds: string[],
  alreadyExcluded: string[]
): Record<string, any>[] {
  if (target.level === "campaign" && !(target as any).campaign) {
    throw new Error("campaign level requires a campaign resource name.");
  }
  if (target.level !== "account" && target.level !== "campaign") {
    throw new Error(`level must be "account" or "campaign".`);
  }
  const skip = new Set(alreadyExcluded.map((c) => c.replace(/^90_/, "")));
  const seen = new Set<string>();
  const ops: Record<string, any>[] = [];
  for (const raw of channelIds) {
    const id = normalizeChannelId(raw);
    if (skip.has(id) || seen.has(id)) continue;
    seen.add(id);
    ops.push(
      target.level === "account"
        ? { youtube_channel: { channel_id: id } }
        : { campaign: target.campaign, negative: true, youtube_channel: { channel_id: id } }
    );
  }
  return ops;
}

export interface AdGroupTargetingInput {
  topic_ids?: string[];
  custom_audience_ids?: string[];
}

/** Positive ENABLED (status 2) topic and custom-audience criteria. */
export function buildAdGroupTargetingCriteria(
  adGroupResourceName: string,
  customerId: string,
  input: AdGroupTargetingInput
): Record<string, any>[] {
  const topics = input.topic_ids ?? [];
  const audiences = input.custom_audience_ids ?? [];
  if (topics.length + audiences.length === 0) {
    throw new Error("Pass at least one of topic_ids or custom_audience_ids.");
  }
  for (const id of [...topics, ...audiences]) {
    if (!NUMERIC.test(String(id))) throw new Error(`Expected a numeric id, got "${id}".`);
  }
  const cid = customerId.replace(/-/g, "");
  return [
    ...topics.map((t) => ({ ad_group: adGroupResourceName, status: 2, topic: { topic_constant: `topicConstants/${t}` } })),
    ...audiences.map((a) => ({
      ad_group: adGroupResourceName,
      status: 2,
      custom_audience: { custom_audience: `customers/${cid}/customAudiences/${a}` },
    })),
  ];
}

/** CustomAudienceType enum values (AUTO=2 matches existing URL-list audiences). */
export const CUSTOM_AUDIENCE_TYPE: Readonly<Record<string, number>> = {
  AUTO: 2,
  INTEREST: 3,
  PURCHASE_INTENT: 4,
  SEARCH: 5,
};

const CUSTOM_AUDIENCE_TYPE_LIST = Object.keys(CUSTOM_AUDIENCE_TYPE).join(", ");

export interface CustomAudienceInput {
  name: string;
  type: "AUTO" | "INTEREST" | "PURCHASE_INTENT" | "SEARCH";
  keywords?: string[];
  urls?: string[];
  description?: string;
}

export function buildCustomAudience(input: CustomAudienceInput): Record<string, any> {
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("name is required.");
  const type = CUSTOM_AUDIENCE_TYPE[input.type];
  if (type === undefined) {
    throw new Error(`type must be one of ${CUSTOM_AUDIENCE_TYPE_LIST}.`);
  }
  const keywords = (input.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const urls = (input.urls ?? []).map((u) => u.trim()).filter(Boolean);
  if (input.type === "SEARCH" && urls.length > 0) {
    throw new Error("A SEARCH custom audience takes search terms only; pass URLs on an AUTO audience.");
  }
  if (keywords.length + urls.length === 0) throw new Error("At least one keyword or URL is required.");
  const out: Record<string, any> = {
    name,
    type,
    status: 2,
    members: [
      ...keywords.map((k) => ({ member_type: 2, keyword: k })),
      ...urls.map((u) => ({ member_type: 3, url: u })),
    ],
  };
  if (input.description) out.description = input.description;
  return out;
}

/** LookalikeExpansionLevel. 3 = BALANCED matches every live list (UI default). */
export const LOOKALIKE_EXPANSION_LEVEL: Readonly<Record<string, number>> = {
  NARROW: 2,
  BALANCED: 3,
  BROAD: 4,
};

export interface LookalikeInput {
  name: string;
  seed_user_list_ids: string[];
  expansion_level: "NARROW" | "BALANCED" | "BROAD";
  country_codes: string[];
}

export function buildLookalikeUserList(customerId: string, input: LookalikeInput): Record<string, any> {
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("name is required.");
  const level = LOOKALIKE_EXPANSION_LEVEL[input.expansion_level];
  if (level === undefined) throw new Error("expansion_level must be NARROW, BALANCED or BROAD.");
  if (!input.seed_user_list_ids?.length) throw new Error("At least one seed user list is required.");
  for (const id of input.seed_user_list_ids) {
    if (!NUMERIC.test(String(id))) throw new Error(`Seed user list id must be numeric, got "${id}".`);
  }
  if (!input.country_codes?.length) throw new Error("At least one country code is required.");
  const countries = input.country_codes.map((c) => String(c).trim().toUpperCase());
  for (const c of countries) {
    if (!/^[A-Z]{2}$/.test(c)) throw new Error(`Country code must be ISO 3166-1 alpha-2, got "${c}".`);
  }
  const cid = customerId.replace(/-/g, "");
  return {
    name,
    lookalike_user_list: {
      seed_user_lists: input.seed_user_list_ids.map((id) => `customers/${cid}/userLists/${id}`),
      expansion_level: level,
      country_codes: countries,
    },
  };
}

export interface VideoInventoryInput {
  allow_shorts?: boolean;
  allow_in_feed?: boolean;
  allow_in_stream?: boolean;
}

/** Only the named leaves are emitted, so the derived field mask touches nothing else. */
export function buildVideoInventoryUpdate(resourceName: string, input: VideoInventoryInput): Record<string, any> {
  const keys = ["allow_shorts", "allow_in_feed", "allow_in_stream"] as const;
  const control: Record<string, boolean> = {};
  for (const k of keys) {
    const v = input[k];
    if (v === undefined) continue;
    if (typeof v !== "boolean") throw new Error(`${k} must be a boolean, got ${typeof v}.`);
    control[k] = v;
  }
  if (Object.keys(control).length === 0) {
    throw new Error("Pass at least one of allow_shorts, allow_in_feed, allow_in_stream.");
  }
  if (keys.every((k) => control[k] === false)) {
    throw new Error("Refusing to turn every format off: at least one of Shorts, in-feed, in-stream must stay on.");
  }
  return { resource_name: resourceName, video_campaign_settings: { video_ad_inventory_control: control } };
}
