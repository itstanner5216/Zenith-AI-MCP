import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ZenithMcpConfig, ToolEntry } from "./types.js";

/**
 * Convert an MCP SDK Tool into a ToolEntry.
 * Newly created entries default to `enabled: true`.
 */
export function toolToEntry(tool: Tool, now?: Date): ToolEntry {
  const timestamp = (now ?? new Date()).toISOString();
  return {
    name: tool.name,
    description: tool.description ?? undefined,
    inputSchema: tool.inputSchema,
    enabled: true,
    discoveredAt: timestamp,
    lastSeenAt: timestamp,
  };
}

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
export function mergeDiscoveredTools(
  config: ZenithMcpConfig,
  serverName: string,
  tools: Tool[],
  now?: Date
): { added: string[]; updated: string[]; unchanged: string[] } {
  const server = config.servers[serverName];
  if (!server) {
    return { added: [], updated: [], unchanged: [] };
  }

  const timestamp = (now ?? new Date()).toISOString();
  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];

  for (const tool of tools) {
    const existing = server.tools[tool.name];

    if (existing) {
      // ── Existing tool: update metadata, PRESERVE enabled ─────────
      const descChanged =
        (tool.description ?? "") !== (existing.description ?? "");
      const schemaChanged =
        JSON.stringify(tool.inputSchema) !==
        JSON.stringify(existing.inputSchema);

      existing.description = tool.description ?? undefined;
      existing.inputSchema = tool.inputSchema;
      existing.lastSeenAt = timestamp;
      // Do NOT touch existing.enabled — core invariant.

      if (descChanged || schemaChanged) {
        updated.push(tool.name);
      } else {
        unchanged.push(tool.name);
      }
    } else {
      // ── New tool ─────────────────────────────────────────────────
      server.tools[tool.name] = {
        name: tool.name,
        description: tool.description ?? undefined,
        inputSchema: tool.inputSchema,
        enabled: true,
        discoveredAt: timestamp,
        lastSeenAt: timestamp,
      };
      added.push(tool.name);
    }
  }

  // Note: tools NOT in the discovery set are NOT touched here.
  // Their lastSeenAt stays at the old value, marking them as "stale"
  // for cleanupStaleTools to handle.

  return { added, updated, unchanged };
}

/**
 * Remove tools that are disabled AND from a previous discovery cycle.
 *
 * Uses the maximum `lastSeenAt` among the server's tools as the
 * "current cycle" reference. Any tool whose `lastSeenAt` is different
 * (older) AND whose `enabled` is false is removed.
 *
 * Returns the count of removed entries.
 */
export function cleanupStaleTools(
  config: ZenithMcpConfig,
  serverName: string
): number {
  const server = config.servers[serverName];
  if (!server) return 0;

  const entries = Object.entries(server.tools);
  if (entries.length === 0) return 0;

  // Find the most recent lastSeenAt as the current-cycle reference.
  let maxLastSeen = "";
  for (const [, entry] of entries) {
    if (entry.lastSeenAt && entry.lastSeenAt > maxLastSeen) {
      maxLastSeen = entry.lastSeenAt;
    }
  }

  // Remove disabled tools whose lastSeenAt is from a previous cycle.
  const toRemove: string[] = [];
  for (const [name, entry] of entries) {
    if (
      !entry.enabled &&
      entry.lastSeenAt !== undefined &&
      entry.lastSeenAt !== maxLastSeen
    ) {
      toRemove.push(name);
    }
  }

  for (const name of toRemove) {
    delete server.tools[name];
  }

  return toRemove.length;
}

/**
 * Return the set of tool names whose `enabled` flag is true.
 *
 * This function does NOT filter by lastSeenAt. Staleness management
 * is the exclusive responsibility of cleanupStaleTools.
 */
export function getEnabledTools(
  config: ZenithMcpConfig,
  serverName: string
): Set<string> {
  const server = config.servers[serverName];
  if (!server) return new Set();

  const result = new Set<string>();
  for (const [name, entry] of Object.entries(server.tools)) {
    if (entry.enabled) {
      result.add(name);
    }
  }
  return result;
}

