export declare const CHAR_BUDGET: number;
export declare const RANK_THRESHOLD = 50;
export declare const DEFAULT_EXCLUDES: string[];
export declare const SENSITIVE_PATTERNS: string[];
export declare function isSensitive(filePath: string): boolean;
export declare class BM25Index {
    k1: number;
    b: number;
    beta: number;
    _postingLists: Map<string, Map<string, number>>;
    _docLengths: Map<string, number>;
    _avgDocLength: number;
    _idfCache: Map<string, number>;
    _termEntropy: Map<string, number>;
    _termTotalFreqs: Map<string, number>;
    _totalDocs: number;
    constructor(k1?: number, b?: number, beta?: number);
    static tokenize(text: string): string[];
    build(docs: Array<{
        id: string;
        text: string;
    }>): void;
    search(query: string, topK?: number): {
        id: string;
        score: number;
    }[];
}
export declare function bm25RankResults(lines: string[], query: string, charBudget?: number): {
    ranked: string[];
    totalCount: number;
};
export declare function bm25PreFilterFiles(rootPath: string, query: string, topK?: number, excludePatterns?: string[]): Promise<string[]>;
export declare const RG_PATH = "/usr/bin/rg";
export declare function ripgrepAvailable(): Promise<boolean>;
export declare function ripgrepSearch(rootPath: string, options?: any): Promise<unknown>;
export declare function ripgrepFindFiles(rootPath: string, options?: any): Promise<unknown>;
export declare function readFileAsBase64Stream(filePath: string): Promise<unknown>;
