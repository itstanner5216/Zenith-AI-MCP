import type { RootEvidence, WorkspaceEvidence } from "../models.js";
export interface ScanOptions {
    maxDepth: number;
    maxFiles: number;
    timeoutMs: number;
}
export declare class TelemetryScanner {
    private readonly _options;
    constructor(options?: Partial<ScanOptions>);
    scanRoot(rootUri: string, rootName?: string): Promise<RootEvidence>;
    scanRoots(rootUris: string[], rootNames?: (string | undefined)[]): Promise<WorkspaceEvidence>;
}
export declare function scanRoots(rootUris: string[], rootNames?: (string | undefined)[], options?: Partial<ScanOptions>): Promise<WorkspaceEvidence>;
