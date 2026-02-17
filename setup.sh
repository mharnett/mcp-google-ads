#!/bin/bash

# MCP Google Ads Setup Script

echo "=== MCP Google Ads Setup ==="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "ERROR: Node.js 18+ required. Current version: $(node -v)"
    exit 1
fi
echo "✓ Node.js $(node -v)"

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

# Build
echo ""
echo "Building TypeScript..."
npm run build

# Check for config
if [ ! -f "config.json" ]; then
    echo ""
    echo "=== Configuration Required ==="
    echo ""
    echo "Copy the example config and fill in your credentials:"
    echo ""
    echo "  cp config.example.json config.json"
    echo "  # Edit config.json with your Google Ads credentials"
    echo ""
    echo "You'll need:"
    echo "  - Developer Token (from Google Ads API Center)"
    echo "  - OAuth Client ID & Secret (from Google Cloud Console)"
    echo "  - Refresh Token (from google-ads-auth or OAuth playground)"
    echo "  - MCC Customer ID"
    echo "  - Client Customer IDs and folder mappings"
else
    echo "✓ config.json exists"
fi

# Show Claude Code config
echo ""
echo "=== Add to Claude Code ==="
echo ""
echo "Add this to your Claude Code MCP settings:"
echo ""
echo '{
  "mcpServers": {
    "google-ads": {
      "command": "node",
      "args": ["'$(pwd)'/dist/index.js"]
    }
  }
}'
echo ""
echo "Then restart Claude Code."
echo ""
echo "=== Setup Complete ==="
