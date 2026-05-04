export declare function setAllowedDirectories(directories: string[]): void;
export declare function getAllowedDirectories(): string[];
export declare function createFilesystemContext(initialAllowedDirectories?: string[]): {
    getAllowedDirectories: () => string[];
    setAllowedDirectories: (directories: string[]) => void;
    validatePath: (requestedPath: string) => Promise<string>;
};
export declare function formatSize(bytes: number): string;
export declare function normalizeLineEndings(text: string): string;
export declare function createUnifiedDiff(originalContent: string, newContent: string, filepath?: string): string;
export declare function createMinimalDiff(originalContent: string, newContent: string, filepath?: string): string;
export declare function validatePath(requestedPath: string): Promise<string>;
export declare function getFileStats(filePath: string): Promise<{
    size: number;
    created: Date;
    modified: Date;
    accessed: Date;
    isDirectory: boolean;
    isFile: boolean;
    permissions: string;
}>;
export declare function readFileContent(filePath: string, encoding?: string): Promise<string>;
export declare function writeFileContent(filePath: string, content: string): Promise<void>;
export declare function applyFileEdits(filePath: string, edits: Array<{
    oldText: string;
    newText: string;
}>, dryRun?: boolean): Promise<string>;
export declare function countOccurrences(text: string, search: string): number;
export declare function tailFile(filePath: string, numLines: number): Promise<string>;
export declare function headFile(filePath: string, numLines: number): Promise<string>;
export declare function offsetReadFile(filePath: string, offset: number, length: number): Promise<unknown>;
export declare function searchFilesWithValidation(rootPath: string, pattern: string, allowedDirectories: string[], options?: {
    excludePatterns?: string[];
}): Promise<string[]>;
