import { dirname, join } from "path";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { MCPConfigAdapter } from "../base.js";
import { readToml, writeToml } from "../helpers/toml.js";
class GptmeAdapter extends MCPConfigAdapter {
    toolName = "gptme";
    displayName = "gptme";
    configFormat = "toml";
    supportedPlatforms = ["macos", "linux", "windows"];
    configPath() {
        return join(homedir(), ".config", "gptme", "config.toml");
    }
    readConfig() {
        const p = this.configPath();
        if (!p)
            return {};
        return readToml(p);
    }
    writeConfig(data) {
        const p = this.configPath();
        mkdirSync(dirname(p), { recursive: true });
        this.backup(p);
        writeToml(p, data);
    }
    registerServer(name, config) {
        const data = this.readConfig();
        if (!data.mcp)
            data.mcp = {};
        const servers = data.mcp.servers || [];
        const filtered = servers.filter(s => s.name !== name);
        filtered.push({ name, ...config });
        data.mcp.servers = filtered;
        this.writeConfig(data);
    }
    discoverServers() {
        const serversList = this.readConfig().mcp?.servers || [];
        const result = {};
        for (const s of serversList) {
            if (s.name) {
                const { name, ...rest } = s;
                result[name] = rest;
            }
        }
        return result;
    }
}
export const adapter = new GptmeAdapter();
//# sourceMappingURL=gptme.js.map