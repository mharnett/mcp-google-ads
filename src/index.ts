#!/usr/bin/env node

import { config as dotenvConfig } from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// On Windows, `new URL(import.meta.url).pathname` returns '/C:/path' with a
// leading slash that breaks path.join. fileURLToPath is the correct
// cross-platform conversion from file:// URL to a native OS path.
const __moduleDir = dirname(fileURLToPath(import.meta.url));

dotenvConfig({ path: join(__moduleDir, "..", ".env") });

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { tools } from "./tools.js";
import { validateRsa } from "./validateRsa.js";
import { GoogleAdsApi, enums, resources, MutateOperation } from "google-ads-api";
import { readFileSync, existsSync } from "fs";
import { z } from "zod";
import v8 from "v8";

// CLI package info
const __cliPkg = JSON.parse(readFileSync(join(__moduleDir, "..", "package.json"), "utf-8"));

// Log build fingerprint at startup
try {
  const buildInfo = JSON.parse(readFileSync(join(__moduleDir, "build-info.json"), "utf-8"));
  console.error(`[build] SHA: ${buildInfo.sha} (${buildInfo.builtAt})`);
} catch {
  console.error(`[build] ${__cliPkg.name}@${__cliPkg.version} (dev mode)`);
}

// Version safety: warn if running a deprecated or dangerously old version
const __minimumSafeVersion = "1.0.5"; // minimum version with GAQL sanitization
const __semverLt = (a: string, b: string) => { const pa = a.split(".").map(Number), pb = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) < (pb[i] || 0)) return true; if ((pa[i] || 0) > (pb[i] || 0)) return false; } return false; };
if (__semverLt(__cliPkg.version, __minimumSafeVersion)) {
  console.error(`[WARNING] Running deprecated version ${__cliPkg.version}. Minimum safe version is ${__minimumSafeVersion}. Please upgrade.`);
}

// CLI flags
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.error(`${__cliPkg.name} v${__cliPkg.version}\n`);
  console.error(`Usage: ${__cliPkg.name} [options]\n`);
  console.error("MCP server communicating via stdio. Configure in your .mcp.json.\n");
  console.error("Options:");
  console.error("  --help, -h       Show this help message");
  console.error("  --version, -v    Show version number");
  console.error(`\nDocumentation: https://github.com/mharnett/mcp-google-ads`);
  process.exit(0);
}
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.error(__cliPkg.version);
  process.exit(0);
}

// Startup: detect npx vs direct node
if (process.argv[1]?.includes('.npm/_npx')) {
  console.error("[startup] Running via npx -- first run may be slow due to package resolution");
}

// Startup: check heap size
const heapLimit = v8.getHeapStatistics().heap_size_limit;
if (heapLimit < 256 * 1024 * 1024) {
  console.error(`[startup] WARNING: Heap limit is ${Math.round(heapLimit / 1024 / 1024)}MB`);
}

// ============================================
// ENV VAR TRIMMING
// ============================================

const envTrimmed = (key: string): string => (process.env[key] || "").trim().replace(/^["']|["']$/g, "");

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
  // Try config.json first (for multi-client setups)
  const configPath = join(__moduleDir, "..", "config.json");
  if (existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  }

  // Fall back to the priority chain in credentials.ts:
  //   env vars > per-user credentials file (from mcp-google-ads-auth) > embedded build-time secrets
  // resolveCredentials() throws a descriptive Error (pointing at the auth helper)
  // if any required value is missing — let it propagate.
  const resolved = resolveCredentials();
  const stored = readStoredCredentials();

  return {
    google_ads: {
      mcc_customer_id: resolved.mcc_customer_id || "",
    },
    clients: {
      default: {
        customer_id: resolved.customer_id,
        name: stored?.customer_name || process.env.GOOGLE_ADS_ACCOUNT_NAME || "My Account",
        folder: "",
        mcc_customer_id: resolved.mcc_customer_id,
        direct_access: !resolved.mcc_customer_id,
      },
    },
    defaults: {
      create_paused: true,
      label_prefix: "claude:",
      require_approval_for_enable: true,
    },
  };
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
// GAQL SANITIZATION
// ============================================

/** Strip non-numeric characters from IDs used in GAQL WHERE clauses. */
function sanitizeNumericId(id: string): string {
  return id.replace(/[^0-9]/g, "");
}

/** Escape single quotes and backslashes in strings used in GAQL WHERE clauses. */
function escapeGaqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ============================================
// TYPED ERRORS & VALIDATION (extracted to errors.ts)
// ============================================

import {
  GoogleAdsAuthError,
  GoogleAdsRateLimitError,
  GoogleAdsServiceError,
  classifyError,
} from "./errors.js";

import { withResilience, safeResponse, logger } from "./resilience.js";
import {
  resolveCredentials,
  readStoredCredentials,
  validateResolvedCredentials,
  type ResolvedCredentials,
} from "./credentials.js";
import { onPosixSignal } from "./platform.js";

// ============================================
// GOOGLE ADS CLIENT
// ============================================

class GoogleAdsManager {
  private api: GoogleAdsApi;
  private config: Config;
  private defaultRefreshToken: string;

  constructor(config: Config) {
    this.config = config;

    // Resolve credentials via the priority chain (env > per-user file > embedded).
    // resolveCredentials() throws GoogleAdsAuthError-compatible Error with a
    // message pointing the user at `npx mcp-google-ads-auth` if anything is missing.
    let resolved: ResolvedCredentials;
    try {
      resolved = resolveCredentials();
    } catch (err) {
      const msg = (err as Error).message;
      logger.error({ err: msg }, "Credential resolution failed");
      throw new GoogleAdsAuthError(msg);
    }

    const formatCheck = validateResolvedCredentials(resolved);
    if (!formatCheck.valid) {
      const msg = `Credential format check failed: ${formatCheck.issues.join("; ")}. ` +
        `Re-run 'npx mcp-google-ads-auth' to refresh.`;
      logger.error({ issues: formatCheck.issues }, msg);
      throw new GoogleAdsAuthError(msg);
    }
    logger.info({ source: resolved.source }, "Credentials resolved");

    this.defaultRefreshToken = resolved.refresh_token;
    this.api = new GoogleAdsApi({
      client_id: resolved.client_id,
      client_secret: resolved.client_secret,
      developer_token: resolved.developer_token,
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
    const campaigns = await withResilience(
      () =>
        customer.query(`
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
    `),
      "listCampaigns"
    );
    return safeResponse(campaigns, "listCampaigns");
  }

  // Get campaign tracking parameters
  async getCampaignTracking(customerId: string, campaignId: string) {
    const customer = this.getCustomer(customerId);
    const result = await withResilience(
      () =>
        customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.tracking_url_template,
        campaign.final_url_suffix,
        campaign.url_custom_parameters
      FROM campaign
      WHERE campaign.id = ${campaignId}
    `),
      "getCampaignTracking"
    );

    if (result.length === 0) {
      throw new Error(`Campaign ${campaignId} not found`);
    }

    const campaign = result[0].campaign;
    return safeResponse({
      campaign_id: campaign?.id,
      campaign_name: campaign?.name,
      tracking_url_template: campaign?.tracking_url_template || null,
      final_url_suffix: campaign?.final_url_suffix || null,
      url_custom_parameters: campaign?.url_custom_parameters || [],
    }, "getCampaignTracking");
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
      query += ` AND campaign.id = ${sanitizeNumericId(campaignId)}`;
    }
    query += ` ORDER BY campaign.name, ad_group.name`;
    const result = await withResilience(() => customer.query(query), "listAdGroups");
    return safeResponse(result, "listAdGroups");
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
      query += ` AND campaign.id = ${sanitizeNumericId(options.campaignId)}`;
    }
    if (options.adGroupId) {
      query += ` AND ad_group.id = ${sanitizeNumericId(options.adGroupId)}`;
    }
    query += ` ORDER BY campaign.name, ad_group.name`;
    const result = await withResilience(() => customer.query(query), "listAds");
    return safeResponse(result, "listAds");
  }

  // List pending changes (paused items with claude- label)
  async listPendingChanges(customerId: string) {
    const customer = this.getCustomer(customerId);

    // Get paused campaigns with claude label
    const campaigns = await withResilience(
      () =>
        customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        label.name
      FROM campaign
      WHERE campaign.status = 'PAUSED'
        AND label.name LIKE 'claude-%'
    `),
      "listPendingChanges.campaigns"
    );

    // Get paused ad groups with claude label
    const adGroups = await withResilience(
      () =>
        customer.query(`
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        campaign.name,
        label.name
      FROM ad_group
      WHERE ad_group.status = 'PAUSED'
        AND label.name LIKE 'claude-%'
    `),
      "listPendingChanges.adGroups"
    );

    // Get paused ads with claude label
    const ads = await withResilience(
      () =>
        customer.query(`
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
    `),
      "listPendingChanges.ads"
    );

    return safeResponse({ campaigns, adGroups, ads }, "listPendingChanges");
  }

  // Create a label
  async createLabel(customerId: string, labelName: string) {
    const customer = this.getCustomer(customerId);
    const label = {
      name: labelName,
      status: enums.LabelStatus.ENABLED,
    };

    try {
      const result = await withResilience(() => customer.labels.create([label]), "createLabel");
      return result;
    } catch (e: any) {
      // Label might already exist
      if (e.message?.includes("DUPLICATE_NAME")) {
        return { existing: true, name: labelName };
      }
      throw e;
    }
  }

  // Ensure a label exists, returning its resource name
  async ensureLabelExists(customerId: string, labelName: string): Promise<string> {
    const customer = this.getCustomer(customerId);
    const cleanId = customerId.replace(/-/g, "");

    // Check if label already exists
    const safeName = escapeGaqlString(labelName);
    const existing = await withResilience(
      () => customer.query(
        `SELECT label.resource_name, label.name FROM label WHERE label.name = '` + safeName + `' AND label.status = 'ENABLED'`
      ),
      "ensureLabelExists.query"
    );

    if (existing.length > 0) {
      return (existing[0] as any).label.resource_name;
    }

    // Create it
    const result = await this.createLabel(customerId, labelName);
    if ((result as any).existing) {
      // Race condition: re-query
      const requery = await withResilience(
        () => customer.query(
          `SELECT label.resource_name FROM label WHERE label.name = '` + safeName + `' AND label.status = 'ENABLED'`
        ),
        "ensureLabelExists.requery"
      );
      return (requery[0] as any).label.resource_name;
    }
    return (result as any).results[0].resource_name;
  }

  // Apply a label to ad group criteria (keywords)
  async labelAdGroupCriteria(customerId: string, criterionResourceNames: string[], labelResourceName: string) {
    const customer = this.getCustomer(customerId);

    const operations = criterionResourceNames.map(rn => ({
      ad_group_criterion: rn,
      label: labelResourceName,
    }));

    const result = await withResilience(
      () => customer.adGroupCriterionLabels.create(operations),
      "labelAdGroupCriteria"
    );
    return result;
  }

  // Apply a label to campaigns
  async labelCampaigns(customerId: string, campaignResourceNames: string[], labelResourceName: string) {
    const customer = this.getCustomer(customerId);
    const operations = campaignResourceNames.map(rn => ({ campaign: rn, label: labelResourceName }));
    return withResilience(() => customer.campaignLabels.create(operations), "labelCampaigns");
  }

  // Apply a label to ad groups
  async labelAdGroups(customerId: string, adGroupResourceNames: string[], labelResourceName: string) {
    const customer = this.getCustomer(customerId);
    const operations = adGroupResourceNames.map(rn => ({ ad_group: rn, label: labelResourceName }));
    return withResilience(() => customer.adGroupLabels.create(operations), "labelAdGroups");
  }

  // Apply a label to ads (ad_group_ad level)
  async labelAdGroupAds(customerId: string, adGroupAdResourceNames: string[], labelResourceName: string) {
    const customer = this.getCustomer(customerId);
    const operations = adGroupAdResourceNames.map(rn => ({ ad_group_ad: rn, label: labelResourceName }));
    return withResilience(() => customer.adGroupAdLabels.create(operations), "labelAdGroupAds");
  }

  // Today's audit label in Claude-MM-DD-YY format (GLOBAL rule: every Claude-created asset gets this)
  private todayClaudeLabel(): string {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(-2);
    return `Claude-${mm}-${dd}-${yy}`;
  }

  // Apply today's Claude-MM-DD-YY label to newly created assets.
  // Best-effort: log and swallow errors so creation never fails because of labeling.
  // `assetType` selects which *Labels endpoint to hit.
  private async autoLabelCreated(
    customerId: string,
    resourceNames: string[],
    assetType: "campaign" | "ad_group" | "ad" | "keyword" | "shared_set"
  ): Promise<string | null> {
    if (!resourceNames?.length) return null;
    const labelName = this.todayClaudeLabel();
    try {
      const labelRN = await this.ensureLabelExists(customerId, labelName);
      switch (assetType) {
        case "campaign":
          await this.labelCampaigns(customerId, resourceNames, labelRN);
          break;
        case "ad_group":
          await this.labelAdGroups(customerId, resourceNames, labelRN);
          break;
        case "ad":
          await this.labelAdGroupAds(customerId, resourceNames, labelRN);
          break;
        case "keyword":
          await this.labelAdGroupCriteria(customerId, resourceNames, labelRN);
          break;
        case "shared_set": {
          // No campaign/ad_group/ad_group_ad equivalent exists for shared_set in all API versions.
          // Attempt via customer.sharedSetLabels if available; otherwise log and skip.
          const customer = this.getCustomer(customerId);
          const sharedSetLabels = (customer as any).sharedSetLabels;
          if (sharedSetLabels?.create) {
            const ops = resourceNames.map(rn => ({ shared_set: rn, label: labelRN }));
            await withResilience(() => sharedSetLabels.create(ops), "labelSharedSets");
          } else {
            console.error(`[INFO] sharedSetLabels endpoint not available — skipping auto-label for shared set`);
          }
          break;
        }
      }
      return labelName;
    } catch (e: any) {
      console.error(`[WARN] autoLabelCreated(${assetType}) failed for '${labelName}': ${e.message}`);
      return null;
    }
  }

  // Update campaign budget — either in-place or by creating a new solo budget
  async updateCampaignBudget(customerId: string, campaignId: string, dailyBudgetDollars: number, createNewBudget: boolean = false) {
    const customer = this.getCustomer(customerId);
    const cleanId = customerId.replace(/-/g, "");

    // Get current campaign and budget info
    const [currentCampaign] = await withResilience(
      () =>
        customer.query(`
      SELECT campaign.name, campaign.id, campaign_budget.id, campaign_budget.amount_micros, campaign_budget.name
      FROM campaign
      WHERE campaign.id = ${campaignId}
    `),
      "updateCampaignBudget.query"
    );

    if (!currentCampaign?.campaign?.name || !currentCampaign?.campaign_budget?.id) {
      throw new Error(`Campaign ${campaignId} not found or has no budget`);
    }

    const campaignName = currentCampaign.campaign.name;
    const oldBudgetId = currentCampaign.campaign_budget.id;
    const oldAmountMicros = currentCampaign.campaign_budget.amount_micros ?? 0;
    const newAmountMicros = Math.round(dailyBudgetDollars * 1_000_000);

    if (createNewBudget) {
      // Create a new budget and reassign the campaign to it
      const budgetResult = await withResilience(
        () =>
          customer.campaignBudgets.create([{
            name: `${campaignName} Budget`,
            amount_micros: newAmountMicros,
            delivery_method: enums.BudgetDeliveryMethod.STANDARD,
          }]),
        "updateCampaignBudget.createBudget"
      );

      const newBudgetResourceName = budgetResult.results[0].resource_name;

      // Update the campaign to use the new budget
      await withResilience(
        () =>
          customer.campaigns.update([{
            resource_name: `customers/${cleanId}/campaigns/${campaignId}`,
            campaign_budget: newBudgetResourceName,
          }]),
        "updateCampaignBudget.reassignCampaign"
      );

      return {
        campaign_id: campaignId,
        campaign_name: campaignName,
        action: "created_new_budget",
        old_budget_id: oldBudgetId,
        old_daily_budget: Number(oldAmountMicros) / 1_000_000,
        new_budget_resource: newBudgetResourceName,
        new_daily_budget: dailyBudgetDollars,
      };
    } else {
      // Update existing budget amount in place
      await withResilience(
        () =>
          customer.campaignBudgets.update([{
            resource_name: `customers/${cleanId}/campaignBudgets/${oldBudgetId}`,
            amount_micros: newAmountMicros,
          }]),
        "updateCampaignBudget.updateInPlace"
      );

      return {
        campaign_id: campaignId,
        campaign_name: campaignName,
        action: "updated_in_place",
        budget_id: oldBudgetId,
        old_daily_budget: Number(oldAmountMicros) / 1_000_000,
        new_daily_budget: dailyBudgetDollars,
        warning: "This update affects ALL campaigns sharing this budget",
      };
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
    const budgetResult = await withResilience(
      () =>
        customer.campaignBudgets.create([{
          name: `${campaign.name} Budget`,
          amount_micros: campaign.budget_amount_micros,
          delivery_method: enums.BudgetDeliveryMethod.STANDARD,
        }]),
      "createCampaign.budget"
    );

    const budgetResourceName = budgetResult.results[0].resource_name;

    // Then create the campaign
    const campaignResult = await withResilience(
      () =>
        customer.campaigns.create([{
          name: campaign.name,
          status: enums.CampaignStatus.PAUSED, // Always create paused
          advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
          campaign_budget: budgetResourceName,
          manual_cpc: {}, // Default to manual CPC
        }]),
      "createCampaign"
    );

    // GLOBAL rule: auto-apply Claude-MM-DD-YY label to the new campaign
    const campaignRNs = ((campaignResult as any).results || []).map((r: any) => r.resource_name).filter(Boolean);
    await this.autoLabelCreated(customerId, campaignRNs, "campaign");

    return campaignResult;
  }

  // Create an ad group (paused by default)
  async createAdGroup(customerId: string, adGroup: {
    name: string;
    campaign_id: string;
    cpc_bid_micros?: number;
  }) {
    const customer = this.getCustomer(customerId);

    const result = await withResilience(
      () =>
        customer.adGroups.create([{
          name: adGroup.name,
          campaign: `customers/${customerId.replace(/-/g, "")}/campaigns/${adGroup.campaign_id}`,
          status: enums.AdGroupStatus.PAUSED, // Always create paused
          cpc_bid_micros: adGroup.cpc_bid_micros || 1000000, // $1.00 default
          type: enums.AdGroupType.SEARCH_STANDARD,
        }]),
      "createAdGroup"
    );

    // GLOBAL rule: auto-apply Claude-MM-DD-YY label to the new ad group
    const adGroupRNs = ((result as any).results || []).map((r: any) => r.resource_name).filter(Boolean);
    await this.autoLabelCreated(customerId, adGroupRNs, "ad_group");

    return result;
  }

  // Create a responsive search ad (paused by default)
  async createResponsiveSearchAd(customerId: string, ad: {
    ad_group_id: string;
    final_urls: string[];
    headlines: Array<string | { text: string; pinned_position?: number }>; // max 15
    descriptions: Array<string | { text: string; pinned_position?: number }>; // max 4
    path1: string;
    path2: string;
    /** Additional labels to attach beyond the auto-applied claude-YYYY-MM-DD. */
    labels?: string[];
  }) {
    const customer = this.getCustomer(customerId);

    // Normalize to { text, pinned_position? } format
    const normalizedHeadlines = ad.headlines.map(h =>
      typeof h === "string" ? { text: h } : h
    );
    const normalizedDescriptions = ad.descriptions.map(d =>
      typeof d === "string" ? { text: d } : d
    );

    // Run the same lint rules the google_ads_validate_ad tool enforces.
    // The auto-label satisfies the ≥1 label requirement, so we pass a
    // synthetic label through to the validator (additional caller-supplied
    // labels in ad.labels are tacked on after creation alongside the
    // auto-date label).
    const validation = validateRsa({
      headlines: normalizedHeadlines.map(h => h.text),
      descriptions: normalizedDescriptions.map(d => d.text),
      final_urls: ad.final_urls,
      path1: ad.path1,
      path2: ad.path2,
      labels: ["__auto_claude_label__", ...(ad.labels ?? [])],
    });
    if (!validation.valid) {
      throw new Error("RSA validation failed:\n" + validation.errors.join("\n"));
    }

    // Map pinned_position to ServedAssetFieldType enum values
    const HEADLINE_PIN_MAP: Record<number, number> = { 1: 2, 2: 3, 3: 4 }; // HEADLINE_1=2, HEADLINE_2=3, HEADLINE_3=4
    const DESCRIPTION_PIN_MAP: Record<number, number> = { 1: 5, 2: 6 }; // DESCRIPTION_1=5, DESCRIPTION_2=6

    const result = await withResilience(
      () =>
        customer.adGroupAds.create([{
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
        }]),
      "createResponsiveSearchAd"
    );

    // GLOBAL rule: auto-apply Claude-MM-DD-YY label to the new ad
    const adRNs = ((result as any).results || []).map((r: any) => r.resource_name).filter(Boolean);
    await this.autoLabelCreated(customerId, adRNs, "ad");

    return result;
  }

  // Create keywords (paused by default, auto-labeled for discoverability)
  async createKeywords(customerId: string, keywords: {
    ad_group_id: string;
    keywords: Array<{ text: string; match_type: "BROAD" | "PHRASE" | "EXACT" }>;
    label?: string;
  }) {
    const customer = this.getCustomer(customerId);
    const cleanId = customerId.replace(/-/g, "");

    const keywordCriteria = keywords.keywords.map(kw => ({
      ad_group: `customers/${cleanId}/adGroups/${keywords.ad_group_id}`,
      status: enums.AdGroupCriterionStatus.PAUSED, // Always create paused
      keyword: {
        text: kw.text,
        match_type: enums.KeywordMatchType[kw.match_type],
      },
    }));

    const result = await withResilience(() => customer.adGroupCriteria.create(keywordCriteria), "createKeywords");

    const criterionRNs = ((result as any).results || []).map((r: any) => r.resource_name).filter(Boolean);

    // GLOBAL rule: always apply today's Claude-MM-DD-YY audit label
    await this.autoLabelCreated(customerId, criterionRNs, "keyword");

    // Optional user-supplied workflow label (e.g. claude:pending for discoverability)
    const workflowLabel = keywords.label || `${this.config.defaults.label_prefix}pending`;
    try {
      const labelRN = await this.ensureLabelExists(customerId, workflowLabel);
      await this.labelAdGroupCriteria(customerId, criterionRNs, labelRN);
    } catch (e: any) {
      console.error(`[WARN] Failed to apply workflow label '${workflowLabel}' to keywords: ${e.message}`);
    }

    return result;
  }

  // Pause keywords (ad group criteria)
  async pauseKeywords(customerId: string, criterionResourceNames: string[]) {
    const customer = this.getCustomer(customerId);

    const operations = criterionResourceNames.map(rn => ({
      resource_name: rn,
      status: enums.AdGroupCriterionStatus.PAUSED,
    }));

    const result = await withResilience(() => customer.adGroupCriteria.update(operations), "pauseKeywords");
    return result;
  }

  // Create a new shared negative keyword list at account level
  async createSharedSet(customerId: string, name: string) {
    const customer = this.getCustomer(customerId);

    const sharedSet: resources.ISharedSet = {
      name,
      type: enums.SharedSetType.NEGATIVE_KEYWORDS,
      status: enums.SharedSetStatus.ENABLED,
    };

    const result = await withResilience(() => customer.sharedSets.create([sharedSet]), "createSharedSet");

    // GLOBAL rule: auto-apply Claude-MM-DD-YY label to the new shared set
    const sharedSetRNs = ((result as any).results || []).map((r: any) => r.resource_name).filter(Boolean);
    await this.autoLabelCreated(customerId, sharedSetRNs, "shared_set");

    return result;
  }

  // Link a shared set to campaigns
  async linkSharedSetToCampaigns(customerId: string, sharedSetId: string, campaignIds: string[]) {
    const customer = this.getCustomer(customerId);
    const cleanId = customerId.replace(/-/g, "");

    const campaignSharedSets = campaignIds.map(cid => ({
      campaign: `customers/${cleanId}/campaigns/${cid}`,
      shared_set: `customers/${cleanId}/sharedSets/${sharedSetId}`,
    }));

    const result = await withResilience(() => customer.campaignSharedSets.create(campaignSharedSets), "linkSharedSetToCampaigns");
    return result;
  }

  // Add keywords to a shared negative keyword list
  async addSharedNegativeKeywords(customerId: string, sharedSetId: string, keywords: Array<{ text: string; match_type: "BROAD" | "PHRASE" | "EXACT" }>) {
    const customer = this.getCustomer(customerId);
    const cleanId = customerId.replace(/-/g, "");

    const sharedCriteria: resources.ISharedCriterion[] = keywords.map(kw => ({
      shared_set: `customers/${cleanId}/sharedSets/${sharedSetId}`,
      keyword: {
        text: kw.text,
        match_type: enums.KeywordMatchType[kw.match_type],
      },
    }));

    const result = await withResilience(() => customer.sharedCriteria.create(sharedCriteria), "addSharedNegativeKeywords");
    return result;
  }

  // Unlink a shared set from campaigns
  async unlinkSharedSetFromCampaigns(customerId: string, sharedSetId: string, campaignIds: string[]) {
    const customer = this.getCustomer(customerId);
    const cleanId = customerId.replace(/-/g, "");

    const resourceNames = campaignIds.map(cid =>
      `customers/${cleanId}/campaignSharedSets/${cid}~${sharedSetId}`
    );

    const result = await withResilience(() => customer.campaignSharedSets.remove(resourceNames), "unlinkSharedSetFromCampaigns");
    return result;
  }

  // Remove negative keywords from a shared negative keyword list
  async removeSharedNegativeKeywords(customerId: string, resourceNames: string[]) {
    const customer = this.getCustomer(customerId);
    const result = await withResilience(() => customer.sharedCriteria.remove(resourceNames), "removeSharedNegativeKeywords");
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

    const result = await withResilience(() => customer.campaignCriteria.create(criteria), "addCampaignNegativeKeywords");
    return result;
  }

  // Remove campaign-level negative keywords by resource name
  async removeCampaignNegativeKeywords(customerId: string, resourceNames: string[]) {
    const customer = this.getCustomer(customerId);
    const result = await withResilience(() => customer.campaignCriteria.remove(resourceNames), "removeCampaignNegativeKeywords");
    return result;
  }

  // Remove ad-group-level negative keywords by resource name
  async removeAdGroupNegativeKeywords(customerId: string, resourceNames: string[]) {
    const customer = this.getCustomer(customerId);
    const result = await withResilience(() => customer.adGroupCriteria.remove(resourceNames), "removeAdGroupNegativeKeywords");
    return result;
  }

  // Enable ads (auto-labels with today's Claude-MM-DD-YY + any custom labels)
  async enableAds(customerId: string, adIds: string[], labels?: string[]) {
    const customer = this.getCustomer(customerId);

    const resourceNames = adIds.map(
      adId => `customers/${customerId.replace(/-/g, "")}/adGroupAds/${adId}`
    );
    const operations = resourceNames.map(rn => ({
      resource_name: rn,
      status: enums.AdGroupAdStatus.ENABLED,
    }));

    const result = await withResilience(() => customer.adGroupAds.update(operations), "enableAds");
    await this.autoLabelCreated(customerId, resourceNames, "ad");
    await this.applyCustomLabels(customerId, resourceNames, "ad", labels);
    return result;
  }

  // Enable ad groups (auto-labels with today's Claude-MM-DD-YY + any custom labels)
  async enableAdGroups(customerId: string, adGroupIds: string[], labels?: string[]) {
    const customer = this.getCustomer(customerId);

    const resourceNames = adGroupIds.map(
      id => `customers/${customerId.replace(/-/g, "")}/adGroups/${id}`
    );
    const operations = resourceNames.map(rn => ({
      resource_name: rn,
      status: enums.AdGroupStatus.ENABLED,
    }));

    const result = await withResilience(() => customer.adGroups.update(operations), "enableAdGroups");
    await this.autoLabelCreated(customerId, resourceNames, "ad_group");
    await this.applyCustomLabels(customerId, resourceNames, "ad_group", labels);
    return result;
  }

  // Enable campaigns (auto-labels with today's Claude-MM-DD-YY + any custom labels)
  async enableCampaigns(customerId: string, campaignIds: string[], labels?: string[]) {
    const customer = this.getCustomer(customerId);

    const resourceNames = campaignIds.map(
      id => `customers/${customerId.replace(/-/g, "")}/campaigns/${id}`
    );
    const operations = resourceNames.map(rn => ({
      resource_name: rn,
      status: enums.CampaignStatus.ENABLED,
    }));

    const result = await withResilience(() => customer.campaigns.update(operations), "enableCampaigns");
    await this.autoLabelCreated(customerId, resourceNames, "campaign");
    await this.applyCustomLabels(customerId, resourceNames, "campaign", labels);
    return result;
  }

  // Apply one or more custom labels to resources of a given asset type.
  // Best-effort: logs and swallows errors so the calling mutation isn't rolled
  // back on a labeling failure. Creates labels that don't yet exist.
  private async applyCustomLabels(
    customerId: string,
    resourceNames: string[],
    assetType: "campaign" | "ad_group" | "ad" | "keyword",
    labelNames: string[] | undefined
  ): Promise<void> {
    const clean = (labelNames ?? []).map(l => l?.trim()).filter((l): l is string => !!l);
    if (clean.length === 0 || resourceNames.length === 0) return;
    for (const labelName of clean) {
      try {
        const labelRN = await this.ensureLabelExists(customerId, labelName);
        switch (assetType) {
          case "campaign":
            await this.labelCampaigns(customerId, resourceNames, labelRN);
            break;
          case "ad_group":
            await this.labelAdGroups(customerId, resourceNames, labelRN);
            break;
          case "ad":
            await this.labelAdGroupAds(customerId, resourceNames, labelRN);
            break;
          case "keyword":
            await this.labelAdGroupCriteria(customerId, resourceNames, labelRN);
            break;
        }
      } catch (e: any) {
        console.error(`[WARN] applyCustomLabels(${assetType}, '${labelName}') failed: ${e.message}`);
      }
    }
  }

  // Pause ads (auto-labels with today's Claude-MM-DD-YY + any custom labels)
  async pauseAds(customerId: string, adIds: string[], labels?: string[]) {
    const customer = this.getCustomer(customerId);

    const resourceNames = adIds.map(
      adId => `customers/${customerId.replace(/-/g, "")}/adGroupAds/${adId}`
    );
    const operations = resourceNames.map(rn => ({
      resource_name: rn,
      status: enums.AdGroupAdStatus.PAUSED,
    }));

    const result = await withResilience(() => customer.adGroupAds.update(operations), "pauseAds");
    await this.autoLabelCreated(customerId, resourceNames, "ad");
    await this.applyCustomLabels(customerId, resourceNames, "ad", labels);
    return result;
  }

  // Pause ad groups (auto-labels with today's Claude-MM-DD-YY + any custom labels)
  async pauseAdGroups(customerId: string, adGroupIds: string[], labels?: string[]) {
    const customer = this.getCustomer(customerId);

    const resourceNames = adGroupIds.map(
      id => `customers/${customerId.replace(/-/g, "")}/adGroups/${id}`
    );
    const operations = resourceNames.map(rn => ({
      resource_name: rn,
      status: enums.AdGroupStatus.PAUSED,
    }));

    const result = await withResilience(() => customer.adGroups.update(operations), "pauseAdGroups");
    await this.autoLabelCreated(customerId, resourceNames, "ad_group");
    await this.applyCustomLabels(customerId, resourceNames, "ad_group", labels);
    return result;
  }

  // Pause campaigns (auto-labels with today's Claude-MM-DD-YY + any custom labels)
  async pauseCampaigns(customerId: string, campaignIds: string[], labels?: string[]) {
    const customer = this.getCustomer(customerId);

    const resourceNames = campaignIds.map(
      id => `customers/${customerId.replace(/-/g, "")}/campaigns/${id}`
    );
    const operations = resourceNames.map(rn => ({
      resource_name: rn,
      status: enums.CampaignStatus.PAUSED,
    }));

    const result = await withResilience(() => customer.campaigns.update(operations), "pauseCampaigns");
    await this.autoLabelCreated(customerId, resourceNames, "campaign");
    await this.applyCustomLabels(customerId, resourceNames, "campaign", labels);
    return result;
  }

  // Update campaign tracking parameters (final_url_suffix, tracking_url_template, custom params)
  async updateCampaignTracking(customerId: string, campaignId: string, updates: {
    final_url_suffix?: string;
    tracking_url_template?: string;
    url_custom_parameters?: Array<{ key: string; value: string }>;
  }) {
    const customer = this.getCustomer(customerId);
    const cleanId = customerId.replace(/-/g, "");

    const campaignUpdate: any = {
      resource_name: `customers/${cleanId}/campaigns/${campaignId}`,
    };

    if (updates.final_url_suffix !== undefined) {
      campaignUpdate.final_url_suffix = updates.final_url_suffix;
    }
    if (updates.tracking_url_template !== undefined) {
      campaignUpdate.tracking_url_template = updates.tracking_url_template;
    }
    if (updates.url_custom_parameters !== undefined) {
      campaignUpdate.url_custom_parameters = updates.url_custom_parameters;
    }

    const result = await withResilience(() => customer.campaigns.update([campaignUpdate]), "updateCampaignTracking");
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
      query += ` AND ad_group_criterion.keyword.text LIKE '%${escapeGaqlString(options.keywordTextContains)}%'`;
    }
    if (options.campaignIds && options.campaignIds.length > 0) {
      query += ` AND campaign.id IN (${options.campaignIds.map(sanitizeNumericId).join(",")})`;
    }
    if (options.adGroupIds && options.adGroupIds.length > 0) {
      query += ` AND ad_group.id IN (${options.adGroupIds.map(sanitizeNumericId).join(",")})`;
    }

    query += ` ORDER BY metrics.cost_micros DESC`;

    const result = await withResilience(() => customer.query(query), "getKeywordPerformance");
    return safeResponse(result, "getKeywordPerformance");
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
      query += ` AND ad_group_criterion.keyword.text LIKE '%${escapeGaqlString(options.keywordTextContains)}%'`;
    }
    if (options.campaignIds && options.campaignIds.length > 0) {
      query += ` AND campaign.id IN (${options.campaignIds.map(sanitizeNumericId).join(",")})`;
    }
    if (options.adGroupIds && options.adGroupIds.length > 0) {
      query += ` AND ad_group.id IN (${options.adGroupIds.map(sanitizeNumericId).join(",")})`;
    }

    query += ` ORDER BY ad_group_criterion.keyword.text, segments.conversion_action_name`;

    const result = await withResilience(() => customer.query(query), "getKeywordPerformanceWithConversions");
    return safeResponse(result, "getKeywordPerformanceWithConversions");
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
      query += ` AND search_term_view.search_term LIKE '%${escapeGaqlString(options.searchTermContains)}%'`;
    }
    if (options.campaignIds && options.campaignIds.length > 0) {
      query += ` AND campaign.id IN (${options.campaignIds.map(sanitizeNumericId).join(",")})`;
    }
    if (options.adGroupIds && options.adGroupIds.length > 0) {
      query += ` AND ad_group.id IN (${options.adGroupIds.map(sanitizeNumericId).join(",")})`;
    }

    query += ` ORDER BY metrics.impressions DESC`;

    const result = await withResilience(() => customer.query(query), "getSearchTermReport");
    return safeResponse(result, "getSearchTermReport");
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
      query += ` AND search_term_view.search_term LIKE '%${escapeGaqlString(options.searchTermContains)}%'`;
    }
    if (options.campaignIds && options.campaignIds.length > 0) {
      query += ` AND campaign.id IN (${options.campaignIds.map(sanitizeNumericId).join(",")})`;
    }
    if (options.adGroupIds && options.adGroupIds.length > 0) {
      query += ` AND ad_group.id IN (${options.adGroupIds.map(sanitizeNumericId).join(",")})`;
    }

    query += ` ORDER BY search_term_view.search_term, segments.conversion_action_name`;

    const result = await withResilience(() => customer.query(query), "getSearchTermReportWithConversions");
    return safeResponse(result, "getSearchTermReportWithConversions");
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
      query += ` AND campaign.id IN (${options.campaignIds.map(sanitizeNumericId).join(",")})`;
    }
    if (options.adGroupIds && options.adGroupIds.length > 0) {
      query += ` AND ad_group.id IN (${options.adGroupIds.map(sanitizeNumericId).join(",")})`;
    }

    query += ` ORDER BY metrics.impressions DESC`;

    const result = await withResilience(() => customer.query(query), "getAdPerformance");
    return safeResponse(result, "getAdPerformance");
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
      query += ` AND campaign.id IN (${options.campaignIds.map(sanitizeNumericId).join(",")})`;
    }
    if (options.adGroupIds && options.adGroupIds.length > 0) {
      query += ` AND ad_group.id IN (${options.adGroupIds.map(sanitizeNumericId).join(",")})`;
    }

    query += ` ORDER BY ad_group_ad.ad.id, segments.conversion_action_name`;

    const result = await withResilience(() => customer.query(query), "getAdPerformanceWithConversions");
    return safeResponse(result, "getAdPerformanceWithConversions");
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

    const result = await withResilience(() => customer.query(query), "listConversionActions");
    return safeResponse(result, "listConversionActions");
  }

  // Validate an ad without creating it
  async validateAd(_customerId: string, ad: {
    headlines: string[];
    descriptions: string[];
    final_urls: string[];
    path1?: string;
    path2?: string;
    labels?: string[];
  }) {
    // Delegates to the pure validateRsa() function so the logic can be
    // unit-tested without instantiating the full manager. Enforces path1,
    // path2, and at least 1 label in addition to the headline/description/
    // final_url rules that were already in place.
    return validateRsa(ad);
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
    const safeCampaignId = sanitizeNumericId(options.campaignId);
    const safeStartDate = escapeGaqlString(options.startDate);
    const safeEndDate = escapeGaqlString(options.endDate);

    // Current period - get categories with metrics
    const currentQuery =
      `SELECT campaign_search_term_insight.campaign_id, campaign_search_term_insight.category_label, campaign_search_term_insight.id, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM campaign_search_term_insight WHERE campaign_search_term_insight.campaign_id = '` + safeCampaignId + `' AND segments.date BETWEEN '` + safeStartDate + `' AND '` + safeEndDate + `'`;

    const currentResults = await withResilience(() => customer.query(currentQuery), "getSearchTermInsights.current");

    // If comparison dates provided, get previous period too
    let previousResults: any[] = [];
    if (options.compareStartDate && options.compareEndDate) {
      const safeCompStart = escapeGaqlString(options.compareStartDate);
      const safeCompEnd = escapeGaqlString(options.compareEndDate);
      const prevQuery =
        `SELECT campaign_search_term_insight.campaign_id, campaign_search_term_insight.category_label, campaign_search_term_insight.id, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM campaign_search_term_insight WHERE campaign_search_term_insight.campaign_id = '` + safeCampaignId + `' AND segments.date BETWEEN '` + safeCompStart + `' AND '` + safeCompEnd + `'`;
      previousResults = await withResilience(() => customer.query(prevQuery), "getSearchTermInsights.previous");
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

    return safeResponse({
      campaign_id: options.campaignId,
      current_period: { start: options.startDate, end: options.endDate },
      compare_period: options.compareStartDate ? { start: options.compareStartDate, end: options.compareEndDate } : null,
      total_categories: categories.length,
      categories,
    }, "getSearchTermInsights");
  }

  // Get individual search terms within a specific insight category
  async getSearchTermInsightTerms(customerId: string, options: {
    campaignId: string;
    insightId: string;
    startDate: string;
    endDate: string;
  }) {
    const customer = this.getCustomer(customerId);
    const safeCampId = sanitizeNumericId(options.campaignId);
    const safeInsId = sanitizeNumericId(options.insightId);
    const safeStart = escapeGaqlString(options.startDate);
    const safeEnd = escapeGaqlString(options.endDate);

    const query =
      `SELECT campaign_search_term_insight.campaign_id, campaign_search_term_insight.category_label, campaign_search_term_insight.id, segments.search_term, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM campaign_search_term_insight WHERE campaign_search_term_insight.campaign_id = '` + safeCampId + `' AND campaign_search_term_insight.id = '` + safeInsId + `' AND segments.date BETWEEN '` + safeStart + `' AND '` + safeEnd + `'`;

    const result = await withResilience(() => customer.query(query), "getSearchTermInsightTerms");
    return safeResponse(result, "getSearchTermInsightTerms");
  }

  // Execute a raw GAQL query
  async executeGaql(customerId: string, query: string) {
    const customer = this.getCustomer(customerId);
    const result = await withResilience(() => customer.query(query), "executeGaql");
    return safeResponse(result, "executeGaql");
  }

  async keywordVolume(
    customerId: string,
    keywords: string[],
    geoTargetConstants: string[] = ["geoTargetConstants/2840"],
    language: string = "languageConstants/1000"
  ) {
    const customer = this.getCustomer(customerId);
    const response = await withResilience(
      () => customer.keywordPlanIdeas.generateKeywordHistoricalMetrics({
        customer_id: customerId.replace(/-/g, ""),
        keywords,
        geo_target_constants: geoTargetConstants,
        language,
        keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH,
        include_adult_keywords: false,
      } as any),
      "keywordVolume"
    );

    const results = (response as any).results ?? [];
    return results.map((r: any) => ({
      keyword: r.text,
      avg_monthly_searches: r.keyword_metrics?.avg_monthly_searches ?? null,
      competition: r.keyword_metrics?.competition ?? null,
      competition_index: r.keyword_metrics?.competition_index ?? null,
      low_top_of_page_bid_micros: r.keyword_metrics?.low_top_of_page_bid_micros ?? null,
      high_top_of_page_bid_micros: r.keyword_metrics?.high_top_of_page_bid_micros ?? null,
    }));
  }
}

// ============================================
// MCP SERVER
// ============================================

const config = loadConfig();
const adsManager = new GoogleAdsManager(config);

const server = new Server(
  {
    name: __cliPkg.name,
    version: __cliPkg.version,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

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
          path1: args?.path1 as string | undefined,
          path2: args?.path2 as string | undefined,
          labels: args?.labels as string[] | undefined,
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
        const daily_budget = args?.daily_budget as number;

        // Budget validation: reject $0 and negative budgets
        if (daily_budget !== undefined && daily_budget <= 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "daily_budget must be positive (in dollars, e.g., 10 = $10/day)" }, null, 2),
            }],
          };
        }

        // Campaign name sanitization: strip HTML tags
        const rawName = args?.name as string;
        const sanitizedName = rawName.replace(/<[^>]*>/g, "");
        if (sanitizedName !== rawName) {
          console.error(`[warning] Stripped HTML from campaign name: "${rawName}" -> "${sanitizedName}"`);
        }

        const result = await adsManager.createCampaign(customerId, {
          name: sanitizedName,
          budget_amount_micros: Math.round(daily_budget * 1000000),
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
          cpc_bid_micros: args?.cpc_bid ? Math.round((args.cpc_bid as number) * 1000000) : undefined,
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
        const extraLabels = (args?.labels as string[] | undefined) ?? [];

        // Validate first (the create path also runs validateRsa, but we
        // validate here too so the tool returns a clean error rather than
        // throwing). The auto-applied claude-YYYY-MM-DD label satisfies the
        // ≥1 label requirement; any extraLabels are bonus.
        const validation = await adsManager.validateAd(customerId, {
          headlines: headlineTexts,
          descriptions: descriptionTexts,
          final_urls: args?.final_urls as string[],
          path1: args?.path1 as string | undefined,
          path2: args?.path2 as string | undefined,
          labels: ["__auto_claude_label__", ...extraLabels],
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
          labels: extraLabels,
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
          label: args?.label as string | undefined,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Keywords created (PAUSED) and labeled. Review in Google Ads before enabling.",
              result,
            }, null, 2),
          }],
        };
      }

      case "google_ads_enable_items": {
        const customerId = args?.customer_id as string || "";

        // Validate at least one ID array is provided and non-empty
        const hasCampaignIds = args?.campaign_ids && (args.campaign_ids as string[]).length > 0;
        const hasAdGroupIds = args?.ad_group_ids && (args.ad_group_ids as string[]).length > 0;
        const hasAdIds = args?.ad_ids && (args.ad_ids as string[]).length > 0;
        if (!hasCampaignIds && !hasAdGroupIds && !hasAdIds) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "No item IDs provided. Specify at least one campaign, ad group, or ad ID." }, null, 2),
            }],
          };
        }

        const labels = args?.labels as string[] | undefined;
        const results: any = {};

        if (hasCampaignIds) {
          results.campaigns = await adsManager.enableCampaigns(customerId, args!.campaign_ids as string[], labels);
        }
        if (hasAdGroupIds) {
          results.adGroups = await adsManager.enableAdGroups(customerId, args!.ad_group_ids as string[], labels);
        }
        if (hasAdIds) {
          results.ads = await adsManager.enableAds(customerId, args!.ad_ids as string[], labels);
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

        // Validate at least one ID array is provided and non-empty -- nothing to pause otherwise
        const hasCampaignIds = args?.campaign_ids && (args.campaign_ids as string[]).length > 0;
        const hasAdGroupIds = args?.ad_group_ids && (args.ad_group_ids as string[]).length > 0;
        const hasAdIds = args?.ad_ids && (args.ad_ids as string[]).length > 0;
        if (!hasCampaignIds && !hasAdGroupIds && !hasAdIds) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "No item IDs provided. Specify at least one campaign, ad group, or keyword ID." }, null, 2),
            }],
          };
        }

        const labels = args?.labels as string[] | undefined;
        const results: any = {};

        if (hasCampaignIds) {
          results.campaigns = await adsManager.pauseCampaigns(customerId, args!.campaign_ids as string[], labels);
        }
        if (hasAdGroupIds) {
          results.adGroups = await adsManager.pauseAdGroups(customerId, args!.ad_group_ids as string[], labels);
        }
        if (hasAdIds) {
          results.ads = await adsManager.pauseAds(customerId, args!.ad_ids as string[], labels);
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

      case "google_ads_update_campaign_tracking": {
        const customerId = args?.customer_id as string || "";
        const campaignId = args?.campaign_id as string;

        // Get current values for the response diff
        const currentTracking = await adsManager.getCampaignTracking(customerId, campaignId);

        const updates: any = {};
        if (args?.final_url_suffix !== undefined) updates.final_url_suffix = args.final_url_suffix as string;
        if (args?.tracking_url_template !== undefined) updates.tracking_url_template = args.tracking_url_template as string;
        if (args?.url_custom_parameters !== undefined) updates.url_custom_parameters = args.url_custom_parameters as Array<{ key: string; value: string }>;

        const result = await adsManager.updateCampaignTracking(customerId, campaignId, updates);

        // Get updated values
        const updatedTracking = await adsManager.getCampaignTracking(customerId, campaignId);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              campaign_id: campaignId,
              campaign_name: currentTracking.campaign_name,
              before: {
                final_url_suffix: currentTracking.final_url_suffix,
                tracking_url_template: currentTracking.tracking_url_template,
                url_custom_parameters: currentTracking.url_custom_parameters,
              },
              after: {
                final_url_suffix: updatedTracking.final_url_suffix,
                tracking_url_template: updatedTracking.tracking_url_template,
                url_custom_parameters: updatedTracking.url_custom_parameters,
              },
            }, null, 2),
          }],
        };
      }

      case "google_ads_create_shared_set": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.createSharedSet(
          customerId,
          args?.name as string,
        );
        // Extract the shared set ID from the resource name
        const resourceName = result?.results?.[0]?.resource_name || "";
        const newSetId = resourceName.split("/").pop() || "";
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Shared negative keyword list created: ${args?.name}`,
              shared_set_id: newSetId,
              resource_name: resourceName,
              results: result,
            }, null, 2),
          }],
        };
      }

      case "google_ads_link_shared_set": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.linkSharedSetToCampaigns(
          customerId,
          args?.shared_set_id as string,
          args?.campaign_ids as string[],
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Shared set linked to ${(args?.campaign_ids as string[]).length} campaigns`,
              results: result,
            }, null, 2),
          }],
        };
      }

      case "google_ads_unlink_shared_set": {
        const customerId = args?.customer_id as string || "";
        const result = await adsManager.unlinkSharedSetFromCampaigns(
          customerId,
          args?.shared_set_id as string,
          args?.campaign_ids as string[],
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Shared set unlinked from ${(args?.campaign_ids as string[]).length} campaigns`,
              results: result,
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

      case "google_ads_remove_shared_negatives": {
        const customerId = args?.customer_id as string || "";
        const resourceNames = args?.resource_names as string[];
        const result = await adsManager.removeSharedNegativeKeywords(
          customerId,
          resourceNames,
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Removed ${resourceNames.length} negative keywords from shared list`,
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

      case "google_ads_remove_campaign_negatives": {
        const customerId = args?.customer_id as string || "";
        const resourceNames = args?.resource_names as string[];
        const result = await adsManager.removeCampaignNegativeKeywords(
          customerId,
          resourceNames,
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Removed ${resourceNames.length} campaign-level negative keywords`,
              results: result,
            }, null, 2),
          }],
        };
      }

      case "google_ads_remove_adgroup_negatives": {
        const customerId = args?.customer_id as string || "";
        const resourceNames = args?.resource_names as string[];
        const result = await adsManager.removeAdGroupNegativeKeywords(
          customerId,
          resourceNames,
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Removed ${resourceNames.length} ad-group-level negative keywords`,
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
        // Future date validation
        const today_kp = new Date().toISOString().slice(0, 10);
        if (args?.start_date && (args.start_date as string) > today_kp) {
          return { content: [{ type: "text", text: JSON.stringify({ error: `start_date "${args.start_date}" is in the future. Reports only cover historical data.` }, null, 2) }] };
        }
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
        const today_kpbc = new Date().toISOString().slice(0, 10);
        if (args?.start_date && (args.start_date as string) > today_kpbc) {
          return { content: [{ type: "text", text: JSON.stringify({ error: `start_date "${args.start_date}" is in the future. Reports only cover historical data.` }, null, 2) }] };
        }
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
        const today_str = new Date().toISOString().slice(0, 10);
        if (args?.start_date && (args.start_date as string) > today_str) {
          return { content: [{ type: "text", text: JSON.stringify({ error: `start_date "${args.start_date}" is in the future. Reports only cover historical data.` }, null, 2) }] };
        }
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
        const today_strbc = new Date().toISOString().slice(0, 10);
        if (args?.start_date && (args.start_date as string) > today_strbc) {
          return { content: [{ type: "text", text: JSON.stringify({ error: `start_date "${args.start_date}" is in the future. Reports only cover historical data.` }, null, 2) }] };
        }
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
        const today_ap = new Date().toISOString().slice(0, 10);
        if (args?.start_date && (args.start_date as string) > today_ap) {
          return { content: [{ type: "text", text: JSON.stringify({ error: `start_date "${args.start_date}" is in the future. Reports only cover historical data.` }, null, 2) }] };
        }
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
        const today_apbc = new Date().toISOString().slice(0, 10);
        if (args?.start_date && (args.start_date as string) > today_apbc) {
          return { content: [{ type: "text", text: JSON.stringify({ error: `start_date "${args.start_date}" is in the future. Reports only cover historical data.` }, null, 2) }] };
        }
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

      case "google_ads_update_campaign_budget": {
        const customerId = args?.customer_id as string || "";
        const campaignId = args?.campaign_id as string;
        const dailyBudget = args?.daily_budget as number;
        const createNew = (args?.create_new_budget as boolean) || false;

        // Budget validation: reject $0 and negative budgets
        if (dailyBudget <= 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "Budget must be positive (in dollars, e.g., 10 = $10/day)" }, null, 2),
            }],
          };
        }

        const result = await adsManager.updateCampaignBudget(customerId, campaignId, dailyBudget, createNew);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              ...result,
            }, null, 2),
          }],
        };
      }

      case "google_ads_gaql_query": {
        const customerId = args?.customer_id as string || "";
        const query = args?.query as string;

        // Block mutation statements -- GAQL query tool is read-only
        const upperQuery = query.toUpperCase().trim();
        if (upperQuery.startsWith("INSERT") || upperQuery.startsWith("UPDATE") || upperQuery.startsWith("DELETE") || upperQuery.startsWith("CREATE") || upperQuery.startsWith("DROP")) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "GAQL query tool is read-only. Mutation statements (INSERT, UPDATE, DELETE) are not allowed. Use the dedicated create/update tools instead." }, null, 2),
            }],
          };
        }

        const result = await adsManager.executeGaql(customerId, query);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "google_ads_keyword_volume": {
        const customerId = args?.customer_id as string || "";
        const keywords = args?.keywords as string[];

        // Enforce max 20 keywords per request
        if (keywords.length > 20) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: `Too many keywords (${keywords.length}). Maximum is 20 per request. Split into multiple calls.` }, null, 2),
            }],
          };
        }

        const geoTargetConstants = args?.geo_target_constants as string[] | undefined;
        const language = args?.language as string | undefined;
        const result = await adsManager.keywordVolume(customerId, keywords, geoTargetConstants, language);
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

    // Log classified error type for debugging
    logger.error({ errorType: error.name, tool: name }, error.message);

    const response: Record<string, unknown> = {
      error: true,
      error_type: error.name,
      message: error.message,
      server: __cliPkg.name,
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

    // Size-limit error responses through safeResponse to prevent oversized payloads
    const safeErrorResponse = safeResponse(response, "error");
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify(safeErrorResponse, null, 2),
      }],
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
      await withResilience(() => customer.query(`SELECT customer.id FROM customer LIMIT 1`), "startup.authCheck");
      logger.info({ customerId: firstClient.customer_id, clientName: firstClient.name }, "Auth verified: successfully queried account");
    }
  } catch (err: any) {
    const classified = classifyError(err);
    if (classified instanceof GoogleAdsAuthError) {
      logger.error({ error: classified.message }, "Auth check FAILED — MCP will start but ALL API calls will fail until auth is fixed");
    } else {
      logger.warn({ error: err.message }, "Auth check returned non-auth error (may be OK)");
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MCP Google Ads server running");
}

process.on("SIGTERM", () => {
  console.error("[shutdown] SIGTERM received, exiting");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.error("[shutdown] SIGINT received, exiting");
  process.exit(0);
});

// Client disconnection during shutdown (POSIX-only; see platform.ts)
onPosixSignal("SIGPIPE", () => {
  // No-op: expected when Claude Desktop closes the stdio pipe first
});

process.on("unhandledRejection", (reason) => {
  console.error("[error] Unhandled promise rejection:", reason);
});

main().catch((err) => logger.error({ error: err.message, stack: err.stack }, "Fatal startup error"));
