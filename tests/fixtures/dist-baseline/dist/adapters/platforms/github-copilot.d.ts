import { MCPConfigAdapter } from "../base.js";
declare class GitHubCopilotAdapter extends MCPConfigAdapter {
    toolName: string;
    displayName: string;
    configFormat: "json";
    supportedPlatforms: ("macos" | "linux" | "windows")[];
    configPath(): string;
    readConfig(): any;
    writeConfig(data: Record<string, any>): void;
    registerServer(name: string, config: Record<string, any>): void;
    discoverServers(): any;
}
export declare const adapter: GitHubCopilotAdapter;
export {};
