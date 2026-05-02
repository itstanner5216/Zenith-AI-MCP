import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
const CONFIG_DIR = join(homedir(), ".zenith-mcp");
const CONFIG_FILE = join(CONFIG_DIR, "adapter-config.json");
const DEFAULTS = { enabledAdapters: [], backupDir: null };
function defaultSettings() {
    return { enabledAdapters: [], backupDir: null };
}
export function loadSettings() {
    // Env var overrides take full priority
    const envAdapters = process.env.ZENITH_MCP_ADAPTERS_ENABLED;
    const envBackup = process.env.ZENITH_MCP_ADAPTER_BACKUP_DIR;
    if (envAdapters !== undefined || envBackup !== undefined) {
        return {
            enabledAdapters: envAdapters ? envAdapters.split(",").map(s => s.trim()).filter(Boolean) : [],
            backupDir: envBackup ?? null,
        };
    }
    if (!existsSync(CONFIG_FILE))
        return defaultSettings();
    try {
        return { ...defaultSettings(), ...JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) };
    }
    catch {
        return defaultSettings();
    }
}
export function saveSettings(settings) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}
export function getBackupDir() {
    return loadSettings().backupDir;
}
export function isAdapterEnabled(toolName) {
    const { enabledAdapters } = loadSettings();
    return enabledAdapters.length === 0 ? false : enabledAdapters.includes(toolName);
}
//# sourceMappingURL=adapter-settings.js.map