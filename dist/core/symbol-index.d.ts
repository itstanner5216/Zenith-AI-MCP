export declare function findRepoRoot(filePath: any): string | null;
export declare function getDb(repoRoot: any): any;
export declare function getSessionId(clientSessionId: any): any;
export declare function pruneOldSessions(db: any, currentSessionId: any): void;
export declare function indexFile(db: any, repoRoot: any, absFilePath: any): Promise<void>;
export declare function indexDirectory(db: any, repoRoot: any, dirPath: any, opts?: {}): Promise<void>;
export declare function ensureIndexFresh(db: any, repoRoot: any, absFilePaths: any): Promise<number>;
export declare function impactQuery(db: any, symbolName: any, opts?: {}): {
    disambiguate: boolean;
    definitions: any;
    results?: undefined;
    total?: undefined;
} | {
    results: ({
        name: any;
        filePath: any;
        refCount: any;
        callCount?: undefined;
    } | {
        name: any;
        callCount: any;
        filePath?: undefined;
        refCount?: undefined;
    })[];
    total: number;
    disambiguate?: undefined;
    definitions?: undefined;
};
export declare function snapshotSymbol(db: any, symbolName: any, filePath: any, originalText: any, sessionId: any, line: any): void;
export declare function getVersionHistory(db: any, symbolName: any, sessionId: any, filePath: any): any;
export declare function getVersionText(db: any, versionId: any): any;
export declare function restoreVersion(db: any, symbolName: any, versionId: any, sessionId: any, currentText: any): any;
