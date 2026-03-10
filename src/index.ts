#!/usr/bin/env node

import { config as dotenvConfig } from "dotenv";
import { join, dirname } from "path";
dotenvConfig({ path: join(dirname(new URL(import.meta.url).pathname), "..", ".env") });

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleAdsApi, enums, resources, MutateOperation } from "google-ads-api";
import { readFileSync, existsSync } from "fs";
import { z } from "zod";

// Log build fingerprint at startup
try {
  const __buildInfoDir = dirname(new URL(import.meta.url).pathname);
  const buildInfo = JSON.parse(readFileSync(join(__buildInfoDir, "build-info.json"), "utf-8"));
  console.error(`[build] SHA: ${buildInfo.sha} (${buildInfo.builtAt})`);
} catch {
  // build-info.json not present (dev mode)
}

// ============================================
// CONFIGURATION
// ============================================

interface ClientConfig {
  customer_id: string;
  name: string;
  folder: string;
  mcc_customer_id?: string;
  refresh_token_env?: string;
  direct_access?: boolean; // Skip MCC routing when user has direct admin access
}

interface Config {
  google_ads: {
    mcc_customer_id: string;
  };
  clients: Record<string, ClientConfig>;
  defaults: {
    create_paused: boolean;
    label_prefix: string;
    require_approval_for_enable: boolean;
  };
}

function loadConfig(): Config {
  const configPath = join(dirname(new URL(import.meta.url).pathname), "..", "config.json");
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found at ${configPath}. Copy config.example.json to config.json and fill in your credentials.`);
  }
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

function getClientFromWorkingDir(config: Config, cwd: string): ClientConfig | null {
  for (const [key, client] of Object.entries(config.clients)) {
    if (cwd.startsWith(client.folder) || cwd.includes(key)) {
      return client;
    }
  }
  return null;
}

// ============================================
// TYPED ERRORS & VALIDATION (extracted to errors.ts)
// ============================================

import {
  GoogleAdsAuthError,
  GoogleAdsRateLimitError,
  GoogleAdsServiceError,
  validateCredentials,
  classifyError,
} from "./errors.js";

// ============================================
// GOOGLE ADS CLIENT
// ============================================

class GoogleAdsManager {
  private api: GoogleAdsApi;
  private config: Config;
  private defaultRefreshToken: string;

  constructor(config: Config) {
    this.config = config;

    // Validate credentials at startup — fail fast
    const creds = validateCredentials();
    if (!creds.valid) {
      const msg = `[STARTUP ERROR] Missing required credentials: ${creds.missing.join(", ")}. MCP will not function. Check run-mcp.sh and Keychain entries.`;
      console.error(msg);
      throw new GoogleAdsAuthError(msg);
    }
    console.error("[startup] Credentials validated: all required env vars present");

    this.defaultRefreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN!;
    this.api = new GoogleAdsApi({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    });
  }

  private getClientForCustomerId(customerId: string): ClientConfig | null {
    const normalized = customerId.replace(/-/g, "");
    for (const client of Object.values(this.config.clients)) {
      if (client.customer_id.replace(/-/g, "") === normalized) {
        return client;
      }
    }
    return null;
  }

  getCustomer(customerId: string) {
    const client = this.getClientForCustomerId(customerId);
    let refreshToken = this.defaultRefreshToken;
    if (client?.refresh_token_env && process.env[client.refresh_token_env]) {
      refreshToken = process.env[client.refresh_token_env]!;
    }

    const customerOpts: any = {
      customer_id: customerId.replace(/-/g, ""),
      refresh_token: refreshToken,
    };

    // Only route through MCC if the client doesn't have direct admin access.
    // Direct access is needed for accounts where the authenticated user has
    // admin rights but the MCC manager link doesn't permit mutations.
    if (!client?.direct_access) {
      const mccId = client?.mcc_customer_id || this.config.google_ads.mcc_customer_id;
      customerOpts.login_customer_id = mccId.replace(/-/g, "");
    }

    return this.api.Customer(customerOpts);
  }

  // List all campaigns for a customer
  async listCampaigns(customerId: string) {
    const customer = this.getCustomer(customerId);
    const campaigns = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.tracking_url_template,
        campaign.final_url_suffix,
        campaign.url_custom_parameters
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name
    `);
    return campaigns;
  }

  // Get campaign tracking parameters
  async getCampaignTracking(customerId: string, campaignId: string) {
    const customer = this.getCustomer(customerId);
    const result = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.tracking_url_template,
        campaign.final_url_suffix,
        campaign.url_custom_parameters
      FROM campaign
      WHERE campaign.id = ${campaignId}
    `);

    if (result.length === 0) {
      throw new Error(`Campaign ${campaignId} not found`);
    }

    const campaign = result[0].campaign;
    return {
      campaign_id: campaign?.id,
      campaign_name: campaign?.name,
      tracking_url_template: campaign?.tracking_url_template || null,
      final_url_suffix: campaign?.final_url_suffix || null,
      url_custom_parameters: campaign?.url_custom_parameters || [],
    };
  }

  // List ad groups for a campaign
  async listAdGroups(customerId: string, campaignId?: string) {
    const customer = this.getCustomer(customerId);
    let query = `
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        campaign.id,
        campaign.name
      FROM ad_group
      WHERE ad_group.status != 'REMOVED'
    `;
    if (campaignId) {
      query += ` AND campaign.id = ${campaignId}`;
    }
    query += ` ORDER BY campaign.name, ad_group.name`;
    return await customer.query(query);
  }

  // List ads with their status
  async listAds(customerId: string, options: { campaignId?: string; adGroupId?: string; labelContains?: string }) {
    const customer = this.getCustomer(customerId);
    let query = `
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.name,
        ad_group_ad.ad.type,
        ad_group_ad.status,
        ad_group_ad.policy_summary.approval_status,
        ad_group_ad.policy_summary.review_status,
        ad_group.id,
        ad_group.name,
        campaign.id,
        campaign.name,
        label.name
      FROM ad_group_ad
      WHERE ad_group_ad.status != 'REMOVED'
    `;
    if (options.campaignId) {
      query += ` AND campaign.id = ${options.campaignId}`;
    }
    if (options.adGroupId) {
      query += ` AND ad_group.id = ${options.adGroupId}`;
    }
    query += ` ORDER BY campaign.name, ad_group.name`;
    return await customer.query(query);
  }

  // List pending changes (paused items with claude- label)
  async listPendingChanges(customerId: string) {
    const customer = this.getCustomer(customerId);

    // Get paused campaigns with claude label
    const campaigns = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        label.name
      FROM campaign
      WHERE campaign.status = 'PAUSED'
        AND label.name LIKE 'claude-%'
    `);

    // Get paused ad groups with claude label
    const adGroups = await customer.query(`
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        campaign.name,
        label.name
      FROM ad_group
      WHERE ad_group.status = 'PAUSED'
        AND label.name LIKE 'claude-%'
    `);

    // Get paused ads with claude label
    const ads = await customer.query(`
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.type,
        ad_group_ad.status,
        ad_group_ad.policy_summary.approval_status,
        ad_group.name,
        campaign.name,
        label.name
      FROM ad_group_ad
      WHERE ad_group_ad.status = 'PAUSED'
        AND label.name LIKE 'claude-%'
    `);

    return { campaigns, adGroups, ads };
  }

  // Create a label
  async createLabel(customerId: string, labelName: string) {
    const customer = this.getCustomer(customerId);
    const label = {
      name: labelName,
      status: enums.LabelStatus.ENABLED,
    };

    try {
      const result = await customer.labels.create([label]);
      return result;
    } catch (e: any) {
      // Label might already exist
      if (e.message?.includes("DUPLICATE_NAME")) {
        return { existing: true, name: labelName };
      }
      throw e;
    }
  }

  // Create a campaign (paused by default)
  async createCampaign(customerId: string, campaign: {
    name: string;
    budget_amount_micros: number;
    advertising_channel_type?: string;
    bidding_strategy_type?: string;
  }) {
    const customer = this.getCustomer(customerId);

    // First create a budget
    const budgetResult = await customer.campaignBudgets.create([{
      name: `${campaign.name} Budget`,
      amount_micros: campaign.budget_amount_micros,
      delivery_method: enums.BudgetDeliveryMethod.STANDARD,
    }]);

    const budgetResourceName = budgetResult.results[0].resource_name;

    // Then create the campaign
    const campaignResult = await customer.campaigns.create([{
      name: campaign.name,
      status: enums.CampaignStatus.PAUSED, // Always create paused
      advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
      campaign_budget: budgetResourceName,
      manual_cpc: {}, // Default to manual CPC
    }]);

    return campaignResult;
  }

  // Create an ad group (paused by default)
  async createAdGroup(customerId: string, adGroup: {
    name: string;
    campaign_id: string;
    cpc_bid_micros?: number;
  }) {
    const customer = this.getCustomer(customerId);

    const result = await customer.adGroups.create([{
      name: adGroup.name,
      campaign: `customers/${customerId.replace(/-/g, "")}/campaigns/${adGroup.campaign_id}`,
      status: enums.AdGroupStatus.PAUSED, // Always create paused
      cpc_bid_micros: adGroup.cpc_bid_micros || 1000000, // $1.00 default
      type: enums.AdGroupType.SEARCH_STANDARD,
    }]);

    return result;
  }

  // Create a responsive search ad (paused by default)
  async createResponsiveSearchAd(customerId: string, ad: {
    ad_group_id: string;
    final_urls: string[];
    headlines: Array<string | { text: string; pinned_position?: number }>; // max 15
    descriptions: Array<string | { text: string; pinned_position?: number }>; // max 4
    path1?: string;
    path2?: string;
  }) {
    const customer = this.getCustomer(customerId);

    // Normalize to { text, pinned_position? } format
    const normalizedHeadlines = ad.headlines.map(h =>
      typeof h === "string" ? { text: h } : h
    );
    const normalizedDescriptions = ad.descriptions.map(d =>
      typeof d === "string" ? { text: d } : d
    );

    // Validate
    if (normalizedHeadlines.length < 3 || normalizedHeadlines.length > 15) {
      throw new Error("RSA requires 3-15 headlines");
    }
    if (normalizedDescriptions.length < 2 || normalizedDescriptions.length > 4) {
      throw new Error("RSA requires 2-4 descriptions");
    }

    // Check headline lengths
    for (const h of normalizedHeadlines) {
      if (h.text.length > 30) {
        throw new Error(`Headline too long (${h.text.length} chars, max 30): "${h.text}"`);
      }
    }
    // Check description lengths
    for (const d of normalizedDescriptions) {
      if (d.text.length > 90) {
        throw new Error(`Description too long (${d.text.length} chars, max 90): "${d.text}"`);
      }
    }

    // Map pinned_position to ServedAssetFieldType enum values
    const HEADLINE_PIN_MAP: Record<number, number> = { 1: 2, 2: 3, 3: 4 }; // HEADLINE_1=2, HEADLINE_2=3, HEADLINE_3=4
    const DESCRIPTION_PIN_MAP: Record<number, number> = { 1: 5, 2: 6 }; // DESCRIPTION_1=5, DESCRIPTION_2=6

    const result = await customer.adGroupAds.create([{
      ad_group: `customers/${customerId.replace(/-/g, "")}/adGroups/${ad.ad_group_id}`,
      status: enums.AdGroupAdStatus.PAUSED, // Always create paused
      ad: {
        responsive_search_ad: {
          headlines: normalizedHeadlines.map(h => ({
            text: h.text,
            ...(h.pinned_position && HEADLINE_PIN_MAP[h.pinned_position]
              ? { pinned_field: HEADLINE_PIN_MAP[h.pinned_position] }
              : {}),
          })),
          descriptions: normalizedDescriptions.map(d => ({
            text: d.text,
            ...(d.pinned_position && DESCRIPTION_PIN_MAP[d.pinned_position]
              ? { pinned_field: DESCRIPTION_PIN_MAP[d.pinned_position] }
              : {}),
          })),
          path1: ad.path1,
          path2: ad.path2,
        },
        final_urls: ad.final_urls,
      },
    }]);

    return result;
  }

  // Create keywords (paused by default)
  async createKeywords(customerId: string, keywords: {
    ad_group_id: string;
    keywords: Array<{ text: string; match_type: "BROAD" | "PHRASE" | "EXACT" }>;
  }) {
    const customer = this.getCustomer(customerId);

    const keywordCriteria = keywords.keywords.map(kw => ({
      ad_group: `customers/${customerId.replace(/-/g, "")}/adGroups/${keywords.ad_group_id}`,
      status: enums.AdGroupCriterionStatus.PAUSED, // Always create paused
      keyword: {
        text: kw.text,
        match_type: enums.KeywordMatchType[kw.match_type],
      },
    }));

    const result = await customer.adGroupCriteria.create(keywordCriteria);
    return result;
  }

  // Pause keywords (ad group criteria)
  async pauseKeywords(customerId: string, criterionResourceNames: string[]) {
    const customer = this.getCustomer(customerId);

    const operations = criterionResourceNames.map(rn => ({
      resource_name: rn,
      status: enums.AdGroupCriterionStatus.PAUSED,
    }));

    const result = await customer.adGroupCriteria.update(operations);
    return result;
  }

  // Add keywords to a shared negative keyword list
  // Uses the unified GoogleAdsService.Mutate endpoint instead of the dedicated
  // SharedCriterionService, which fails with RESOURCE_NOT_FOUND through MCC routing.
  async addSharedNegativeKeywords(customerId: string, sharedSetId: string, keywords: Array<{ text: string; match_type: "BROAD" | "PHRASE" | "EXACT" }>) {
    const customer = this.getCustomer(customerId);
    const cleanId = customerId.replace(/-/g, "");

    const mutations: MutateOperation<resources.ISharedCriterion>[] = keywords.map(kw => ({
      entity: "shared_criterion" as const,
      operation: "create" as const,
      resource: {
        shared_set: `customers/${cleanId}/sharedSets/${sharedSetId}`,
        keyword: {
          text: kw.text,
          match_type: enums.KeywordMatchType[kw.match_type],
        },
      },
    }));

    const result = await customer.mutateResources(mutations);
    return result;
  }

  // Add campaign-level negative keywords
  async addCampaignNegativeKeywords(customerId: string, campaignId: string, keywords: Array<{ text: string; match_type: "BROAD" | "PHRASE" | "EXACT" }>) {
    const customer = this.getCustomer(customerId);
    const cleanId = customerId.replace(/-/g, "");

    const criteria = keywords.map(kw => ({
      campaign: `customers/${cleanId}/campaigns/${campaignId}`,
      negative: true,
      keyword: {
        text: kw.text,
        match_type: enums.KeywordMatchType[kw.match_type],
      },
    }));

    const result = await customer.campaignCriteria.create(criteria);
    return result;
  }

  // Enable ads (requires approval in MCP)
  async enableAds(customerId: string, adIds: string[]) {
    const customer = this.getCustomer(customerId);

    const operations = adIds.map(adId => ({
      resource_name: `customers/${customerId.replace(/-/g, "")}/adGroupAds/${adId}`,
      status: enums.AdGroupAdStatus.ENABLED,
    }));

    const result = await customer.adGroupAds.update(operations);
    return result;
  }

  // Enable ad groups
  async enableAdGroups(customerId: string, adGroupIds: string[]) {
    const customer = this.getCustomer(customerId);

    const operations = adGroupIds.map(id => ({
      resource_name: `customers/${customerId.replace(/-/g, "")}/adGroups/${id}`,
      status: enums.AdGroupStatus.ENABLED,
    }));

    const result = await customer.adGroups.update(operations);
    return result;
  }

  // Enable campaigns
  async enableCampaigns(customerId: string, campaignIds: string[]) {
    const customer = this.getCustomer(customerId);

    const operations = campaignIds.map(id => ({
      resource_name: `customers/${customerId.replace(/-/g, "")}/campaigns/${id}`,
      status: enums.CampaignStatus.ENABLED,
    }));

    const result = await customer.campaigns.update(operations);
    return result;
  }

  // Pause ads
  async pauseAds(customerId: string, adIds: string[]) {
    const customer = this.getCustomer(customerId);

    const operations = adIds.map(adId => ({
      resource_name: `customers/${customerId.replace(/-/g, "")}/adGroupAds/${adId}`,
      status: enums.AdGroupAdStatus.PAUSED,
    }));

    const result = await customer.adGroupAds.update(operations);
    return result;
  }

  // Pause ad groups
  async pauseAdGroups(customerId: string, adGroupIds: string[]) {
    const customer = this.getCustomer(customerId);

    const operations = adGroupIds.map(id => ({
      resource_name: `customers/${customerId.replace(/-/g, "")}/adGroups/${id}`,
      status: enums.AdGroupStatus.PAUSED,
    }));

    const result = await customer.adGroups.update(operations);
    return result;
  }

  // Pause campaigns
  async pauseCampaigns(customerId: string, campaignIds: string[]) {
    const customer = this.getCustomer(customerId);

    const operations = campaignIds.map(id => ({
      resource_name: `customers/${customerId.replace(/-/g, "")}/campaigns/${id}`,
      status: enums.CampaignStatus.PAUSED,
    }));

    const result = await customer.campaigns.update(operations);
    return result;
  }

  // ============================================
  // REPORTING METHODS
  // ============================================

  // Get keyword performance report
  async getKeywordPerformance(customerId: string, options: {
    startDate: string; // YYYY-MM-DD
    endDate: string;   // YYYY-MM-DD
    keywordTextContains?: string;
    campaignIds?: string[];
    adGroupIds?: string[];
  }) {
    const customer = this.getCustomer(customerId);

    let query = `
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.quality_info.creative_quality_score,
        ad_group_criterion.quality_info.post_click_quality_score,
        ad_group_criterion.quality_info.search_predicted_ctr,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.cost_micros,
        metrics.average_cpc,
        metrics.conversions,
        metrics.conversions_value,
        metrics.all_conversions,
        metrics.all_conversions_value,
        metrics.cost_per_conversion,
        metrics.conversions_from_interactions_rate,
        metrics.search_impression_share,
        metrics.search_top_impression_share,
        metrics.search_absolute_top_impression_share,
        metrics.search_rank_lost_impression_share
      FROM keyword_view
      WHERE segments.date BETWEEN '${options.startDate}' AND '${options.endDate}'
        AND ad_group_criterion.status != 'REMOVED'
    `;

    if (options.keywordTextContains) {
      query += ` AND ad_group_criterion.keyword.text LIKE '%${options.keywordTextContains}%'`;
    }
    if (options.campaignIds && options.campaignIds.length > 0) {
      query += ` AND campaign.id IN (${options.campaignIds.join(",")})`;
    }
    if (options.adGroupIds && options.adGroupIds.length > 0) {
      query += ` AND ad_group.id IN (${options.adGroupIds.join(",")})`;
    }

    query += ` ORDER BY metrics.cost_micros DESC`;

    return await customer.query(query);
  }

  // Get keyword performance with conversion breakdowns
  async getKeywordPerformanceWithConversions(customerId: string, options: {
    startDate: string;
    endDate: string;
    keywordTextContains?: string;
    campaignIds?: string[];
    adGroupIds?: string[];
  }) {
    const customer = this.getCustomer(customerId);

    let query = `
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.quality_info.creative_quality_score,
        ad_group_criterion.quality_info.post_click_quality_score,
        ad_group_criterion.quality_info.search_predicted_ctr,
        metrics.conversions,
        metrics.conversions_value,
        metrics.all_conversions,
        metrics.all_conversions_value,
        segments.conversion_action_name,
        segments.conversion_action
      FROM keyword_view
      WHERE segments.date BETWEEN '${options.startDate}' AND '${options.endDate}'
        AND ad_group_criterion.status != 'REMOVED'
    `;

    if (options.keywordTextContains) {
      query += ` AND ad_group_criterion.keyword.text LIKE '%${options.keywordTextContains}%'`;
    }
    if (options.campaignIds && options.campaignIds.length > 0) {
      query += ` AND campaign.id IN (${options.campaignIds.join(",")})`;
    }
    if (options.adGroupIds && options.adGroupIds.length > 0) {
      query += ` AND ad_group.id IN (${options.adGroupIds.join(",")})`;
    }

    query += ` ORDER BY ad_group_criterion.keyword.text, segments.conversion_action_name`;

    return await customer.query(query);
  }

  // Get search term report
  async getSearchTermReport(customerId: string, options: {
    startDate: string;
    endDate: string;
    keywordTextContains?: string;
    searchTermContains?: string;
    campaignIds?: string[];
    adGroupIds?: string[];
  }) {
    const customer = this.getCustomer(customerId);

    let query = `
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        search_term_view.search_term,
        search_term_view.status,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.cost_micros,
        metrics.average_cpc,
        metrics.conversions,
        metrics.conversions_value,
        metrics.all_conversions,
        metrics.all_conversions_value,
        metrics.cost_per_conversion,
        metrics.conversions_from_interactions_rate
      FROM search_term_view
      WHERE segments.date BETWEEN '${options.startDate}' AND '${options.endDate}'
    `;
    if (options.searchTermContains) {
      query += ` AND search_term_view.search_term LIKE '%${options.searchTermContains}%'`;
    }
    if (options.campaignIds && options.campaignIds.length > 0) {
      query += ` AND campaign.id IN (${options.campaignIds.join(",")})`;
    }
    if (options.adGroupIds && options.adGroupIds.length > 0) {
      query += ` AND ad_group.id IN (${options.adGroupIds.join(",")})`;
    }

    query += ` ORDER BY metrics.impressions DESC`;

    return await customer.query(query);
  }

  // Get search term report with conversion breakdowns
  async getSearchTermReportWithConversions(customerId: string, options: {
    startDate: string;
    endDate: string;
    keywordTextContains?: string;
    searchTermContains?: string;
    campaignIds?: string[];
    adGroupIds?: string[];
  }) {
    const customer = this.getCustomer(customerId);

    let query = `
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        search_term_view.search_term,
        search_term_view.status,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.cost_micros,
        metrics.average_cpc,
        metrics.conversions,
        metrics.all_conversions,
        segments.conversion_action_name,
        segments.conversion_action
      FROM search_term_view
      WHERE segments.date BETWEEN '${options.startDate}' AND '${options.endDate}'
    `;

    if (options.searchTermContains) {
      query += ` AND search_term_view.search_term LIKE '%${options.searchTermContains}%'`;
    }
    if (options.campaignIds && options.campaignIds.length > 0) {
      query += ` AND campaign.id IN (${options.campaignIds.join(",")})`;
    }
    if (options.adGroupIds && options.adGroupIds.length > 0) {
      query += ` AND ad_group.id IN (${options.adGroupIds.join(",")})`;
    }

    query += ` ORDER BY search_term_view.search_term, segments.conversion_action_name`;

    return await customer.query(query);
  }

  // Get ad performance report
  async getAdPerformance(customerId: string, options: {
    startDate: string;
    endDate: string;
    campaignIds?: string[];
    adGroupIds?: string[];
  }) {
    const customer = this.getCustomer(customerId);

    let query = `
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        ad_group_ad.ad.id,
        ad_group_ad.ad.type,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.responsive_search_ad.path1,
        ad_group_ad.ad.responsive_search_ad.path2,
        ad_group_ad.ad_strength,
        ad_group_ad.status,
        ad_group_ad.policy_summary.approval_status,
        ad_group_ad.policy_summary.review_status,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.cost_micros,
        metrics.average_cpc,
        metrics.conversions,
        metrics.conversions_value,
        metrics.all_conversions,
        metrics.all_conversions_value,
        metrics.cost_per_conversion,
        metrics.conversions_from_interactions_rate
      FROM ad_group_ad
      WHERE segments.date BETWEEN '${options.startDate}' AND '${options.endDate}'
        AND ad_group_ad.status != 'REMOVED'
    `;

    if (options.campaignIds && options.campaignIds.length > 0) {
      query += ` AND campaign.id IN (${options.campaignIds.join(",")})`;
    }
    if (options.adGroupIds && options.adGroupIds.length > 0) {
      query += ` AND ad_group.id IN (${options.adGroupIds.join(",")})`;
    }

    query += ` ORDER BY metrics.impressions DESC`;

    return await customer.query(query);
  }

  // Get ad performance with conversion breakdowns
  async getAdPerformanceWithConversions(customerId: string, options: {
    startDate: string;
    endDate: string;
    campaignIds?: string[];
    adGroupIds?: string[];
  }) {
    const customer = this.getCustomer(customerId);

    let query = `
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        ad_group_ad.ad.id,
        ad_group_ad.ad.type,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.responsive_search_ad.path1,
        ad_group_ad.ad.responsive_search_ad.path2,
        ad_group_ad.ad_strength,
        ad_group_ad.status,
        ad_group_ad.policy_summary.approval_status,
        ad_group_ad.policy_summary.review_status,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.cost_micros,
        metrics.average_cpc,
        metrics.conversions,
        metrics.all_conversions,
        segments.conversion_action_name,
        segments.conversion_action
      FROM ad_group_ad
      WHERE segments.date BETWEEN '${options.startDate}' AND '${options.endDate}'
        AND ad_group_ad.status != 'REMOVED'
    `;

    if (options.campaignIds && options.campaignIds.length > 0) {
      query += ` AND campaign.id IN (${options.campaignIds.join(",")})`;
    }
    if (options.adGroupIds && options.adGroupIds.length > 0) {
      query += ` AND ad_group.id IN (${options.adGroupIds.join(",")})`;
    }

    query += ` ORDER BY ad_group_ad.ad.id, segments.conversion_action_name`;

    return await customer.query(query);
  }

  // List available conversion actions
  async listConversionActions(customerId: string) {
    const customer = this.getCustomer(customerId);

    const query = `
      SELECT
        conversion_action.id,
        conversion_action.name,
        conversion_action.category,
        conversion_action.type,
        conversion_action.status
      FROM conversion_action
      WHERE conversion_action.status = 'ENABLED'
      ORDER BY conversion_action.name
    `;

    return await customer.query(query);
  }

  // Validate an ad without creating it
  async validateAd(customerId: string, ad: {
    headlines: string[];
    descriptions: string[];
    final_urls: string[];
  }) {
    const errors: string[] = [];

    // Check headline count
    if (ad.headlines.length < 3) {
      errors.push(`Need at least 3 headlines, got ${ad.headlines.length}`);
    }
    if (ad.headlines.length > 15) {
      errors.push(`Maximum 15 headlines, got ${ad.headlines.length}`);
    }

    // Check description count
    if (ad.descriptions.length < 2) {
      errors.push(`Need at least 2 descriptions, got ${ad.descriptions.length}`);
    }
    if (ad.descriptions.length > 4) {
      errors.push(`Maximum 4 descriptions, got ${ad.descriptions.length}`);
    }

    // Check headline lengths
    ad.headlines.forEach((h, i) => {
      if (h.length > 30) {
        errors.push(`Headline ${i + 1} too long (${h.length}/30): "${h}"`);
      }
    });

    // Check description lengths
    ad.descriptions.forEach((d, i) => {
      if (d.length > 90) {
        errors.push(`Description ${i + 1} too long (${d.length}/90): "${d}"`);
      }
    });

    // Check final URLs
    if (ad.final_urls.length === 0) {
      errors.push("At least one final URL is required");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // Get search term category insights for a campaign (with trend comparison)
  async getSearchTermInsights(customerId: string, options: {
    campaignId: string;
    startDate: string;
    endDate: string;
    compareStartDate?: string;
    compareEndDate?: string;
  }) {
    const customer = this.getCustomer(customerId);

    // Current period - get categories with metrics
    const currentQuery = `
      SELECT
        campaign_search_term_insight.campaign_id,
        campaign_search_term_insight.category_label,
        campaign_search_term_insight.id,
        metrics.clicks,
        metrics.impressions,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign_search_term_insight
      WHERE campaign_search_term_insight.campaign_id = '${options.campaignId}'
        AND segments.date BETWEEN '${options.startDate}' AND '${options.endDate}'
    `;

    const currentResults = await customer.query(currentQuery);

    // If comparison dates provided, get previous period too
    let previousResults: any[] = [];
    if (options.compareStartDate && options.compareEndDate) {
      const prevQuery = `
        SELECT
          campaign_search_term_insight.campaign_id,
          campaign_search_term_insight.category_label,
          campaign_search_term_insight.id,
          metrics.clicks,
          metrics.impressions,
          metrics.conversions,
          metrics.conversions_value
        FROM campaign_search_term_insight
        WHERE campaign_search_term_insight.campaign_id = '${options.campaignId}'
          AND segments.date BETWEEN '${options.compareStartDate}' AND '${options.compareEndDate}'
      `;
      previousResults = await customer.query(prevQuery);
    }

    // Build previous period lookup by category label
    const prevByCategory: Record<string, any> = {};
    for (const row of previousResults) {
      const label = row.campaign_search_term_insight?.category_label || "unknown";
      if (!prevByCategory[label]) {
        prevByCategory[label] = { clicks: 0, impressions: 0, conversions: 0, conversions_value: 0 };
      }
      prevByCategory[label].clicks += row.metrics?.clicks || 0;
      prevByCategory[label].impressions += row.metrics?.impressions || 0;
      prevByCategory[label].conversions += row.metrics?.conversions || 0;
      prevByCategory[label].conversions_value += row.metrics?.conversions_value || 0;
    }

    // Aggregate current period and compute trends
    const currentByCategory: Record<string, any> = {};
    for (const row of currentResults) {
      const label = row.campaign_search_term_insight?.category_label || "unknown";
      const id = row.campaign_search_term_insight?.id;
      if (!currentByCategory[label]) {
        currentByCategory[label] = { id, clicks: 0, impressions: 0, conversions: 0, conversions_value: 0 };
      }
      currentByCategory[label].clicks += row.metrics?.clicks || 0;
      currentByCategory[label].impressions += row.metrics?.impressions || 0;
      currentByCategory[label].conversions += row.metrics?.conversions || 0;
      currentByCategory[label].conversions_value += row.metrics?.conversions_value || 0;
    }

    // Build output with trends
    const categories = Object.entries(currentByCategory).map(([label, curr]: [string, any]) => {
      const prev = prevByCategory[label];
      const result: any = {
        category: label,
        insight_id: curr.id,
        current_period: {
          clicks: curr.clicks,
          impressions: curr.impressions,
          conversions: curr.conversions,
          conversions_value: curr.conversions_value,
        },
      };

      if (prev) {
        result.previous_period = {
          clicks: prev.clicks,
          impressions: prev.impressions,
          conversions: prev.conversions,
          conversions_value: prev.conversions_value,
        };
        result.trends = {
          clicks_change: prev.clicks > 0 ? `${(((curr.clicks - prev.clicks) / prev.clicks) * 100).toFixed(0)}%` : (curr.clicks > 0 ? "+∞" : "0%"),
          impressions_change: prev.impressions > 0 ? `${(((curr.impressions - prev.impressions) / prev.impressions) * 100).toFixed(0)}%` : (curr.impressions > 0 ? "+∞" : "0%"),
          conversions_change: prev.conversions > 0 ? `${(((curr.conversions - prev.conversions) / prev.conversions) * 100).toFixed(0)}%` : (curr.conversions > 0 ? "+∞" : "0%"),
        };
      }

      return result;
    });

    // Sort by clicks descending
    categories.sort((a, b) => b.current_period.clicks - a.current_period.clicks);

    return {
      campaign_id: options.campaignId,
      current_period: { start: options.startDate, end: options.endDate },
      compare_period: options.compareStartDate ? { start: options.compareStartDate, end: options.compareEndDate } : null,
      total_categories: categories.length,
      categories,
    };
  }

  // Get individual search terms within a specific insight category
  async getSearchTermInsightTerms(customerId: string, options: {
    campaignId: string;
    insightId: string;
    startDate: string;
    endDate: string;
  }) {
    const customer = this.getCustomer(customerId);

    const query = `
      SELECT
        campaign_search_term_insight.campaign_id,
        campaign_search_term_insight.category_label,
        campaign_search_term_insight.id,
        segments.search_term,
        metrics.clicks,
        metrics.impressions,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign_search_term_insight
      WHERE campaign_search_term_insight.campaign_id = '${options.campaignId}'
        AND campaign_search_term_insight.id = '${options.insightId}'
        AND segments.date BETWEEN '${options.startDate}' AND '${options.endDate}'
    `;

    return await customer.query(query);
  }

  // Execute a raw GAQL query
  async executeGaql(customerId: string, query: string) {
    const customer = this.getCustomer(customerId);
    return await customer.query(query);
  }
}

// ============================================
// MCP SERVER
// ============================================

const config = loadConfig();
const adsManager = new GoogleAdsManager(config);

const server = new Server(
  {
    name: "mcp-google-ads",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tools
const tools: Tool[] = [
  {
    name: "google_ads_get_client_context",
    description: "Get the current client context based on working directory. Call this first to confirm which Google Ads account you're working with.",
    inputSchema: {
      type: "object",
      properties: {
        working_directory: {
          type: "string",
          description: "The current working directory",
        },
      },
      required: ["working_directory"],
    },
  },
  {
    name: "google_ads_list_campaigns",
    description: "List all campaigns for the current client account",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: {
          type: "string",
          description: "The customer ID (will use context if not provided)",
        },
      },
    },
  },
  {
    name: "google_ads_list_ad_groups",
    description: "List ad groups, optionally filtered by campaign",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string" },
      },
    },
  },
  {
    name: "google_ads_get_campaign_tracking",
    description: "Get campaign tracking parameters including tracking URL template, final URL suffix, and custom URL parameters",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string", description: "The campaign ID to get tracking info for" },
      },
      required: ["campaign_id"],
    },
  },
  {
    name: "google_ads_list_pending_changes",
    description: "List all pending changes (paused items with claude- label) awaiting review",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
      },
    },
  },
  {
    name: "google_ads_validate_ad",
    description: "Validate an RSA without creating it. Use this to check for errors before creating.",
    inputSchema: {
      type: "object",
      properties: {
        headlines: {
          type: "array",
          items: { type: "string" },
          description: "3-15 headlines, max 30 chars each",
        },
        descriptions: {
          type: "array",
          items: { type: "string" },
          description: "2-4 descriptions, max 90 chars each",
        },
        final_urls: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["headlines", "descriptions", "final_urls"],
    },
  },
  {
    name: "google_ads_create_campaign",
    description: "Create a new campaign (will be PAUSED until approved). Returns campaign ID.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        name: { type: "string" },
        daily_budget: { type: "number", description: "Daily budget in dollars" },
      },
      required: ["name", "daily_budget"],
    },
  },
  {
    name: "google_ads_create_ad_group",
    description: "Create a new ad group (will be PAUSED until approved). Returns ad group ID.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string" },
        name: { type: "string" },
        cpc_bid: { type: "number", description: "CPC bid in dollars" },
      },
      required: ["campaign_id", "name"],
    },
  },
  {
    name: "google_ads_create_responsive_search_ad",
    description: "Create a responsive search ad (will be PAUSED until approved). Validates before creating. Headlines/descriptions can be plain strings or objects with pinned_position (1-3 for headlines, 1-2 for descriptions).",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        ad_group_id: { type: "string" },
        final_urls: { type: "array", items: { type: "string" } },
        headlines: {
          type: "array",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  text: { type: "string" },
                  pinned_position: { type: "number", description: "Pin to position 1, 2, or 3" },
                },
                required: ["text"],
              },
            ],
          },
        },
        descriptions: {
          type: "array",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  text: { type: "string" },
                  pinned_position: { type: "number", description: "Pin to position 1 or 2" },
                },
                required: ["text"],
              },
            ],
          },
        },
        path1: { type: "string" },
        path2: { type: "string" },
      },
      required: ["ad_group_id", "final_urls", "headlines", "descriptions"],
    },
  },
  {
    name: "google_ads_create_keywords",
    description: "Create keywords for an ad group (will be PAUSED until approved)",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        ad_group_id: { type: "string" },
        keywords: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              match_type: { type: "string", enum: ["BROAD", "PHRASE", "EXACT"] },
            },
            required: ["text", "match_type"],
          },
        },
      },
      required: ["ad_group_id", "keywords"],
    },
  },
  {
    name: "google_ads_enable_items",
    description: "Enable paused campaigns, ad groups, or ads. REQUIRES USER APPROVAL. Use after reviewing in Google Ads UI.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_ids: { type: "array", items: { type: "string" } },
        ad_group_ids: { type: "array", items: { type: "string" } },
        ad_ids: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "google_ads_pause_items",
    description: "Pause enabled campaigns, ad groups, or ads. REQUIRES USER APPROVAL. This will stop items from serving.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_ids: { type: "array", items: { type: "string" } },
        ad_group_ids: { type: "array", items: { type: "string" } },
        ad_ids: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "google_ads_add_shared_negatives",
    description: "Add negative keywords to a shared negative keyword list. Keywords will immediately block matching queries across all campaigns the list is applied to.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        shared_set_id: { type: "string", description: "The shared set ID to add keywords to" },
        keywords: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              match_type: { type: "string", enum: ["BROAD", "PHRASE", "EXACT"] },
            },
            required: ["text", "match_type"],
          },
        },
      },
      required: ["shared_set_id", "keywords"],
    },
  },
  {
    name: "google_ads_add_campaign_negatives",
    description: "Add negative keywords at the campaign level. Use for campaign-specific negatives that shouldn't be in a shared list.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string" },
        keywords: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              match_type: { type: "string", enum: ["BROAD", "PHRASE", "EXACT"] },
            },
            required: ["text", "match_type"],
          },
        },
      },
      required: ["campaign_id", "keywords"],
    },
  },
  {
    name: "google_ads_pause_keywords",
    description: "Pause active keywords by their criterion resource names.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        criterion_resource_names: { type: "array", items: { type: "string" }, description: "Full resource names like customers/123/adGroupCriteria/456~789" },
      },
      required: ["criterion_resource_names"],
    },
  },
  // ============================================
  // REPORTING TOOLS
  // ============================================
  {
    name: "google_ads_keyword_performance",
    description: "Get keyword performance report with metrics including impressions, clicks, cost, conversions, quality score components (quality score, expected CTR, ad relevance, landing page experience), and impression share metrics.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        keyword_text_contains: { type: "string", description: "Filter keywords containing this text" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_keyword_performance_by_conversion",
    description: "Get keyword performance broken down by conversion action. Shows which keywords drive which conversion types (e.g., form fills, MQLs, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        keyword_text_contains: { type: "string", description: "Filter keywords containing this text" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_search_term_report",
    description: "Get search term report showing actual search queries that triggered ads, with the keyword they matched to.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        keyword_text_contains: { type: "string", description: "Filter by keyword text" },
        search_term_contains: { type: "string", description: "Filter search terms containing this text" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_search_term_report_by_conversion",
    description: "Get search term report broken down by conversion action. Shows which search queries drive which conversion types.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        keyword_text_contains: { type: "string", description: "Filter by keyword text" },
        search_term_contains: { type: "string", description: "Filter search terms containing this text" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_ad_performance",
    description: "Get ad performance report with metrics, ad copy (headlines/descriptions), final URLs, and ad strength rating.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_ad_performance_by_conversion",
    description: "Get ad performance broken down by conversion action. Shows which ads drive which conversion types.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
        ad_group_ids: { type: "array", items: { type: "string" }, description: "Filter by ad group IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "google_ads_list_conversion_actions",
    description: "List all available conversion actions (e.g., form fills, MQLs, etc.) to understand what conversion tracking is set up.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
      },
    },
  },
  {
    name: "google_ads_search_term_insights",
    description: "Get search term category insights for a campaign. Shows the search categories your ads appeared against (like the Insights panel in the Google Ads UI). Must query one campaign at a time. Optionally compares two date ranges to show trends.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string", description: "The campaign ID to get insights for (required, one campaign at a time)" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
        compare_start_date: { type: "string", description: "Comparison period start date (optional, for trend calculation)" },
        compare_end_date: { type: "string", description: "Comparison period end date (optional, for trend calculation)" },
      },
      required: ["campaign_id", "start_date", "end_date"],
    },
  },
  {
    name: "google_ads_search_term_insight_terms",
    description: "Drill into a specific search term category to see the individual search terms within it. Requires an insight_id from google_ads_search_term_insights.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        campaign_id: { type: "string", description: "The campaign ID" },
        insight_id: { type: "string", description: "The insight category ID from google_ads_search_term_insights results" },
        start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
        end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
      },
      required: ["campaign_id", "insight_id", "start_date", "end_date"],
    },
  },
  {
    name: "google_ads_gaql_query",
    description: "Execute a raw GAQL (Google Ads Query Language) query. Use this for custom reports or accessing any Google Ads API resource not covered by other tools. See https://developers.google.com/google-ads/api/docs/query/overview for GAQL syntax.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string" },
        query: { type: "string", description: "The GAQL query to execute" },
      },
      required: ["query"],
    },
  },
];

// Handle list tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "google_ads_get_client_context": {
        const cwd = args?.working_directory as string;
        const client = getClientFromWorkingDir(config, cwd);
        if (!client) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "No client found for working directory",
                working_directory: cwd,
                available_clients: Object.entries(config.clients).map(([k, v]) => ({
                  key: k,
                  name: v.name,
                  folder: v.folder,
                })),
              }, null, 2),
            }],
          };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              client_name: client.name,
              customer_id: client.customer_id,
              folder: client.folder,
              mcc_id: client.mcc_customer_id || config.google_ads.mcc_customer_id,
            }, null, 2),
          }],
        };
      }

      case "google_ads_list_campaigns": {
        const customerId = args?.customer_id as string || "";
        const campaigns = await adsManager.listCampaigns(customerId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(campaigns, null, 2),
          }],
        };
      }

      case "google_ads_list_ad_groups": {
        const customerId = args?.customer_id as string || "";
        const campaignId = args?.campaign_id as string;
        const adGroups = await adsManager.listAdGroups(customerId, campaignId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(adGroups, null, 2),
          }],
        };
      }

      case "google_ads_get_campaign_tracking": {
        const customerId = args?.customer_id as string || "";
        const campaignId = args?.campaign_id as string;
        const tracking = await adsManager.getCampaignTracking(customerId, campaignId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(tracking, null, 2),
          }],
        };
      }

      case "google_ads_list_pending_changes": {
        const customerId = args?.customer_id as string || "";
        const pending = await adsManager.listPendingChanges(customerId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(pending, null, 2),
          }],
        };
      }

      case "google_ads_validate_ad": {
        const validation = await adsManager.validateAd("", {
          headlines: args?.headlines as string[],
          descriptions: args?.descriptions as string[],
          final_urls: args?.final_urls as string[],
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(validation, null, 2),
          }],
        };
      }

      case "google_ads_create_campaign": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.createCampaign(customerId, {
          name: args?.name as string,
          budget_amount_micros: (args?.daily_budget as number) * 1000000,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Campaign created (PAUSED). Review in Google Ads before enabling.",
              result,
            }, null, 2),
          }],
        };
      }

      case "google_ads_create_ad_group": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.createAdGroup(customerId, {
          name: args?.name as string,
          campaign_id: args?.campaign_id as string,
          cpc_bid_micros: args?.cpc_bid ? (args.cpc_bid as number) * 1000000 : undefined,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Ad group created (PAUSED). Review in Google Ads before enabling.",
              result,
            }, null, 2),
          }],
        };
      }

      case "google_ads_create_responsive_search_ad": {
        const customerId = args?.customer_id as string || "";

        // Normalize headlines/descriptions for validation (extract text strings)
        const rawHeadlines = args?.headlines as Array<string | { text: string; pinned_position?: number }>;
        const rawDescriptions = args?.descriptions as Array<string | { text: string; pinned_position?: number }>;
        const headlineTexts = rawHeadlines.map(h => typeof h === "string" ? h : h.text);
        const descriptionTexts = rawDescriptions.map(d => typeof d === "string" ? d : d.text);

        // Validate first
        const validation = await adsManager.validateAd(customerId, {
          headlines: headlineTexts,
          descriptions: descriptionTexts,
          final_urls: args?.final_urls as string[],
        });

        if (!validation.valid) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                message: "Validation failed",
                errors: validation.errors,
              }, null, 2),
            }],
          };
        }

        const result = await adsManager.createResponsiveSearchAd(customerId, {
          ad_group_id: args?.ad_group_id as string,
          final_urls: args?.final_urls as string[],
          headlines: rawHeadlines,
          descriptions: rawDescriptions,
          path1: args?.path1 as string,
          path2: args?.path2 as string,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "RSA created (PAUSED). Review in Google Ads before enabling.",
              result,
            }, null, 2),
          }],
        };
      }

      case "google_ads_create_keywords": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.createKeywords(customerId, {
          ad_group_id: args?.ad_group_id as string,
          keywords: args?.keywords as Array<{ text: string; match_type: "BROAD" | "PHRASE" | "EXACT" }>,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Keywords created (PAUSED). Review in Google Ads before enabling.",
              result,
            }, null, 2),
          }],
        };
      }

      case "google_ads_enable_items": {
        const customerId = args?.customer_id as string || "";
        const results: any = {};

        if (args?.campaign_ids) {
          results.campaigns = await adsManager.enableCampaigns(customerId, args.campaign_ids as string[]);
        }
        if (args?.ad_group_ids) {
          results.adGroups = await adsManager.enableAdGroups(customerId, args.ad_group_ids as string[]);
        }
        if (args?.ad_ids) {
          results.ads = await adsManager.enableAds(customerId, args.ad_ids as string[]);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Items enabled and now LIVE",
              results,
            }, null, 2),
          }],
        };
      }

      case "google_ads_pause_items": {
        const customerId = args?.customer_id as string || "";
        const results: any = {};

        if (args?.campaign_ids) {
          results.campaigns = await adsManager.pauseCampaigns(customerId, args.campaign_ids as string[]);
        }
        if (args?.ad_group_ids) {
          results.adGroups = await adsManager.pauseAdGroups(customerId, args.ad_group_ids as string[]);
        }
        if (args?.ad_ids) {
          results.ads = await adsManager.pauseAds(customerId, args.ad_ids as string[]);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Items paused and no longer serving",
              results,
            }, null, 2),
          }],
        };
      }

      case "google_ads_add_shared_negatives": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.addSharedNegativeKeywords(
          customerId,
          args?.shared_set_id as string,
          args?.keywords as Array<{ text: string; match_type: "BROAD" | "PHRASE" | "EXACT" }>,
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Negative keywords added to shared list",
              results: result,
            }, null, 2),
          }],
        };
      }

      case "google_ads_add_campaign_negatives": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.addCampaignNegativeKeywords(
          customerId,
          args?.campaign_id as string,
          args?.keywords as Array<{ text: string; match_type: "BROAD" | "PHRASE" | "EXACT" }>,
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Campaign-level negative keywords added",
              results: result,
            }, null, 2),
          }],
        };
      }

      case "google_ads_pause_keywords": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.pauseKeywords(
          customerId,
          args?.criterion_resource_names as string[],
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Keywords paused",
              results: result,
            }, null, 2),
          }],
        };
      }

      // ============================================
      // REPORTING HANDLERS
      // ============================================

      case "google_ads_keyword_performance": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.getKeywordPerformance(customerId, {
          startDate: args?.start_date as string,
          endDate: args?.end_date as string,
          keywordTextContains: args?.keyword_text_contains as string,
          campaignIds: args?.campaign_ids as string[],
          adGroupIds: args?.ad_group_ids as string[],
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "google_ads_keyword_performance_by_conversion": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.getKeywordPerformanceWithConversions(customerId, {
          startDate: args?.start_date as string,
          endDate: args?.end_date as string,
          keywordTextContains: args?.keyword_text_contains as string,
          campaignIds: args?.campaign_ids as string[],
          adGroupIds: args?.ad_group_ids as string[],
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "google_ads_search_term_report": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.getSearchTermReport(customerId, {
          startDate: args?.start_date as string,
          endDate: args?.end_date as string,
          keywordTextContains: args?.keyword_text_contains as string,
          searchTermContains: args?.search_term_contains as string,
          campaignIds: args?.campaign_ids as string[],
          adGroupIds: args?.ad_group_ids as string[],
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "google_ads_search_term_report_by_conversion": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.getSearchTermReportWithConversions(customerId, {
          startDate: args?.start_date as string,
          endDate: args?.end_date as string,
          keywordTextContains: args?.keyword_text_contains as string,
          searchTermContains: args?.search_term_contains as string,
          campaignIds: args?.campaign_ids as string[],
          adGroupIds: args?.ad_group_ids as string[],
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "google_ads_ad_performance": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.getAdPerformance(customerId, {
          startDate: args?.start_date as string,
          endDate: args?.end_date as string,
          campaignIds: args?.campaign_ids as string[],
          adGroupIds: args?.ad_group_ids as string[],
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "google_ads_ad_performance_by_conversion": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.getAdPerformanceWithConversions(customerId, {
          startDate: args?.start_date as string,
          endDate: args?.end_date as string,
          campaignIds: args?.campaign_ids as string[],
          adGroupIds: args?.ad_group_ids as string[],
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "google_ads_list_conversion_actions": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.listConversionActions(customerId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "google_ads_search_term_insights": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.getSearchTermInsights(customerId, {
          campaignId: args?.campaign_id as string,
          startDate: args?.start_date as string,
          endDate: args?.end_date as string,
          compareStartDate: args?.compare_start_date as string,
          compareEndDate: args?.compare_end_date as string,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "google_ads_search_term_insight_terms": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.getSearchTermInsightTerms(customerId, {
          campaignId: args?.campaign_id as string,
          insightId: args?.insight_id as string,
          startDate: args?.start_date as string,
          endDate: args?.end_date as string,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "google_ads_gaql_query": {
        const customerId = args?.customer_id as string || "";
        const query = args?.query as string;
        const result = await adsManager.executeGaql(customerId, query);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (rawError: any) {
    const error = classifyError(rawError);

    // Log classified error type to stderr for debugging
    console.error(`[error] ${error.name}: ${error.message}`);

    const response: Record<string, unknown> = {
      error: true,
      error_type: error.name,
      message: error.message,
    };

    if (error instanceof GoogleAdsAuthError) {
      response.action_required = "Re-authenticate: check refresh token in macOS Keychain. Token may be expired or revoked.";
      response.hint = "Run: security find-generic-password -a google-ads-drak -s GOOGLE_ADS_REFRESH_TOKEN -w";
    } else if (error instanceof GoogleAdsRateLimitError) {
      response.retry_after_ms = error.retryAfterMs;
      response.action_required = `Rate limited. Retry after ${Math.ceil(error.retryAfterMs / 1000)} seconds.`;
    } else if (error instanceof GoogleAdsServiceError) {
      response.action_required = "Google Ads API server error. This is transient — retry in a few minutes.";
    } else {
      response.details = rawError.errors || rawError.stack;
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify(response, null, 2),
      }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  // Startup health check: verify credentials work with a lightweight API call
  try {
    const firstClient = Object.values(config.clients)[0];
    if (firstClient) {
      const customer = adsManager.getCustomer(firstClient.customer_id);
      await customer.query(`SELECT customer.id FROM customer LIMIT 1`);
      console.error(`[startup] Auth verified: successfully queried account ${firstClient.customer_id} (${firstClient.name})`);
    }
  } catch (err: any) {
    const classified = classifyError(err);
    if (classified instanceof GoogleAdsAuthError) {
      console.error(`[STARTUP WARNING] Auth check FAILED: ${classified.message}`);
      console.error(`[STARTUP WARNING] MCP will start but ALL API calls will fail until auth is fixed.`);
    } else {
      console.error(`[startup] Auth check returned non-auth error (may be OK): ${err.message}`);
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[startup] MCP Google Ads server running");
}

main().catch(console.error);
