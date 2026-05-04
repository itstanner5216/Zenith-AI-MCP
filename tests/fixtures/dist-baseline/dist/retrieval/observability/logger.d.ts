import type { RankingEvent, RetrievalContext, ScoredTool } from "../models.js";
export interface RetrievalLogger {
    log(event: RankingEvent): Promise<void>;
    logRetrieval?(context: RetrievalContext, results: ScoredTool[], latencyMs: number): Promise<void>;
    logRetrievalMiss?(toolName: string, context: RetrievalContext): Promise<void>;
    logToolSequence?(sessionId: string, toolA: string, toolB: string): Promise<void>;
    logAlert?(alertName: string, message: string, details?: Record<string, unknown>): Promise<void>;
    close?(): Promise<void>;
}
export declare class NullRetrievalLogger implements RetrievalLogger {
    log(_event: RankingEvent): Promise<void>;
    logRetrieval(_context: RetrievalContext, _results: ScoredTool[], _latencyMs: number): Promise<void>;
    logRetrievalMiss(_toolName: string, _context: RetrievalContext): Promise<void>;
    logToolSequence(_sessionId: string, _toolA: string, _toolB: string): Promise<void>;
    logAlert(_alertName: string, _message: string, _details?: Record<string, unknown>): Promise<void>;
}
export declare class FileRetrievalLogger implements RetrievalLogger {
    private readonly _path;
    constructor(logPath: string);
    log(event: RankingEvent): Promise<void>;
    logAlert(alertName: string, message: string, details?: Record<string, unknown>): Promise<void>;
}
