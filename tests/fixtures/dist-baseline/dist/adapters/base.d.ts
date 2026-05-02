export declare abstract class MCPConfigAdapter {
    abstract toolName: string;
    abstract displayName: string;
    abstract configFormat: "json" | "toml" | "yaml" | "json5";
    abstract supportedPlatforms: ("macos" | "linux" | "windows")[];
    backupDir?: string;
    isSupported(): boolean;
    protected backup(filePath: string): void;
    abstract configPath(): string | null;
    abstract readConfig(): Record<string, any>;
    abstract writeConfig(data: Record<string, any>): void;
    abstract registerServer(name: string, config: Record<string, any>): void;
    abstract discoverServers(): Record<string, Record<string, any>>;
}
