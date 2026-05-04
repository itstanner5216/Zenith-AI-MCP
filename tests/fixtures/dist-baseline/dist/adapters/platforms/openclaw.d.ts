import { MCPConfigAdapter } from "../base.js";
declare class OpenClawAdapter extends MCPConfigAdapter {
    toolName: string;
    displayName: string;
    configFormat: "json5";
    supportedPlatforms: ("macos" | "linux" | "windows")[];
    private resolvePath;
    configPath(): string;
    readConfig(): Record<string, any>;
    writeConfig(data: Record<string, any>): void;
    registerServer(name: string, config: Record<string, any>): void;
    discoverServers(): any;
}
export declare const adapter: OpenClawAdapter;
export {};
