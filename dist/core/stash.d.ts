export declare function stashEntry(ctx: any, type: string, filePath: string, payload: any): any;
export declare function getStashEntry(ctx: any, id: number, filePath: string): {
    id: any;
    type: any;
    filePath: any;
    payload: any;
    attempts: any;
    createdAt: any;
} | null;
export declare function consumeAttempt(ctx: any, id: number, filePath: string): boolean;
export declare function clearStash(ctx: any, id: number, filePath: string): void;
export declare function listStash(ctx: any, filePath: string): {
    entries: any;
    isGlobal: any;
};
export declare function stashEdits(ctx: any, filePath: string, edits: any, failedIndices: any): any;
export declare function stashWrite(ctx: any, filePath: string, content: string, mode: string): any;
