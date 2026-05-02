/**
 * Zenith's local tool registry — tracks tools on the single Zenith server.
 * Extracted from tool_to_server dict pattern in mcp_proxy.py.
 *
 * HAZARD 1: Plain class, no MCP inheritance.
 * Handlers are stored but never invoked by this class.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolMapping } from "./models.js";
export declare function makeToolKey(namespace: string, toolName: string): string;
export declare function hashToolList(tools: Tool[]): string;
export declare class ZenithToolRegistry {
    private _m;
    register(tool: Tool, handler?: unknown): ToolMapping;
    unregister(toolName: string): boolean;
    get(toolKey: string): ToolMapping | undefined;
    list(): ToolMapping[];
    /** Shallow copy — callers can iterate without aliasing registry state. */
    asRecord(): Record<string, ToolMapping>;
    /** Live read-only view for consumers that must observe late registrations. */
    asLiveRecord(): Record<string, ToolMapping>;
    hash(): string;
}
