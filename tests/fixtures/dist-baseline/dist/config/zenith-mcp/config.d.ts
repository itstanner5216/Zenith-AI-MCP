import type { ZenithMcpConfig, ServerConfig } from "./types.js";
import type { RetrievalConfig } from "../../retrieval/models.js";
export declare const DEFAULT_ZENITH_MCP_CONFIG_PATH: string;
/**
 * Thin wrapper delegating to SA4's defaultRetrievalConfig().
 * Do NOT reimplement retrieval defaults here.
 */
export declare function defaultRetrievalSettings(): RetrievalConfig;
export declare function defaultZenithMcpConfig(): ZenithMcpConfig;
/**
 * Normalize a single raw YAML object into a fully-typed ServerConfig.
 * Handles both TS-era and Python-era field names.
 * Never throws — every missing field gets a safe default.
 */
export declare function normalizeServerConfig(name: string, raw: unknown): ServerConfig;
/**
 * Load ZenithMcpConfig from a YAML file.
 * Returns a default empty config when the file does not exist or is invalid.
 * Never throws.
 */
export declare function loadZenithMcpConfig(path?: string): ZenithMcpConfig;
/**
 * Save ZenithMcpConfig to a YAML file.
 * Creates parent directories as needed.
 * Logs and re-throws on write error.
 */
export declare function saveZenithMcpConfig(config: ZenithMcpConfig, path?: string): void;
