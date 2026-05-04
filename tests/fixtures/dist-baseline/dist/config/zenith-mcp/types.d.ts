import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { RetrievalConfig } from "../../retrieval/models.js";
export interface ToolEntry {
    name: string;
    description?: string;
    inputSchema?: Tool["inputSchema"];
    enabled: boolean;
    discoveredAt?: string;
    lastSeenAt?: string;
}
export interface ServerConfig {
    name: string;
    command?: string;
    args: string[];
    env: Record<string, string>;
    url?: string;
    transport?: "stdio" | "sse" | "streamable-http";
    enabled: boolean;
    tools: Record<string, ToolEntry>;
    toolFilters: {
        allow: string[];
        deny: string[];
    };
    idleTimeoutSeconds?: number;
}
export interface ProfileConfig {
    name: string;
    servers: string[];
}
export interface ZenithMcpConfig {
    servers: Record<string, ServerConfig>;
    profiles: Record<string, ProfileConfig>;
    retrieval: RetrievalConfig;
}
