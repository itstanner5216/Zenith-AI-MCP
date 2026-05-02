import { MCPConfigAdapter } from "../base.js";
declare class ClaudeDesktopAdapter extends MCPConfigAdapter {
    toolName: string;
    displayName: string;
    configFormat: "json";
    supportedPlatforms: ("macos" | "linux" | "windows")[];
    configPath(): string;
    private claudeCodePaths;
    readConfig(): any;
    writeConfig(data: Record<string, any>): void;
    registerServer(name: string, config: Record<string, any>): void;
    discoverServers(): Record<string, Record<string, any>>;
}
export declare const adapter: ClaudeDesktopAdapter;
export {};
