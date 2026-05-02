import { MCPConfigAdapter } from "../base.js";
declare class JetBrainsAdapter extends MCPConfigAdapter {
    toolName: string;
    displayName: string;
    configFormat: "json";
    supportedPlatforms: ("macos" | "linux" | "windows")[];
    private globalConfigPath;
    private projectConfigPaths;
    private configPaths;
    configPath(): string;
    readConfig(): any;
    writeConfig(data: Record<string, any>): void;
    registerServer(name: string, config: Record<string, any>): void;
    discoverServers(): Record<string, Record<string, any>>;
}
export declare const adapter: JetBrainsAdapter;
export {};
