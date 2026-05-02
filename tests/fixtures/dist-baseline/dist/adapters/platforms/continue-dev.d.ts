import { MCPConfigAdapter } from "../base.js";
declare class ContinueDevAdapter extends MCPConfigAdapter {
    toolName: string;
    displayName: string;
    configFormat: "yaml";
    supportedPlatforms: ("macos" | "linux" | "windows")[];
    configPath(): string;
    readConfig(): Record<string, any>;
    writeConfig(data: Record<string, any>): void;
    registerServer(name: string, config: Record<string, any>): void;
    discoverServers(): Record<string, Record<string, any>>;
}
export declare const adapter: ContinueDevAdapter;
export {};
