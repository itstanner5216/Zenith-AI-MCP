import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ZenithMcpConfig, ToolEntry } from "./types.js";
/**
 * Convert an MCP SDK Tool into a ToolEntry.
 * Newly created entries default to `enabled: true`.
 */
export declare function toolToEntry(tool: Tool, now?: Date): ToolEntry;
/**
 * Merge a set of discovered tools into an existing server's tool map.
 *
 * Core invariants:
 *  - Existing tool `enabled` is NEVER changed.
 *  - New tools get `enabled: true`.
 *  - `lastSeenAt` is updated for every discovered tool.
 *  - Tools absent from the discovery set keep their old `lastSeenAt`,
 *    making them "stale" (detectable by cleanupStaleTools).
 *
 * Mutates `config.servers[serverName].tools` in place and returns a
 * summary of what changed.
 */
export declare function mergeDiscoveredTools(config: ZenithMcpConfig, serverName: string, tools: Tool[], now?: Date): {
    added: string[];
    updated: string[];
    unchanged: string[];
};
/**
 * Remove tools that are disabled AND from a previous discovery cycle.
 *
 * Uses the maximum `lastSeenAt` among the server's tools as the
 * "current cycle" reference. Any tool whose `lastSeenAt` is different
 * (older) AND whose `enabled` is false is removed.
 *
 * Returns the count of removed entries.
 */
export declare function cleanupStaleTools(config: ZenithMcpConfig, serverName: string): number;
/**
 * Return the set of tool names whose `enabled` flag is true.
 *
 * This function does NOT filter by lastSeenAt. Staleness management
 * is the exclusive responsibility of cleanupStaleTools.
 */
export declare function getEnabledTools(config: ZenithMcpConfig, serverName: string): Set<string>;
