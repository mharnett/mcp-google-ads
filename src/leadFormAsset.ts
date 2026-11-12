/**
 * Pure helpers for google_ads_create_lead_form_asset. Separated from the
 * manager so validation logic (required fields, enum membership, char limits)
 * can be unit tested without touching the Google Ads API.
 *
 * v2 (2026-11-11): FIRST_NAME/LAST_NAME, predefined qualifying questions
 * (COMPANY_SIZE, JOB_DEPARTMENT, ...), custom questions (single choice, or
 * free text when no answers are given) and webhook delivery_methods. The
 * webhook is create-only (this tool never edits an existing form) and the
 * google_secret is never echoed in results.
 */
import { enums } from "google-ads-api";

export const LEAD_FORM_CALL_TO_ACTION_TYPES = [
  "LEARN_MORE",
  "GET_QUOTE",
  "APPLY_NOW",
  "SIGN_UP",
  "CONTACT_US",
  "SUBSCRIBE",
  "DOWNLOAD",
  "BOOK_NOW",
  "GET_OFFER",
  "REGISTER",
  "GET_INFO",
  "REQUEST_DEMO",
  "JOIN_NOW",
  "GET_STARTED",
] as const;

export const LEAD_FORM_POST_SUBMIT_CTA_TYPES = [
  "VISIT_SITE",
  "DOWNLOAD",
  "LEARN_MORE",
  "SHOP_NOW",
] as const;

export const LEAD_FORM_DESIRED_INTENTS = ["LOW_INTENT", "HIGH_INTENT"] as const;

export const LEAD_FORM_FIELD_TYPES = [
  "FULL_NAME",
  "EMAIL",
  "PHONE_NUMBER",
  "POSTAL_CODE",
  "STREET_ADDRESS",
  "CITY",
  "REGION",
  "COUNTRY",
  "WORK_EMAIL",
  "COMPANY_NAME",
  "WORK_PHONE",
  "JOB_TITLE",
  "FIRST_NAME",
  "LAST_NAME",
] as const;

/** Google's predefined qualifying questions that fit B2B forms. */
export const LEAD_FORM_QUALIFYING_TYPES = [
  "COMPANY_SIZE",
  "ANNUAL_SALES",
  "YEARS_IN_BUSINESS",
  "JOB_DEPARTMENT",
  "JOB_ROLE",
  "JOB_INDUSTRY",
  "PURCHASE_TIMELINE",
] as const;

export type LeadFormCallToActionType = (typeof LEAD_FORM_CALL_TO_ACTION_TYPES)[number];
export type LeadFormPostSubmitCallToActionType = (typeof LEAD_FORM_POST_SUBMIT_CTA_TYPES)[number];
export type LeadFormDesiredIntent = (typeof LEAD_FORM_DESIRED_INTENTS)[number];
export type LeadFormFieldType = (typeof LEAD_FORM_FIELD_TYPES)[number];
export type LeadFormQualifyingType = (typeof LEAD_FORM_QUALIFYING_TYPES)[number];

export interface LeadFormQualifyingQuestion {
  type: LeadFormQualifyingType;
  /** 2-12 single-choice answers; omit for Google's default answer format. */
  answers?: string[];
}

export interface LeadFormCustomQuestion {
  text: string;
  /** 2-12 single-choice answers; omit for a free-text (short answer) question. */
  answers?: string[];
}

export interface LeadFormWebhook {
  url: string;
  google_secret: string;
  payload_schema_version?: number;
}

export interface LeadFormInput {
  name: string;
  business_name: string;
  call_to_action: LeadFormCallToActionType;
  call_to_action_description: string;
  headline: string;
  description: string;
  privacy_policy_url: string;
  privacy_policy_text?: string;
  final_urls: string[];
  post_submit_headline: string;
  post_submit_description: string;
  post_submit_call_to_action: LeadFormPostSubmitCallToActionType;
  desired_intent?: LeadFormDesiredIntent;
  fields: LeadFormFieldType[];
  background_image_asset_id?: string;
  qualifying_questions?: LeadFormQualifyingQuestion[];
  custom_questions?: LeadFormCustomQuestion[];
  webhook?: LeadFormWebhook;
}

export interface LeadFormValidationResult {
  valid: boolean;
  errors: string[];
}

const MAX_BUSINESS_NAME = 25;
const MAX_HEADLINE = 30;
const MAX_DESCRIPTION = 200;
const MAX_CTA_DESC = 30;
const MAX_POST_SUBMIT_HEADLINE = 25;
const MAX_POST_SUBMIT_DESCRIPTION = 200;

function isHttpsUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateLeadFormInput(input: LeadFormInput): LeadFormValidationResult {
  const errors: string[] = [];

  if (!input.name?.trim()) errors.push("name is required");

  if (!input.business_name?.trim()) {
    errors.push("business_name is required");
  } else if (input.business_name.length > MAX_BUSINESS_NAME) {
    errors.push(`business_name exceeds ${MAX_BUSINESS_NAME} chars`);
  }

  if (!input.call_to_action) {
    errors.push("call_to_action is required");
  } else if (!LEAD_FORM_CALL_TO_ACTION_TYPES.includes(input.call_to_action)) {
    errors.push(
      `call_to_action must be one of: ${LEAD_FORM_CALL_TO_ACTION_TYPES.join(", ")}`
    );
  }

  if (!input.call_to_action_description?.trim()) {
    errors.push("call_to_action_description is required");
  } else if (input.call_to_action_description.length > MAX_CTA_DESC) {
    errors.push(`call_to_action_description exceeds ${MAX_CTA_DESC} chars`);
  }

  if (!input.headline?.trim()) {
    errors.push("headline is required");
  } else if (input.headline.length > MAX_HEADLINE) {
    errors.push(`headline exceeds ${MAX_HEADLINE} chars`);
  }

  if (!input.description?.trim()) {
    errors.push("description is required");
  } else if (input.description.length > MAX_DESCRIPTION) {
    errors.push(`description exceeds ${MAX_DESCRIPTION} chars`);
  }

  if (!input.privacy_policy_url?.trim()) {
    errors.push("privacy_policy_url is required");
  } else if (!isHttpsUrl(input.privacy_policy_url)) {
    errors.push("privacy_policy_url must be a valid https:// URL");
  }

  if (!input.final_urls || input.final_urls.length === 0) {
    errors.push("final_urls is required (non-empty array of https:// URLs)");
  } else {
    for (const u of input.final_urls) {
      if (!isHttpsUrl(u)) {
        errors.push(`final_urls entry must be a valid https:// URL: ${u}`);
      }
    }
  }

  if (!input.post_submit_headline?.trim()) {
    errors.push("post_submit_headline is required");
  } else if (input.post_submit_headline.length > MAX_POST_SUBMIT_HEADLINE) {
    errors.push(`post_submit_headline exceeds ${MAX_POST_SUBMIT_HEADLINE} chars`);
  }

  if (!input.post_submit_description?.trim()) {
    errors.push("post_submit_description is required");
  } else if (input.post_submit_description.length > MAX_POST_SUBMIT_DESCRIPTION) {
    errors.push(
      `post_submit_description exceeds ${MAX_POST_SUBMIT_DESCRIPTION} chars`
    );
  }

  if (!input.post_submit_call_to_action) {
    errors.push("post_submit_call_to_action is required");
  } else if (
    !LEAD_FORM_POST_SUBMIT_CTA_TYPES.includes(input.post_submit_call_to_action)
  ) {
    errors.push(
      `post_submit_call_to_action must be one of: ${LEAD_FORM_POST_SUBMIT_CTA_TYPES.join(", ")}`
    );
  }

  if (input.desired_intent && !LEAD_FORM_DESIRED_INTENTS.includes(input.desired_intent)) {
    errors.push(
      `desired_intent must be one of: ${LEAD_FORM_DESIRED_INTENTS.join(", ")}`
    );
  }

  if (!input.fields || input.fields.length === 0) {
    errors.push("fields must include at least one field type");
  } else {
    const seen = new Set<string>();
    for (const f of input.fields) {
      if (!LEAD_FORM_FIELD_TYPES.includes(f)) {
        errors.push(
          `Unknown field type "${f}". Allowed: ${LEAD_FORM_FIELD_TYPES.join(", ")}`
        );
      }
      if (seen.has(f)) {
        errors.push(`Duplicate field type: ${f}`);
      }
      seen.add(f);
    }
    // EMAIL or WORK_EMAIL is required by Google for any lead form to function.
    if (!input.fields.includes("EMAIL") && !input.fields.includes("WORK_EMAIL")) {
      errors.push("fields must include EMAIL or WORK_EMAIL");
    }
  }

  if (input.qualifying_questions) {
    const seenQ = new Set<string>();
    for (const q of input.qualifying_questions) {
      if (!LEAD_FORM_QUALIFYING_TYPES.includes(q.type)) {
        errors.push(
          `Unknown qualifying question type "${q.type}". Allowed: ${LEAD_FORM_QUALIFYING_TYPES.join(", ")}`
        );
      }
      if (seenQ.has(q.type)) errors.push(`Duplicate qualifying question: ${q.type}`);
      seenQ.add(q.type);
      if (q.answers !== undefined) checkAnswers(q.answers, `qualifying question ${q.type}`, errors);
    }
  }

  if (input.custom_questions) {
    for (const q of input.custom_questions) {
      if (!q.text?.trim()) {
        errors.push("custom question text is required");
        continue;
      }
      if (q.answers !== undefined) checkAnswers(q.answers, `custom question "${q.text}"`, errors);
    }
  }

  if (input.qualifying_questions?.length && input.custom_questions?.length) {
    errors.push(
      "qualifying_questions cannot be combined with custom_questions on one form (Google: LEAD_FORM_LEGACY_QUALIFYING_QUESTIONS_DISALLOWED). Use custom_questions for all of them."
    );
  }

  if (input.webhook) {
    if (!input.webhook.url || !isHttpsUrl(input.webhook.url)) {
      errors.push("webhook.url must be a valid https:// URL");
    }
    if (!input.webhook.google_secret?.trim()) {
      errors.push("webhook.google_secret is required when a webhook is set");
    }
  }

  return { valid: errors.length === 0, errors };
}

function checkAnswers(answers: string[], label: string, errors: string[]): void {
  if (answers.length < 2 || answers.length > 12) {
    errors.push(`${label} must have between 2 and 12 answers (got ${answers.length})`);
  }
  const seen = new Set<string>();
  for (const a of answers) {
    if (!a?.trim()) {
      errors.push(`${label} has an empty answer`);
      continue;
    }
    if (seen.has(a)) errors.push(`${label} has a duplicate answer: ${a}`);
    seen.add(a);
  }
}

const CTA_ENUM = enums.LeadFormCallToActionType as unknown as Record<string, number>;
const POST_CTA_ENUM = enums.LeadFormPostSubmitCallToActionType as unknown as Record<string, number>;
const INTENT_ENUM = enums.LeadFormDesiredIntent as unknown as Record<string, number>;
const FIELD_ENUM = enums.LeadFormFieldUserInputType as unknown as Record<string, number>;

/** Pure: build the lead_form_asset payload. Assumes validateLeadFormInput passed. */
export function buildLeadFormAssetPayload(input: LeadFormInput, cleanCustomerId: string): any {
  const fields: any[] = input.fields.map((f) => ({ input_type: FIELD_ENUM[f] }));
  for (const q of input.qualifying_questions ?? []) {
    fields.push(
      q.answers
        ? { input_type: FIELD_ENUM[q.type], single_choice_answers: { answers: q.answers } }
        : { input_type: FIELD_ENUM[q.type] }
    );
  }

  const payload: any = {
    business_name: input.business_name,
    call_to_action_type: CTA_ENUM[input.call_to_action],
    call_to_action_description: input.call_to_action_description,
    headline: input.headline,
    description: input.description,
    privacy_policy_url: input.privacy_policy_url,
    post_submit_headline: input.post_submit_headline,
    post_submit_description: input.post_submit_description,
    post_submit_call_to_action_type: POST_CTA_ENUM[input.post_submit_call_to_action],
    fields,
  };

  if (input.privacy_policy_text) payload.privacy_policy_text = input.privacy_policy_text;
  if (input.desired_intent) payload.desired_intent = INTENT_ENUM[input.desired_intent];
  if (input.background_image_asset_id) {
    payload.background_image_asset = `customers/${cleanCustomerId}/assets/${input.background_image_asset_id}`;
  }
  if (input.custom_questions?.length) {
    payload.custom_question_fields = input.custom_questions.map((q) =>
      q.answers
        ? { custom_question_text: q.text, single_choice_answers: { answers: q.answers } }
        : { custom_question_text: q.text }
    );
  }
  if (input.webhook) {
    payload.delivery_methods = [
      {
        webhook: {
          advertiser_webhook_url: input.webhook.url,
          google_secret: input.webhook.google_secret,
          payload_schema_version: input.webhook.payload_schema_version ?? 1,
        },
      },
    ];
  }
  return payload;
}

/** Result returned to the caller. Never includes the webhook secret. */
export function summarizeLeadFormResult(input: LeadFormInput, resourceName: string | undefined) {
  return {
    asset_id: resourceName ? resourceName.split("/").pop() : undefined,
    resource_name: resourceName,
    name: input.name,
    business_name: input.business_name,
    fields: input.fields,
    qualifying_questions: (input.qualifying_questions ?? []).map((q) => q.type),
    custom_questions: (input.custom_questions ?? []).map((q) => q.text),
    webhook_configured: !!input.webhook,
    ...(input.webhook ? { webhook_url: input.webhook.url } : {}),
    ...(input.webhook
      ? {}
      : {
          delivery_methods_warning:
            "No webhook set. Leads stay in Google Ads (downloadable as CSV) until a CRM sync is enabled, e.g. HubSpot lead syncing for this form.",
        }),
  };
}
