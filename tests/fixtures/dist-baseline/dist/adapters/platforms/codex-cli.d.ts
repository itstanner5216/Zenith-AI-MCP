import { MCPConfigAdapter } from "../base.js";
declare class CodexCLIAdapter extends MCPConfigAdapter {
    toolName: string;
    displayName: string;
    configFormat: "toml";
    supportedPlatforms: ("macos" | "linux" | "windows")[];
    configPath(): string;
    readConfig(): Record<string, any>;
    writeConfig(data: Record<string, any>): void;
    registerServer(name: string, config: Record<string, any>): void;
    discoverServers(): any;
}
export declare const adapter: CodexCLIAdapter;
export {};
