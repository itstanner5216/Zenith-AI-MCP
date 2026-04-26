// ─── Types ───────────────────────────────────────────────────────────
export type {
  ToolEntry,
  ServerConfig,
  ProfileConfig,
  ZenithMcpConfig,
} from "./types.js";

// ─── Config ──────────────────────────────────────────────────────────
export {
  DEFAULT_ZENITH_MCP_CONFIG_PATH,
  defaultRetrievalSettings,
  defaultZenithMcpConfig,
  loadZenithMcpConfig,
  saveZenithMcpConfig,
  normalizeServerConfig,
} from "./config.js";

// ─── Cache ───────────────────────────────────────────────────────────
export {
  mergeDiscoveredTools,
  cleanupStaleTools,
  getEnabledTools,
  toolToEntry,
} from "./cache.js";

// ─── Admin CLI ───────────────────────────────────────────────────────
export {
  cmdList,
  cmdStatus,
  cmdInstall,
  cmdScan,
  runConfigAdminCli,
} from "./admin-cli.js";

