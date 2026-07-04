# MCP Google Ads Server

An MCP (Model Context Protocol) server for the Google Ads API with built-in safeguards for review before changes go live. Production-proven with MCC (Manager Account) support, 36 tools for campaign management, reporting, and optimization. v1.2.0 adds Demand Gen campaign creation end-to-end.

## Features

- **MCC Support**: Works with Manager accounts and multiple client accounts
- **Auto-Context**: Detects which client account based on your working directory
- **Safe by Default**: All new items created in PAUSED state
- **Approval Workflow**: Enable items only after manual review
- **Validation**: Validates ads before creating to catch errors early
- **Resilience**: Circuit breakers, retry with backoff, and timeout handling (cockatiel)
- **Structured Logging**: Pino-based logging with build fingerprinting

## Setup

### 1. Google Ads API Access

You need:
- A Google Ads **Developer Token** (apply at [Google Ads API Center](https://developers.google.com/google-ads/api/docs/get-started/dev-token))
- **OAuth credentials** (Client ID & Secret from Google Cloud Console)
- A **Refresh Token** for your MCC account

#### Getting OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project or select existing
3. Enable the **Google Ads API**
4. Go to **Credentials** → **Create Credentials** → **OAuth Client ID**
5. Choose **Desktop App**
6. Download the JSON (contains client_id and client_secret)

#### Getting a Refresh Token

Bring your own OAuth client (the `client_id` / `client_secret` from the step
above) and run the bundled helper. It runs Google's installed-app loopback flow
**with PKCE (S256)** and prints your refresh token. It reads nothing from your
home directory and needs no shared OAuth keyfile.

```bash
export GOOGLE_ADS_CLIENT_ID="YOUR_CLIENT_ID.apps.googleusercontent.com"
export GOOGLE_ADS_CLIENT_SECRET="YOUR_CLIENT_SECRET"
node get-refresh-token.cjs
```

Your browser opens for Google sign-in; approve as the Google account that owns
the Ads data. On success the helper prints one line to stdout:

```
GOOGLE_ADS_REFRESH_TOKEN=1//0a...
```

Set that value in your environment (or `config.json`, below). The OAuth scope
requested is read from `config.json` (`oauth.scope`), falling back to
`config.example.json`, so the helper and the running server always request the
same scope. This MCP requests only the minimum scope it needs:
`https://www.googleapis.com/auth/adwords`.

> Do not run this with stdout redirected to a shared log file — the refresh
> token is printed to stdout by design.

Note: `GOOGLE_ADS_DEVELOPER_TOKEN` is a separate Google Ads API credential, not
an OAuth scope — set it independently (see Environment Variables below).

### 2. Install

```bash
npm install mcp-google-ads
```

Or clone and build from source:

```bash
git clone https://github.com/mharnett/mcp-google-ads.git
cd mcp-google-ads
npm install
npm run build
```

**Security:** Never share your `.mcp.json` file or commit it to git -- it may contain API credentials. Add `.mcp.json` to your `.gitignore`.

### 3. Configure

```bash
cp config.example.json config.json
```

Edit `config.json` with your credentials:

```json
{
  "oauth": {
    "scope": "https://www.googleapis.com/auth/adwords"
  },
  "google_ads": {
    "developer_token": "YOUR_DEVELOPER_TOKEN",
    "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
    "client_secret": "YOUR_CLIENT_SECRET",
    "refresh_token": "YOUR_REFRESH_TOKEN",
    "mcc_customer_id": "123-456-7890"
  },
  "clients": {
    "my-client": {
      "customer_id": "111-222-3333",
      "name": "My Client",
      "folder": "/path/to/client/workspace"
    },
    "another-client": {
      "customer_id": "444-555-6666",
      "name": "Another Client",
      "folder": "/path/to/another/workspace"
    }
  },
  "defaults": {
    "create_paused": true,
    "label_prefix": "claude-",
    "require_approval_for_enable": true
  }
}
```

### Environment Variables

Alternatively, set credentials via environment variables (these override `config.json`):

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Yes | Google Ads API developer token |
| `GOOGLE_ADS_CLIENT_ID` | Yes | OAuth 2.0 client ID |
| `GOOGLE_ADS_CLIENT_SECRET` | Yes | OAuth 2.0 client secret |
| `GOOGLE_ADS_REFRESH_TOKEN` | Yes | OAuth 2.0 refresh token |
| `GOOGLE_ADS_MCP_WRITE` | No | Set to `true` to expose mutating tools (create/update/pause/enable/remove/apply). Default: read-only. |

### Read-only by default

The server ships read-only. Mutating tools (anything that creates, updates,
pauses, enables, removes, links, or applies) are hidden from the tool list
until you set `GOOGLE_ADS_MCP_WRITE=true` in the MCP server environment.
If a write tool is somehow invoked without that flag, the server returns a
clear error pointing at the env var.

This is deliberate: a casual chat message like "activate the Fundraising
campaign" should not move live ad spend without an explicit opt-in.

### 4. Add to Claude Code

Add to your Claude Code MCP settings (`~/.claude/settings.json` or project settings):

```json
{
  "mcpServers": {
    "google-ads": {
      "command": "node",
      "args": ["node_modules/mcp-google-ads/dist/index.js"]
    }
  }
}
```

Or if installed from source:

```json
{
  "mcpServers": {
    "google-ads": {
      "command": "node",
      "args": ["/path/to/mcp-google-ads/dist/index.js"]
    }
  }
}
```

Restart Claude Code.

**Claude Desktop:** Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).

## Usage

### Workflow

```
1. cd into client folder → auto-detects account context
2. Ask Claude to create campaigns/ads → all created PAUSED
3. Review in Google Ads UI or Editor
4. Tell Claude to enable approved items
5. Claude enables (requires your approval prompt)
```

### Available Tools (36)

#### Context & Discovery
| Tool | Description |
|------|-------------|
| `google_ads_get_client_context` | Detect which account from working directory |
| `google_ads_list_campaigns` | List all campaigns with status and metrics |
| `google_ads_list_ad_groups` | List ad groups in a campaign |
| `google_ads_list_pending_changes` | Show paused items with claude- label |
| `google_ads_list_conversion_actions` | List conversion actions |

#### Campaign Management
| Tool | Description |
|------|-------------|
| `google_ads_create_campaign` | Create campaign (PAUSED). Supports SEARCH + DEMAND_GEN channels, richer bidding (MANUAL_CPC / MAXIMIZE_CLICKS / MAXIMIZE_CONVERSIONS / TARGET_CPA), geo + language targeting, start/end dates |
| `google_ads_create_ad_group` | Create ad group (PAUSED). `type` accepts SEARCH_STANDARD (default) or DEMAND_GEN_MULTI_ASSET_AD_GROUP |
| `google_ads_create_responsive_search_ad` | Create RSA with validation (PAUSED) |
| `google_ads_create_image_asset` | Upload PNG/JPG/GIF image asset (validates ≤5MB, ≥600×314) for use in Demand Gen ads |
| `google_ads_create_demand_gen_multi_asset_ad` | Create a Demand Gen multi-asset ad (PAUSED) — validates char/count caps before API call, fails fast if ad_group isn't DG |
| `google_ads_create_keywords` | Create keywords (PAUSED) |
| `google_ads_validate_ad` | Validate RSA without creating |
| `google_ads_enable_items` | Enable items (make LIVE) — **requires approval** |
| `google_ads_pause_items` | Pause active items |
| `google_ads_pause_keywords` | Pause specific keywords |
| `google_ads_update_campaign_budget` | Update campaign daily budget |

#### Tracking & URLs
| Tool | Description |
|------|-------------|
| `google_ads_get_campaign_tracking` | Get tracking templates and URL parameters |
| `google_ads_update_campaign_tracking` | Update tracking templates |

#### Negative Keywords
| Tool | Description |
|------|-------------|
| `google_ads_create_shared_set` | Create shared negative keyword list |
| `google_ads_link_shared_set` | Link shared set to campaign |
| `google_ads_unlink_shared_set` | Unlink shared set from campaign |
| `google_ads_add_shared_negatives` | Add keywords to shared negative list |
| `google_ads_remove_shared_negatives` | Remove keywords from shared list |
| `google_ads_add_campaign_negatives` | Add campaign-level negatives |
| `google_ads_remove_campaign_negatives` | Remove campaign-level negatives |
| `google_ads_remove_adgroup_negatives` | Remove ad group-level negatives |

#### Performance & Reporting
| Tool | Description |
|------|-------------|
| `google_ads_keyword_performance` | Keyword metrics with quality score |
| `google_ads_keyword_performance_by_conversion` | Keyword metrics by conversion action |
| `google_ads_ad_performance` | Ad-level performance metrics |
| `google_ads_ad_performance_by_conversion` | Ad metrics by conversion action |
| `google_ads_search_term_report` | Search term query report |
| `google_ads_search_term_report_by_conversion` | Search terms by conversion action |
| `google_ads_search_term_insights` | Search term category insights |
| `google_ads_search_term_insight_terms` | Terms within insight categories |
| `google_ads_keyword_volume` | Keyword planner volume estimates |

#### Advanced
| Tool | Description |
|------|-------------|
| `google_ads_gaql_query` | Run raw GAQL queries |

### Example Commands

```
# Check which account you're working with
"What Google Ads account am I connected to?"

# List campaigns
"Show me all campaigns in this account"

# Create a new campaign
"Create a Search campaign for brand terms with $50/day budget"

# Check what's pending review
"What changes are pending my review?"

# After reviewing in Google Ads UI
"Enable the approved ads in the Brand campaign"

# Performance analysis
"Show me keyword performance for the last 30 days, sorted by cost"

# Run custom GAQL
"Run a GAQL query to get all ad groups with CTR below 2%"
```

### Example: Create a Demand Gen Campaign End-to-End

```
# 1. Campaign: $75/day, DEMAND_GEN channel, MAXIMIZE_CONVERSIONS default,
#    targeting Alaska (21134) + Maine (21141) in English
google_ads_create_campaign({
  name: "DG - Spring Promo",
  daily_budget: 75,
  channel_type: "DEMAND_GEN",
  geo_target_ids: ["21134", "21141"],
  start_date: "2026-05-01",
  end_date: "2026-06-30"
})
# → campaign_id: 555123

# 2. Ad group: DEMAND_GEN_MULTI_ASSET_AD_GROUP
google_ads_create_ad_group({
  campaign_id: "555123",
  name: "DG AG 1",
  type: "DEMAND_GEN_MULTI_ASSET_AD_GROUP"
})
# → ad_group_id: 555456

# 3. Image assets (PNG/JPG/GIF, ≥600×314, ≤5MB). Returns {asset_id, ...}
google_ads_create_image_asset({ name: "hero-landscape", file_path: "/abs/path/hero.png" })
# → asset_id: 42001
google_ads_create_image_asset({ name: "hero-square",    file_path: "/abs/path/square.png" })
# → asset_id: 42002
google_ads_create_image_asset({ name: "logo",           file_path: "/abs/path/logo.png" })
# → asset_id: 42003

# 4. Demand Gen multi-asset ad (PAUSED). Validates char + count caps first.
google_ads_create_demand_gen_multi_asset_ad({
  ad_group_id: "555456",
  final_urls: ["https://example.com/spring"],
  business_name: "Example Org",
  call_to_action: "LEARN_MORE",
  marketing_image_asset_ids: ["42001"],          // 1.91:1 landscape, ≥1 required
  square_marketing_image_asset_ids: ["42002"],   // 1:1 optional
  logo_image_asset_ids: ["42003"],               // logo optional
  headlines: ["Spring Sale Now On", "Save 20% Today"],     // max 5, ≤40 chars each
  long_headlines: ["A longer pitch under ninety characters."], // max 5, ≤90 chars
  descriptions: ["Shop the latest looks.", "Free returns."]   // max 5, ≤90 chars each
})
# → resource_name: customers/.../adGroupAds/555456~67890000
```

After all four calls the campaign, ad group, and ad all live in your account in PAUSED state and are labeled `Claude-MM-DD-YY`. Review in the Google Ads UI, then enable via `google_ads_enable_items`.

## Safety Features

1. **Everything starts PAUSED** — Nothing goes live until you explicitly enable it
2. **Label tracking** — All Claude-created items get a `claude-pending` label
3. **Validation** — Ads are validated before creation (headline/description lengths, etc.)
4. **Approval prompts** — The `enable_items` tool requires explicit approval in Claude Code
5. **Client isolation** — Working directory determines which account, preventing cross-client mistakes

## Adding New Clients

Edit `config.json` to add clients. Map each client to a working directory:

```json
{
  "clients": {
    "client-slug": {
      "customer_id": "123-456-7890",
      "name": "Client Name",
      "folder": "/path/to/client/workspace"
    }
  }
}
```

No server restart needed — config is read on each request.

## Troubleshooting

### "No client found for working directory"
- Make sure you're in a folder that matches one of your `clients` entries
- Check that the folder path in config.json matches exactly

### "Developer token not approved"
- New developer tokens need approval from Google
- Use a test account while waiting for approval

### "Authentication failed"
- Refresh token may be expired — regenerate it
- Check that client_id and client_secret are correct

## License

MIT — see [LICENSE](LICENSE) for details.
