import { describe, it, expect } from "vitest";
import {
  validateLeadFormInput,
  type LeadFormInput,
} from "./leadFormAsset.js";

function baseInput(overrides: Partial<LeadFormInput> = {}): LeadFormInput {
  return {
    name: "RDR Lead Form",
    business_name: "Neon One",
    call_to_action: "DOWNLOAD",
    call_to_action_description: "Get the free report",
    headline: "Recurring Donor Report 2026",
    description: "Free benchmarks across 100k+ nonprofits.",
    privacy_policy_url: "https://neonone.com/privacy/",
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
      baseInput({ privacy_policy_url: "http://neonone.com/privacy" })
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /privacy_policy_url must be a valid https/.test(e))).toBe(true);
  });

  it("rejects malformed privacy_policy_url", () => {
    const r = validateLeadFormInput(baseInput({ privacy_policy_url: "neonone.com" }));
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

  it("rejects description > 200 chars", () => {
    const r = validateLeadFormInput(baseInput({ description: "x".repeat(201) }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /description exceeds/.test(e))).toBe(true);
  });
});
