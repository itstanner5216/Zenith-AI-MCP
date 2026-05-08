/**
 * Config loader — reads, validates, and writes the Zenith-MCP config file.
 *
 * This module is the primary interface for the rest of the codebase to interact
 * with the on-disk config (~/.zenith-mcp/config).  It delegates parsing to
 * `parser.ts` and type conversion to `schema.ts`, adding file I/O, error
 * handling, and tool-discovery merging on top.
 *
 * Key guarantee: `loadConfig()` NEVER throws. It is called at server startup
 * and must always return a usable ZenithConfig, falling back to defaults on
 * any error.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseConfig, serializeConfig } from "./parser.js";
import type { RawConfig } from "./parser.js";
import { DEFAULT_CONFIG, CONFIG_PATH, configToRaw, rawToConfig } from "./schema.js";
import type { ZenithConfig } from "./schema.js";

// ---------------------------------------------------------------------------
// configExists
// ---------------------------------------------------------------------------

/** Returns `true` when the config file is present on disk. */
export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

/**
 * Load and parse the Zenith config file into a typed `ZenithConfig`.
 *
 * - If the file does not exist, returns a deep copy of `DEFAULT_CONFIG`.
 * - If any error occurs (read failure, parse failure, conversion failure),
 *   returns a deep copy of `DEFAULT_CONFIG` — this function never throws.
 */
export function loadConfig(): ZenithConfig {
  try {
    if (!existsSync(CONFIG_PATH)) {
      return structuredClone(DEFAULT_CONFIG);
    }

    const text = readFileSync(CONFIG_PATH, "utf-8");
    const raw: RawConfig = parseConfig(text);
    return rawToConfig(raw);
  } catch {
    // Swallow everything — startup must not fail because of a bad config.
    return structuredClone(DEFAULT_CONFIG);
  }
}

// ---------------------------------------------------------------------------
// saveConfig
// ---------------------------------------------------------------------------

/**
 * Persist a `ZenithConfig` to disk at `CONFIG_PATH`.
 *
 * Creates the parent directory (`~/.zenith-mcp/`) if it does not already
 * exist.
 */
export function saveConfig(config: ZenithConfig): void {
  const raw: RawConfig = configToRaw(config);
  const text = serializeConfig(raw);

  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, text, "utf-8");
}

// ---------------------------------------------------------------------------
// mergeToolsIntoConfig
// ---------------------------------------------------------------------------

/**
 * Synchronise the config's `tools` map with the tools actually registered by
 * the MCP server.
 *
 * For each tool in `availableTools`:
 *   - If the tool already appears in `config.tools`, its current
 *     enabled/disabled state is preserved.
 *   - If the tool is new (not yet in config), it is added as **enabled**
 *     (`true`).
 *
 * Tools that exist in `config.tools` but are NOT in `availableTools` are
 * intentionally kept — they are harmless stale entries and may reappear if
 * a plugin is re-enabled later.
 *
 * Returns the updated config (mutates in place for convenience, but also
 * returns it so callers can chain).
 */
export function mergeToolsIntoConfig(
  config: ZenithConfig,
  availableTools: string[],
): ZenithConfig {
  for (const tool of availableTools) {
    if (!(tool in config.tools)) {
      config.tools[tool] = true;
    }
    // else: keep existing enabled/disabled state
  }

  return config;
}

