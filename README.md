# MCP Google Ads Server

An MCP (Model Context Protocol) server that lets Claude Code interact with Google Ads API directly, with built-in safeguards for review before changes go live.

## Features

- **MCC Support**: Works with Manager accounts and multiple client accounts
- **Auto-Context**: Detects which client account based on your working directory
- **Safe by Default**: All new items created in PAUSED state
- **Approval Workflow**: Enable items only after manual review
- **Validation**: Validates ads before creating to catch errors early

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
# Install google-ads-api tools
pip install google-ads

# Generate refresh token
google-ads-auth
```

### 2. Configure the MCP Server

```bash
cd /Users/mark/claude-code/mcp-google-ads

# Copy example config
cp config.example.json config.json

# Edit with your credentials
```

Fill in `config.json`:

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
    "neon-one": {
      "customer_id": "111-222-3333",
      "name": "Neon One",
      "folder": "/Users/mark/claude-code/neon-one"
    }
  },
  "defaults": {
    "create_paused": true,
    "label_prefix": "claude-",
    "require_approval_for_enable": true
  }
}
```

### 3. Install Dependencies

```bash
cd /Users/mark/claude-code/mcp-google-ads
npm install
npm run build
```

### 4. Add to Claude Code

Add to your Claude Code MCP settings (`~/.claude/settings.json` or project settings):

```json
{
  "mcpServers": {
    "google-ads": {
      "command": "node",
      "args": ["/Users/mark/claude-code/mcp-google-ads/dist/index.js"]
    }
  }
}
```

Restart Claude Code.

## Usage

### Workflow

```
┌─────────────────────────────────────────────────────────────┐
│  1. cd into client folder (e.g., /Users/mark/claude-code/neon-one)
│                         ↓
│  2. Claude auto-detects client context
│                         ↓
│  3. Claude creates campaigns/ads (all PAUSED)
│                         ↓
│  4. You review in Google Ads UI or Editor
│                         ↓
│  5. Tell Claude to enable approved items
│                         ↓
│  6. Claude enables (requires your approval prompt)
└─────────────────────────────────────────────────────────────┘
```

### Available Tools

| Tool | Description | Auto-Approved |
|------|-------------|---------------|
| `google_ads_get_client_context` | Detect which account from working dir | Yes |
| `google_ads_list_campaigns` | List all campaigns | Yes |
| `google_ads_list_ad_groups` | List ad groups | Yes |
| `google_ads_list_pending_changes` | Show paused items with claude- label | Yes |
| `google_ads_validate_ad` | Validate RSA without creating | Yes |
| `google_ads_create_campaign` | Create campaign (PAUSED) | Yes |
| `google_ads_create_ad_group` | Create ad group (PAUSED) | Yes |
| `google_ads_create_responsive_search_ad` | Create RSA (PAUSED) | Yes |
| `google_ads_create_keywords` | Create keywords (PAUSED) | Yes |
| `google_ads_enable_items` | Enable items (make LIVE) | **No - Requires Approval** |

### Example Commands

```
# Check which account you're working with
"What Google Ads account am I connected to?"

# List campaigns
"Show me all campaigns in this account"

# Create ads from the gap coverage file
"Create all the ads from gap-coverage-ads.tsv"

# Check what's pending review
"What changes are pending my review?"

# After reviewing in Google Ads UI
"Enable all the approved ads in the Church & Faith-Based ad group"
```

## Safety Features

1. **Everything starts PAUSED** - Nothing goes live until you explicitly enable it
2. **Label tracking** - All Claude-created items get a `claude-pending` label
3. **Validation** - Ads are validated before creation (headline/description lengths, etc.)
4. **Approval prompts** - The `enable_items` tool requires explicit approval in Claude Code
5. **Client isolation** - Working directory determines which account, preventing cross-client mistakes

## Troubleshooting

### "No client found for working directory"
- Make sure you're in a folder that matches one of your `clients` entries
- Check that the folder path in config.json matches exactly

### "Developer token not approved"
- New developer tokens need approval from Google
- Use a test account while waiting for approval

### "Authentication failed"
- Refresh token may be expired - regenerate it
- Check that client_id and client_secret are correct

## Adding New Clients

Edit `config.json` to add new clients:

```json
{
  "clients": {
    "neon-one": {
      "customer_id": "111-222-3333",
      "name": "Neon One",
      "folder": "/Users/mark/claude-code/neon-one"
    },
    "new-client": {
      "customer_id": "444-555-6666",
      "name": "New Client",
      "folder": "/Users/mark/claude-code/new-client"
    }
  }
}
```

No server restart needed - config is read on each request.
