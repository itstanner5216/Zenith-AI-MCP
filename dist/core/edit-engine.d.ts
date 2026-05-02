declare function findMatch(content: any, oldText: any, nearLine: any): {
    index: any;
    matchedText: any;
    strategy: string;
} | null;
declare function applyEditList(content: any, edits: any, { filePath, isBatch, disambiguations }?: {}): Promise<{
    workingContent: any;
    errors: {
        i: number;
        msg: string;
    }[];
    pendingSnapshots: {
        symbol: any;
        originalText: any;
        line: any;
        filePath: any;
    }[];
}>;
declare function syntaxWarn(filePath: any, content: any): Promise<string>;
export { findMatch, applyEditList, syntaxWarn };
