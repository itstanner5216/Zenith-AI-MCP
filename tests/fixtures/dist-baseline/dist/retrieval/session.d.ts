/**
 * Per-session tool set management with bounded demotion support.
 */
import type { RetrievalConfig } from "./models.js";
export declare class SessionStateManager {
    private readonly _config;
    private readonly _sessions;
    constructor(config: RetrievalConfig);
    getOrCreateSession(sessionId: string): Set<string>;
    getActiveTools(sessionId: string): Set<string>;
    addTools(sessionId: string, toolKeys: string[]): string[];
    promote(sessionId: string, toolKeys: string[]): string[];
    demote(sessionId: string, toolKeys: string[], usedThisTurn: Set<string>, maxPerTurn?: number): string[];
    cleanupSession(sessionId: string): void;
}
