export declare const DEFAULT_COMPRESSION_KEEP_RATIO = 0.7;
export declare function computeCompressionBudget(rawLength: number, maxChars: number, keepRatio?: number): number;
export declare function isCompressionUseful(rawText: unknown, compressedText: unknown, maxChars: number, keepRatio?: number): boolean;
export declare function truncateToBudget(text: unknown, budget: number): {
    text: string;
    truncated: boolean;
};
export declare function runToonBridge(validPath: string, budget: number): Promise<string | null>;
export declare function compressTextFile(validPath: string, rawText: string, maxChars: number, keepRatio?: number): Promise<{
    text: string;
    targetBudget: number;
    rawLength: number;
    compressedLength: number;
} | null>;
