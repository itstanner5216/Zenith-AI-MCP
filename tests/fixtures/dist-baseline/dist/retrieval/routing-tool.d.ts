/**
 * Synthetic MCP routing tool for demoted-tools discovery.
 * Converted from src/zenithmcp/retrieval/routing_tool.py
 *
 * HAZARD 3: handleRoutingCall returns a sentinel, never invokes handlers.
 */
import type { TextContent, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolMapping } from "./models.js";
export declare const ROUTING_TOOL_NAME = "request_tool";
export declare const ROUTING_TOOL_KEY = "__routing__request_tool";
export declare function buildRoutingToolSchema(demotedToolIds: string[]): Tool;
export declare function formatNamespaceGrouped(toolIds: string[], envNamespaces: string[]): string[];
export declare function handleRoutingCall(name: string, describe: boolean, args: Record<string, unknown>, registry: Record<string, ToolMapping>): TextContent[];
