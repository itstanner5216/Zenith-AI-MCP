#!/usr/bin/env node
import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadZenithMcpConfig, saveZenithMcpConfig, DEFAULT_ZENITH_MCP_CONFIG_PATH } from "./config.js";
import { getEnabledTools } from "./cache.js";
/**
 * List configured servers and their tools.
 * Returns a formatted string — does NOT write to stdout.
 */
export function cmdList(options) {
    const config = loadZenithMcpConfig(options?.configPath);
    if (Object.keys(config.servers).length === 0) {
        return "No servers configured.";
    }
    const lines = [];
    for (const [serverName, serverConfig] of Object.entries(config.servers)) {
        if (options?.serverFilter && serverName !== options.serverFilter) {
            continue;
        }
        // Determine "current cycle" for stale display
        const entries = Object.entries(serverConfig.tools);
        let maxLastSeen = "";
        for (const [, entry] of entries) {
            if (entry.lastSeenAt && entry.lastSeenAt > maxLastSeen) {
                maxLastSeen = entry.lastSeenAt;
            }
        }
        const enabledCount = getEnabledTools(config, serverName).size;
        const total = entries.length;
        if (lines.length > 0)
            lines.push("");
        lines.push(`[${serverName}] (${enabledCount}/${total} tools enabled)`);
        // Sort tools alphabetically for deterministic output
        const sorted = entries.sort(([a], [b]) => a.localeCompare(b));
        for (const [toolName, entry] of sorted) {
            const isStale = Boolean(entry.lastSeenAt && entry.lastSeenAt !== maxLastSeen);
            if (options?.disabledOnly && entry.enabled && !isStale) {
                continue;
            }
            let status;
            let label;
            if (isStale) {
                status = "⚠";
                label = " [stale]";
            }
            else if (entry.enabled) {
                status = "✓";
                label = "";
            }
            else {
                status = "✗";
                label = "";
            }
            lines.push(`  ${status} ${toolName}${label}`);
        }
    }
    return lines.join("\n");
}
/**
 * Show multi-line status summary for all configured servers.
 * Returns a formatted string — does NOT write to stdout.
 */
export function cmdStatus(configPath) {
    const config = loadZenithMcpConfig(configPath);
    if (Object.keys(config.servers).length === 0) {
        return "No servers configured.";
    }
    const lines = ["Zenith-MCP Status"];
    for (const [serverName, serverConfig] of Object.entries(config.servers)) {
        const entries = Object.entries(serverConfig.tools);
        // Stale = lastSeenAt present but older than the most recent
        let maxLastSeen = "";
        for (const [, entry] of entries) {
            if (entry.lastSeenAt && entry.lastSeenAt > maxLastSeen) {
                maxLastSeen = entry.lastSeenAt;
            }
        }
        const stale = entries.filter(([, e]) => e.lastSeenAt && e.lastSeenAt !== maxLastSeen).length;
        const enabled = entries.filter(([, e]) => e.enabled && (!e.lastSeenAt || e.lastSeenAt === maxLastSeen)).length;
        const disabled = entries.filter(([, e]) => !e.enabled && (!e.lastSeenAt || e.lastSeenAt === maxLastSeen)).length;
        const mode = serverConfig.idleTimeoutSeconds == null
            ? "always_on"
            : `lazy (${Math.round(serverConfig.idleTimeoutSeconds / 60)}m timeout)`;
        lines.push(`\n${serverName}`);
        lines.push(`  Mode:     ${mode}`);
        lines.push(`  Tools:    ${enabled} enabled, ${disabled} disabled, ${stale} stale`);
        if (serverConfig.command) {
            lines.push(`  Command:  ${serverConfig.command}`);
        }
        else if (serverConfig.url) {
            lines.push(`  URL:      ${serverConfig.url}`);
        }
    }
    return lines.join("\n");
}
/**
 * Register a server into the Zenith-MCP config file.
 * Simplified TS version — does NOT write to AI tool config files
 * (that is the adapter layer's job).
 */
export function cmdInstall(serverName, options = {}) {
    const config = loadZenithMcpConfig(options.configPath);
    // Preserve existing server's tools if overwriting
    const existing = config.servers[serverName];
    const newServer = {
        name: serverName,
        command: options.command,
        args: options.args ?? [],
        env: existing?.env ?? {},
        url: options.url,
        transport: options.transport,
        enabled: true,
        tools: existing?.tools ?? {},
        toolFilters: existing?.toolFilters ?? { allow: [], deny: [] },
        idleTimeoutSeconds: existing?.idleTimeoutSeconds,
    };
    config.servers[serverName] = newServer;
    try {
        saveZenithMcpConfig(config, options.configPath);
        const resolvedPath = options.configPath ?? DEFAULT_ZENITH_MCP_CONFIG_PATH;
        return `Registered server '${serverName}' in ${resolvedPath}`;
    }
    catch (e) {
        return `Failed to register server '${serverName}': ${e instanceof Error ? e.message : String(e)}`;
    }
}
/**
 * Read-only helper that reports configured servers from the YAML config.
 * Does NOT perform live MCP discovery.
 */
export function cmdScan(options = {}) {
    const config = loadZenithMcpConfig(options.configPath);
    if (Object.keys(config.servers).length === 0) {
        return "No servers configured.";
    }
    const lines = [];
    const servers = options.serverName
        ? { [options.serverName]: config.servers[options.serverName] }
        : config.servers;
    for (const [name, serverConfig] of Object.entries(servers)) {
        if (!serverConfig) {
            lines.push(`Unknown server: ${options.serverName}`);
            continue;
        }
        const toolCount = Object.keys(serverConfig.tools).length;
        const detail = serverConfig.command
            ? serverConfig.command
            : serverConfig.url
                ? serverConfig.url
                : "(no details)";
        lines.push(`${name}: ${toolCount} tool(s): ${detail}`);
    }
    return lines.join("\n");
}
function isDirectExecution() {
    if (!process.argv[1])
        return false;
    try {
        return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
    }
    catch {
        return false;
    }
}
if (isDirectExecution()) {
    runConfigAdminCli().then((code) => {
        process.exitCode = code;
    });
}
/**
 * CLI entry point for config admin operations.
 * Returns an exit code (0 = success, 1 = error).
 * Not a server entrypoint — no shebang, no MCP transport wiring.
 */
export async function runConfigAdminCli(argv) {
    const args = argv ?? process.argv.slice(2);
    if (args.length === 0) {
        console.error("Usage: zenith-mcp-config <command> [options]");
        console.error("Commands: list, status, install, scan");
        return 1;
    }
    const command = args[0];
    const rest = args.slice(1);
    try {
        switch (command) {
            case "list": {
                let configPath;
                let serverFilter;
                let disabledOnly = false;
                for (let i = 0; i < rest.length; i++) {
                    const arg = rest[i];
                    if (arg === "--server-filter" || arg === "--server") {
                        serverFilter = rest[++i];
                    }
                    else if (arg === "--disabled-only" || arg === "--disabled") {
                        disabledOnly = true;
                    }
                    else if (!arg.startsWith("--")) {
                        configPath = arg;
                    }
                }
                const output = cmdList({ configPath, serverFilter, disabledOnly });
                console.error(output);
                return 0;
            }
            case "status": {
                const configPath = rest[0];
                const output = cmdStatus(configPath);
                console.error(output);
                return 0;
            }
            case "install": {
                const serverName = rest[0];
                if (!serverName) {
                    console.error("Usage: zenith-mcp-config install <server-name> [command] [args...]");
                    return 1;
                }
                const commandStr = rest[1];
                const installArgs = rest.slice(2);
                const output = cmdInstall(serverName, {
                    command: commandStr,
                    args: installArgs.length > 0 ? installArgs : undefined,
                });
                console.error(output);
                return 0;
            }
            case "scan": {
                const output = cmdScan({ serverName: rest[0] });
                console.error(output);
                return 0;
            }
            default:
                console.error(`Unknown command: ${command}`);
                console.error("Commands: list, status, install, scan");
                return 1;
        }
    }
    catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        return 1;
    }
}
//# sourceMappingURL=admin-cli.js.map