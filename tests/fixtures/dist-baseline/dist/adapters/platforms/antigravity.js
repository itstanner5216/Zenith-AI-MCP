import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { MCPConfigAdapter } from "../base.js";
class AntigravityAdapter extends MCPConfigAdapter {
    toolName = "antigravity";
    displayName = "Antigravity";
    configFormat = "json";
    supportedPlatforms = ["macos", "linux", "windows"];
    configPath() {
        return join(homedir(), ".gemini", "antigravity", "mcp_config.json");
    }
    readConfig() {
        const p = this.configPath();
        if (!existsSync(p))
            return {};
        return JSON.parse(readFileSync(p, "utf-8"));
    }
    writeConfig(data) {
        const p = this.configPath();
        this.backup(p);
        mkdirSync(join(p, ".."), { recursive: true });
        writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf-8");
    }
    registerServer(name, config) {
        const data = this.readConfig();
        if (!data.mcpServers)
            data.mcpServers = {};
        data.mcpServers[name] = config;
        this.writeConfig(data);
    }
    discoverServers() {
        return this.readConfig().mcpServers ?? {};
    }
}
export const adapter = new AntigravityAdapter();
//# sourceMappingURL=antigravity.js.map