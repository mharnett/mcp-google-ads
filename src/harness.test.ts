import { registerMcpTests } from "@drak/mcp-test-harness";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

registerMcpTests({
  name: "mcp-google-ads",
  repoRoot: path.resolve(__dirname, ".."),
  toolPrefix: "google_ads_",
  minTools: 30,
  requiredTools: [
    "google_ads_get_client_context",
    "google_ads_list_campaigns",
    "google_ads_gaql_query",
    "google_ads_keyword_performance",
    "google_ads_search_term_report",
  ],
  binEntries: {
    "mcp-google-ads": "dist/index.js",
    "mcp-google-ads-auth": "dist/auth-cli.js",
  },
  hasAuthCli: true,
  authCliBin: "dist/auth-cli.js",
  hasCredentials: true,
  hasResilience: true,
  hasPlatform: true,
  requiredEnvVars: [
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_REFRESH_TOKEN",
  ],
  envPrefix: "GOOGLE_ADS_",
  startupEnv: {
    GOOGLE_ADS_DEVELOPER_TOKEN: "fake-dev-token",
    GOOGLE_ADS_CLIENT_ID: "fake-client-id",
    GOOGLE_ADS_CLIENT_SECRET: "fake-client-secret",
    GOOGLE_ADS_REFRESH_TOKEN: "fake-refresh-token",
    GOOGLE_ADS_CUSTOMER_ID: "1234567890",
  },
});
