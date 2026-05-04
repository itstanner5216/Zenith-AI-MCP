import { MCPConfigAdapter } from "../base.js";
declare class ClineAdapter extends MCPConfigAdapter {
    toolName: string;
    displayName: string;
    configFormat: "json";
    supportedPlatforms: ("macos" | "linux" | "windows")[];
    private vscodePath;
    private cliPath;
    configPath(): string;
    readConfig(): any;
    writeConfig(data: Record<string, any>): void;
    registerServer(name: string, config: Record<string, any>): void;
    discoverServers(): any;
}
export declare const adapter: ClineAdapter;
export {};
