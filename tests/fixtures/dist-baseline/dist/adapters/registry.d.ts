import { MCPConfigAdapter } from "./base.js";
declare class AdapterRegistry {
    private _adapters;
    constructor(backupDir?: string);
    all(): MCPConfigAdapter[];
    get(toolName: string): MCPConfigAdapter;
}
export declare function configureRegistry(backupDir?: string): void;
export declare function getAdapter(toolName: string): MCPConfigAdapter;
export declare function listAdapters(): MCPConfigAdapter[];
export { AdapterRegistry };
