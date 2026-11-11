import { describe, it, expect } from "vitest";
import {
  validateLeadFormInput,
  type LeadFormInput,
} from "./leadFormAsset.js";

function baseInput(overrides: Partial<LeadFormInput> = {}): LeadFormInput {
  return {
    name: "RDR Lead Form",
    business_name: "Acme Corp",
    call_to_action: "DOWNLOAD",
    call_to_action_description: "Get the free report",
    headline: "Recurring Donor Report 2026",
    description: "Free benchmarks across 100k+ nonprofits.",
    privacy_policy_url: "https://example.com/privacy/",
    final_urls: ["https://example.com/recurring-donor-report-2026/"],
    post_submit_headline: "Thanks — check email",
    post_submit_description: "Your copy of the report is on its way.",
    post_submit_call_to_action: "VISIT_SITE",
    desired_intent: "HIGH_INTENT",
    fields: ["FULL_NAME", "WORK_EMAIL", "COMPANY_NAME", "JOB_TITLE"],
    ...overrides,
  };
}

describe("validateLeadFormInput", () => {
  it("accepts a fully populated valid input", () => {
    const r = validateLeadFormInput(baseInput());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("requires name, business_name, headline, description", () => {
    const r = validateLeadFormInput(
      baseInput({ name: "", business_name: "", headline: "", description: "" })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /^name is required/.test(e))).toBe(true);
    expect(r.errors.some((e) => /business_name is required/.test(e))).toBe(true);
    expect(r.errors.some((e) => /headline is required/.test(e))).toBe(true);
    expect(r.errors.some((e) => /description is required/.test(e))).toBe(true);
  });

  it("rejects business_name > 25 chars", () => {
    const r = validateLeadFormInput(baseInput({ business_name: "x".repeat(26) }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /business_name exceeds/.test(e))).toBe(true);
  });

  it("rejects headline > 30 chars", () => {
    const r = validateLeadFormInput(baseInput({ headline: "x".repeat(31) }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /headline exceeds/.test(e))).toBe(true);
  });

  it("rejects non-https privacy_policy_url", () => {
    const r = validateLeadFormInput(
      baseInput({ privacy_policy_url: "http://example.com/privacy" })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /privacy_policy_url must be a valid https/.test(e))).toBe(true);
  });

  it("rejects malformed privacy_policy_url", () => {
    const r = validateLeadFormInput(baseInput({ privacy_policy_url: "example.com" }));
    expect(r.valid).toBe(false);
  });

  it("rejects unknown call_to_action", () => {
    const r = validateLeadFormInput(
      baseInput({ call_to_action: "DESTROY_PLANET" as any })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /call_to_action must be one of/.test(e))).toBe(true);
  });

  it("rejects unknown post_submit_call_to_action", () => {
    const r = validateLeadFormInput(
      baseInput({ post_submit_call_to_action: "BOOK_NOW" as any })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /post_submit_call_to_action must be one of/.test(e))).toBe(true);
  });

  it("rejects unknown desired_intent", () => {
    const r = validateLeadFormInput(baseInput({ desired_intent: "MEDIUM_INTENT" as any }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /desired_intent must be one of/.test(e))).toBe(true);
  });

  it("accepts omitted desired_intent", () => {
    const { desired_intent, ...rest } = baseInput();
    const r = validateLeadFormInput(rest as LeadFormInput);
    expect(r.valid).toBe(true);
  });

  it("requires at least one field", () => {
    const r = validateLeadFormInput(baseInput({ fields: [] }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /at least one field/.test(e))).toBe(true);
  });

  it("requires EMAIL or WORK_EMAIL", () => {
    const r = validateLeadFormInput(baseInput({ fields: ["FULL_NAME", "JOB_TITLE"] }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /must include EMAIL or WORK_EMAIL/.test(e))).toBe(true);
  });

  it("rejects unknown field types", () => {
    const r = validateLeadFormInput(
      baseInput({ fields: ["WORK_EMAIL", "FAVORITE_PIZZA" as any] })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /Unknown field type/.test(e))).toBe(true);
  });

  it("rejects duplicate field types", () => {
    const r = validateLeadFormInput(
      baseInput({ fields: ["WORK_EMAIL", "WORK_EMAIL", "FULL_NAME"] })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /Duplicate field type/.test(e))).toBe(true);
  });

  it("rejects call_to_action_description > 30 chars", () => {
    const r = validateLeadFormInput(
      baseInput({ call_to_action_description: "x".repeat(31) })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /call_to_action_description exceeds/.test(e))).toBe(true);
  });

  it("rejects post_submit_headline > 25 chars", () => {
    const r = validateLeadFormInput(
      baseInput({ post_submit_headline: "x".repeat(26) })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /post_submit_headline exceeds/.test(e))).toBe(true);
  });

  it("requires non-empty final_urls", () => {
    // Google Ads API rejects the create with REQUIRED_NONEMPTY_LIST on
    // operations.create.final_urls when an Asset of type LEAD_FORM is created
    // without it. Regression for the 2026-05-19 live-API failure.
    const { final_urls, ...rest } = baseInput();
    const r = validateLeadFormInput(rest as LeadFormInput);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /final_urls is required/.test(e))).toBe(true);
  });

  it("rejects empty final_urls array", () => {
    const r = validateLeadFormInput(baseInput({ final_urls: [] }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /final_urls/.test(e))).toBe(true);
  });

  it("rejects non-https final_urls", () => {
    const r = validateLeadFormInput(
      baseInput({ final_urls: ["http://example.com/report"] })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /final_urls.*https/i.test(e))).toBe(true);
  });

  it("rejects description > 200 chars", () => {
    const r = validateLeadFormInput(baseInput({ description: "x".repeat(201) }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /description exceeds/.test(e))).toBe(true);
  });
});

// ---- v2: name fields, qualifying questions, custom questions, webhook ----
import { buildLeadFormAssetPayload, summarizeLeadFormResult } from "./leadFormAsset.js";
import { enums } from "google-ads-api";

describe("validateLeadFormInput v2", () => {
  it("accepts FIRST_NAME and LAST_NAME", () => {
    const r = validateLeadFormInput(
      baseInput({ fields: ["FIRST_NAME", "LAST_NAME", "WORK_EMAIL", "COMPANY_NAME", "JOB_TITLE"] })
    );
    expect(r.errors).toEqual([]);
  });

  it("accepts qualifying questions with 2-12 answers", () => {
    const r = validateLeadFormInput(
      baseInput({
        qualifying_questions: [
          { type: "COMPANY_SIZE", answers: ["<250", "250-499", "500-1,999", "2,000-9,999", "10,000+"] },
          { type: "JOB_DEPARTMENT", answers: ["IT Security", "Other"] },
        ],
      })
    );
    expect(r.errors).toEqual([]);
  });

  it("accepts a qualifying question with no answer list", () => {
    const r = validateLeadFormInput(baseInput({ qualifying_questions: [{ type: "JOB_ROLE" }] }));
    expect(r.errors).toEqual([]);
  });

  it("rejects unknown qualifying type, duplicates, and bad answer counts", () => {
    const r = validateLeadFormInput(
      baseInput({
        qualifying_questions: [
          { type: "VEHICLE_MODEL" as any, answers: ["a", "b"] },
          { type: "COMPANY_SIZE", answers: ["only one"] },
          { type: "COMPANY_SIZE", answers: Array.from({ length: 13 }, (_, i) => `a${i}`) },
          { type: "JOB_ROLE", answers: ["dup", "dup"] },
        ],
      })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /qualifying question type/i.test(e))).toBe(true);
    expect(r.errors.some((e) => /Duplicate qualifying question: COMPANY_SIZE/.test(e))).toBe(true);
    expect(r.errors.some((e) => /between 2 and 12 answers/.test(e))).toBe(true);
    expect(r.errors.some((e) => /duplicate answer/i.test(e))).toBe(true);
  });

  it("requires custom questions to have text and 2-12 unique non-empty answers", () => {
    const r = validateLeadFormInput(
      baseInput({
        custom_questions: [
          { text: "", answers: ["Yes", "No"] },
          { text: "Would a walkthrough help?", answers: ["Yes"] },
          { text: "Solving for?", answers: ["AI", " "] },
        ],
      })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /custom question text is required/.test(e))).toBe(true);
    expect(r.errors.some((e) => /between 2 and 12 answers/.test(e))).toBe(true);
    expect(r.errors.some((e) => /empty answer/i.test(e))).toBe(true);
  });

  it("requires webhook url https and a google_secret", () => {
    const r1 = validateLeadFormInput(baseInput({ webhook: { url: "http://x.com/h", google_secret: "k" } }));
    expect(r1.errors.some((e) => /webhook.url must be a valid https/.test(e))).toBe(true);
    const r2 = validateLeadFormInput(baseInput({ webhook: { url: "https://x.com/h", google_secret: "" } }));
    expect(r2.errors.some((e) => /webhook.google_secret is required/.test(e))).toBe(true);
    const r3 = validateLeadFormInput(baseInput({ webhook: { url: "https://x.com/h", google_secret: "k" } }));
    expect(r3.errors).toEqual([]);
  });
});

describe("buildLeadFormAssetPayload (shape)", () => {
  const full = baseInput({
    fields: ["FIRST_NAME", "LAST_NAME", "WORK_EMAIL"],
    qualifying_questions: [{ type: "COMPANY_SIZE", answers: ["<250", "10,000+"] }, { type: "JOB_ROLE" }],
    custom_questions: [{ text: "Would a walkthrough help?", answers: ["Yes", "Just the eBook"] }],
    webhook: { url: "https://webhooks.example.com/lead", google_secret: "s3cret" },
  });
  const p = buildLeadFormAssetPayload(full, "1234567890");

  it("maps standard and qualifying fields in order, answers only when given", () => {
    expect(p.fields).toEqual([
      { input_type: enums.LeadFormFieldUserInputType.FIRST_NAME },
      { input_type: enums.LeadFormFieldUserInputType.LAST_NAME },
      { input_type: enums.LeadFormFieldUserInputType.WORK_EMAIL },
      { input_type: enums.LeadFormFieldUserInputType.COMPANY_SIZE, single_choice_answers: { answers: ["<250", "10,000+"] } },
      { input_type: enums.LeadFormFieldUserInputType.JOB_ROLE },
    ]);
  });

  it("maps custom questions", () => {
    expect(p.custom_question_fields).toEqual([
      { custom_question_text: "Would a walkthrough help?", single_choice_answers: { answers: ["Yes", "Just the eBook"] } },
    ]);
  });

  it("maps webhook with schema version 1 by default", () => {
    expect(p.delivery_methods).toEqual([
      { webhook: { advertiser_webhook_url: "https://webhooks.example.com/lead", google_secret: "s3cret", payload_schema_version: 1 } },
    ]);
  });

  it("omits optional blocks when not given", () => {
    const bare = buildLeadFormAssetPayload(baseInput(), "1");
    expect(bare.custom_question_fields).toBeUndefined();
    expect(bare.delivery_methods).toBeUndefined();
  });

  it("result summary never echoes the webhook secret", () => {
    const s = summarizeLeadFormResult(full, "customers/1/assets/9");
    expect(JSON.stringify(s)).not.toContain("s3cret");
    expect(s.webhook_configured).toBe(true);
    expect(s.asset_id).toBe("9");
  });
});

describe("free-text custom question", () => {
  it("validates and builds with no single_choice_answers", () => {
    const input = baseInput({ custom_questions: [{ text: "Anything else we should know?" }] });
    expect(validateLeadFormInput(input).errors).toEqual([]);
    expect(buildLeadFormAssetPayload(input, "1").custom_question_fields).toEqual([
      { custom_question_text: "Anything else we should know?" },
    ]);
  });
});
