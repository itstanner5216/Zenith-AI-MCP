import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import { defaultRetrievalConfig } from "../../retrieval/models.js";
export const DEFAULT_ZENITH_MCP_CONFIG_PATH = join(homedir(), ".zenith-mcp", "zenith-mcp", "servers.yaml");
const LEGACY_CONFIG_PATH = join(homedir(), ".zenith-mcp", ["multi", "mcp"].join("-"), "servers.yaml");
/**
 * Thin wrapper delegating to SA4's defaultRetrievalConfig().
 * Do NOT reimplement retrieval defaults here.
 */
export function defaultRetrievalSettings() {
    return defaultRetrievalConfig();
}
export function defaultZenithMcpConfig() {
    return {
        servers: {},
        profiles: {},
        retrieval: defaultRetrievalSettings(),
    };
}
/**
 * Normalize a single raw YAML object into a fully-typed ServerConfig.
 * Handles both TS-era and Python-era field names.
 * Never throws — every missing field gets a safe default.
 */
export function normalizeServerConfig(name, raw) {
    if (typeof raw !== "object" || raw === null) {
        return {
            name,
            args: [],
            env: {},
            enabled: true,
            tools: {},
            toolFilters: { allow: [], deny: [] },
        };
    }
    const r = raw;
    // ── transport ──────────────────────────────────────────────────────
    // Accept TS "transport" or Python "type"; convert Python-era values.
    let transport;
    if (typeof r.transport === "string") {
        const v = r.transport;
        if (v === "stdio" || v === "sse" || v === "streamable-http") {
            transport = v;
        }
    }
    else if (typeof r.type === "string") {
        const pyType = r.type;
        if (pyType === "stdio" || pyType === "sse") {
            transport = pyType;
        }
        else if (pyType === "streamablehttp" || pyType === "http") {
            transport = "streamable-http";
        }
        else if (pyType === "streamable-http") {
            transport = "streamable-http";
        }
        // Unknown values → transport stays undefined
    }
    // ── idleTimeoutSeconds ─────────────────────────────────────────────
    // Python: always_on=true → no timeout; idle_timeout_minutes → seconds
    let idleTimeoutSeconds;
    if (typeof r.idleTimeoutSeconds === "number") {
        idleTimeoutSeconds = r.idleTimeoutSeconds;
    }
    else if (r.always_on === true) {
        idleTimeoutSeconds = undefined; // always on ⇒ omit
    }
    else if (typeof r.idle_timeout_minutes === "number") {
        idleTimeoutSeconds = r.idle_timeout_minutes * 60;
    }
    // ── toolFilters ────────────────────────────────────────────────────
    // TS: { allow, deny }. Python: triggers → allow list.
    let toolFilters;
    if (typeof r.toolFilters === "object" &&
        r.toolFilters !== null &&
        !Array.isArray(r.toolFilters)) {
        const tf = r.toolFilters;
        toolFilters = {
            allow: Array.isArray(tf.allow)
                ? tf.allow.filter((v) => typeof v === "string")
                : [],
            deny: Array.isArray(tf.deny)
                ? tf.deny.filter((v) => typeof v === "string")
                : [],
        };
    }
    else if (Array.isArray(r.triggers)) {
        toolFilters = {
            allow: r.triggers.filter((v) => typeof v === "string"),
            deny: [],
        };
    }
    else {
        toolFilters = { allow: [], deny: [] };
    }
    // ── tools ──────────────────────────────────────────────────────────
    // Normalize each tool entry; accept both inputSchema and input_schema.
    const tools = {};
    if (typeof r.tools === "object" && r.tools !== null && !Array.isArray(r.tools)) {
        for (const [toolName, rawTool] of Object.entries(r.tools)) {
            if (typeof rawTool === "object" && rawTool !== null) {
                const t = rawTool;
                tools[toolName] = {
                    name: toolName,
                    description: typeof t.description === "string" ? t.description : undefined,
                    inputSchema: (t.inputSchema ?? t.input_schema) ??
                        undefined,
                    enabled: typeof t.enabled === "boolean" ? t.enabled : true,
                    discoveredAt: typeof t.discoveredAt === "string" ? t.discoveredAt : undefined,
                    lastSeenAt: typeof t.lastSeenAt === "string" ? t.lastSeenAt : undefined,
                };
            }
        }
    }
    // ── args ───────────────────────────────────────────────────────────
    const args = Array.isArray(r.args)
        ? r.args.filter((v) => typeof v === "string")
        : [];
    // ── env ────────────────────────────────────────────────────────────
    const env = {};
    if (typeof r.env === "object" && r.env !== null && !Array.isArray(r.env)) {
        for (const [k, v] of Object.entries(r.env)) {
            if (typeof v === "string") {
                env[k] = v;
            }
        }
    }
    return {
        name,
        command: typeof r.command === "string" ? r.command : undefined,
        args,
        env,
        url: typeof r.url === "string" ? r.url : undefined,
        transport,
        enabled: typeof r.enabled === "boolean" ? r.enabled : true,
        tools,
        toolFilters,
        idleTimeoutSeconds,
    };
}
/**
 * Normalize a full raw YAML object into ZenithMcpConfig.
 * Returns a default config for any invalid input without throwing.
 */
function normalizeZenithMcpConfig(raw) {
    const config = defaultZenithMcpConfig();
    if (typeof raw !== "object" || raw === null) {
        return config;
    }
    const r = raw;
    // ── servers ────────────────────────────────────────────────────────
    if (typeof r.servers === "object" &&
        r.servers !== null &&
        !Array.isArray(r.servers)) {
        for (const [serverName, serverRaw] of Object.entries(r.servers)) {
            config.servers[serverName] = normalizeServerConfig(serverName, serverRaw);
        }
    }
    // ── profiles ───────────────────────────────────────────────────────
    // TS: { name, servers: string[] }
    // Python: { servers: { serverName: [toolNames] } } — extract keys only.
    if (typeof r.profiles === "object" &&
        r.profiles !== null &&
        !Array.isArray(r.profiles)) {
        for (const [profileName, profileRaw] of Object.entries(r.profiles)) {
            if (typeof profileRaw === "object" && profileRaw !== null) {
                const p = profileRaw;
                let servers;
                if (Array.isArray(p.servers)) {
                    servers = p.servers.filter((v) => typeof v === "string");
                }
                else if (typeof p.servers === "object" && p.servers !== null) {
                    // Python-era dict format: keys are server names
                    servers = Object.keys(p.servers);
                }
                else {
                    servers = [];
                }
                config.profiles[profileName] = { name: profileName, servers };
            }
        }
    }
    // ── retrieval ──────────────────────────────────────────────────────
    // Merge on top of SA4 defaults so every field has a value.
    if (typeof r.retrieval === "object" && r.retrieval !== null) {
        const defaults = defaultRetrievalSettings();
        config.retrieval = {
            ...defaults,
            ...r.retrieval,
        };
    }
    return config;
}
/**
 * Load ZenithMcpConfig from a YAML file.
 * Returns a default empty config when the file does not exist or is invalid.
 * Never throws.
 */
export function loadZenithMcpConfig(path) {
    let configPath = path ?? DEFAULT_ZENITH_MCP_CONFIG_PATH;
    if (!existsSync(configPath)) {
        if (path || !existsSync(LEGACY_CONFIG_PATH)) {
            return defaultZenithMcpConfig();
        }
        configPath = LEGACY_CONFIG_PATH;
    }
    try {
        const content = readFileSync(configPath, "utf-8");
        const raw = yaml.load(content);
        if (typeof raw !== "object" || raw === null) {
            return defaultZenithMcpConfig();
        }
        return normalizeZenithMcpConfig(raw);
    }
    catch (e) {
        console.error(`Error loading config from ${configPath}:`, e);
        return defaultZenithMcpConfig();
    }
}
/**
 * Save ZenithMcpConfig to a YAML file.
 * Creates parent directories as needed.
 * Logs and re-throws on write error.
 */
export function saveZenithMcpConfig(config, path) {
    const configPath = path ?? DEFAULT_ZENITH_MCP_CONFIG_PATH;
    try {
        const dir = dirname(configPath);
        mkdirSync(dir, { recursive: true });
    }
    catch (e) {
        console.error(`Failed to create config directory for ${configPath}:`, e);
        throw e;
    }
    try {
        // Strip undefined values for clean YAML output
        const clean = JSON.parse(JSON.stringify(config));
        const content = yaml.dump(clean, {
            flowLevel: -1,
            sortKeys: false,
            lineWidth: -1,
        });
        writeFileSync(configPath, content, "utf-8");
    }
    catch (e) {
        console.error(`Failed to write config to ${configPath}:`, e);
        throw e;
    }
}
//# sourceMappingURL=config.js.map