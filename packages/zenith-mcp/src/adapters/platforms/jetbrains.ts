import { join, dirname } from "path";
import { homedir, platform } from "os";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { MCPConfigAdapter } from "../base.js";

class JetBrainsAdapter extends MCPConfigAdapter {
  toolName = "jetbrains";
  displayName = "JetBrains IDEs";
  configFormat = "json" as const;
  supportedPlatforms: ("macos" | "linux" | "windows")[] = ["macos", "linux", "windows"];

  private globalConfigPath() {
    const plat = platform();
    if (plat === "win32") {
      const userprofile = process.env.USERPROFILE;
      const base = userprofile || homedir();
      return join(base, ".junie", "mcp", "mcp.json");
    }
    return join(homedir(), ".junie", "mcp", "mcp.json");
  }

  private projectConfigPaths() {
    const paths: string[] = [];
    let current = process.cwd();
    while (true) {
      paths.push(join(current, ".junie", "mcp", "mcp.json"));
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return paths;
  }

  private configPaths() {
    const paths = [this.globalConfigPath(), ...this.projectConfigPaths().reverse()];
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      unique.push(path);
    }
    return unique;
  }

  configPath() {
    return this.globalConfigPath();
  }

  readConfig() {
    const p = this.configPath();
    if (!p || !existsSync(p)) return {};
    try {
      const data = JSON.parse(readFileSync(p, "utf-8"));
      if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
      return data;
    } catch (e) {
      console.error(`Failed to read JetBrains config at ${p}: ${e}`);
      throw e;
    }
  }

  writeConfig(data: Record<string, unknown>) {
    const p = this.configPath();
    this.backup(p);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }

  registerServer(name: string, config: Record<string, unknown>) {
    const data = this.readConfig() as Record<string, unknown>;
    const servers =
      typeof data.mcpServers === "object" &&
      data.mcpServers !== null &&
      !Array.isArray(data.mcpServers)
        ? (data.mcpServers as Record<string, unknown>)
        : {};
    servers[name] = config;
    data.mcpServers = servers;
    this.writeConfig(data);
  }

  discoverServers() {
    const result: Record<string, Record<string, unknown>> = {};
    for (const p of this.configPaths()) {
      if (!existsSync(p)) continue;
      try {
        const data = JSON.parse(readFileSync(p, "utf-8"));
        if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
        const servers = (data as Record<string, unknown>).mcpServers;
        if (typeof servers === "object" && servers !== null && !Array.isArray(servers)) {
          Object.assign(result, servers as Record<string, Record<string, unknown>>);
        }
      } catch (error) {
        console.warn(
          `Skipping malformed JetBrains MCP config at ${p}: ${(error as Error).message}`,
        );
        continue;
      }
    }
    return result;
  }
}

export const adapter = new JetBrainsAdapter();
