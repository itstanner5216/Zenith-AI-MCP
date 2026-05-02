#!/usr/bin/env node
import type { ServerConfig } from "./types.js";
/**
 * List configured servers and their tools.
 * Returns a formatted string — does NOT write to stdout.
 */
export declare function cmdList(options?: {
    configPath?: string;
    serverFilter?: string;
    disabledOnly?: boolean;
}): string;
/**
 * Show multi-line status summary for all configured servers.
 * Returns a formatted string — does NOT write to stdout.
 */
export declare function cmdStatus(configPath?: string): string;
/**
 * Register a server into the Zenith-MCP config file.
 * Simplified TS version — does NOT write to AI tool config files
 * (that is the adapter layer's job).
 */
export declare function cmdInstall(serverName: string, options?: {
    command?: string;
    args?: string[];
    url?: string;
    transport?: ServerConfig["transport"];
    configPath?: string;
}): string;
/**
 * Read-only helper that reports configured servers from the YAML config.
 * Does NOT perform live MCP discovery.
 */
export declare function cmdScan(options?: {
    configPath?: string;
    serverName?: string;
}): string;
/**
 * CLI entry point for config admin operations.
 * Returns an exit code (0 = success, 1 = error).
 * Not a server entrypoint — no shebang, no MCP transport wiring.
 */
export declare function runConfigAdminCli(argv?: string[]): Promise<number>;
