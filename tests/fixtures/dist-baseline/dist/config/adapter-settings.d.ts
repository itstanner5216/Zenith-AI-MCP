export interface AdapterSettings {
    enabledAdapters: string[];
    backupDir: string | null;
}
export declare function loadSettings(): AdapterSettings;
export declare function saveSettings(settings: AdapterSettings): void;
export declare function getBackupDir(): string | null;
export declare function isAdapterEnabled(toolName: string): boolean;
