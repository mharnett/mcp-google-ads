# MCP Google Ads Server

An MCP (Model Context Protocol) server for the Google Ads API with built-in safeguards for review before changes go live. Production-proven with MCC (Manager Account) support, 35 tools for campaign management, reporting, and optimization.

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

Use the Google OAuth playground or run:

```bash
pip install google-ads
google-ads-auth
```

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

### 3. Configure

```bash
cp config.example.json config.json
```

Edit `config.json` with your credentials:

```json
{
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

## Usage

### Workflow

```
1. cd into client folder → auto-detects account context
2. Ask Claude to create campaigns/ads → all created PAUSED
3. Review in Google Ads UI or Editor
4. Tell Claude to enable approved items
5. Claude enables (requires your approval prompt)
```

### Available Tools (35)

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
| `google_ads_create_campaign` | Create campaign (PAUSED) |
| `google_ads_create_ad_group` | Create ad group (PAUSED) |
| `google_ads_create_responsive_search_ad` | Create RSA with validation (PAUSED) |
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
