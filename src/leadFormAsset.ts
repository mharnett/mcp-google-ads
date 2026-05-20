/**
 * Pure helpers for google_ads_create_lead_form_asset. Separated from the
 * manager so validation logic (required fields, enum membership, char limits)
 * can be unit tested without touching the Google Ads API.
 *
 * v1 scope: standard fields only. Custom questions, qualifying questions,
 * and CRM delivery_methods (webhook) are deferred — leads land in the
 * Google Ads UI and must be downloaded as CSV (or routed via Zapier) until
 * a v2 ships with delivery_methods support.
 */

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
] as const;

export type LeadFormCallToActionType = (typeof LEAD_FORM_CALL_TO_ACTION_TYPES)[number];
export type LeadFormPostSubmitCallToActionType = (typeof LEAD_FORM_POST_SUBMIT_CTA_TYPES)[number];
export type LeadFormDesiredIntent = (typeof LEAD_FORM_DESIRED_INTENTS)[number];
export type LeadFormFieldType = (typeof LEAD_FORM_FIELD_TYPES)[number];

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

  return { valid: errors.length === 0, errors };
}
