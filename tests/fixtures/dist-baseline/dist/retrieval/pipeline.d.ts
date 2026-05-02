/**
 * RetrievalPipeline — single entry point for tool filtering and ranking.
 * Converted from src/zenithmcp/retrieval/pipeline.py
 *
 * Pure data-processing class with NO transport layer (HAZARD 1).
 * Session IDs always passed in as plain strings (HAZARD 2).
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { RetrievalConfig, ToolMapping } from "./models.js";
import type { ToolRetriever } from "./base.js";
import { SessionStateManager } from "./session.js";
import type { TelemetryScanner } from "./telemetry/scanner.js";
import type { RetrievalLogger } from "./observability/logger.js";
import type { RollingMetrics } from "./observability/metrics.js";
export declare function extractConversationTerms(raw: string): string;
export declare class RetrievalPipeline {
    private readonly retriever;
    private readonly ssm;
    private readonly logger;
    private readonly config;
    private readonly reg;
    private readonly scanner?;
    private readonly metrics?;
    /** Tier-3 keyword retriever — set externally if available. */
    keywordRetriever: ToolRetriever | null;
    private _turns;
    private _roots;
    private _evidence;
    private _toolHist;
    private _argKeys;
    private _routerDescribes;
    private _routerProxies;
    /** Direct-call ledger — ONLY non-proxy calls (HAZARD 5). */
    private _directCalls;
    private _curTurnUsed;
    private _prevTurnUsed;
    private _states;
    private _inTurn;
    private _pendingRebuild;
    private _snapVer;
    constructor(o: {
        retriever: ToolRetriever;
        sessionManager: SessionStateManager;
        logger: RetrievalLogger;
        config: RetrievalConfig;
        toolRegistry: Record<string, ToolMapping>;
        telemetryScanner?: TelemetryScanner;
        rollingMetrics?: RollingMetrics;
    });
    setSessionRoots(sid: string, uris: string[]): Promise<void>;
    getSessionToolHistory(sid: string): string[];
    getSessionArgumentKeys(sid: string): string[];
    getSessionRouterDescribes(sid: string): string[];
    private idxOk;
    private hasKw;
    private hasFreq;
    private classify;
    private staticDefaults;
    private freqPrior;
    private universal;
    getToolsForList(sid: string, conversationContext?: string): Promise<Tool[]>;
    rebuildCatalog(registry: Record<string, ToolMapping>): void;
    onToolCalled(sid: string, toolName: string, args: Record<string, unknown>, isRouterProxy?: boolean): Promise<boolean>;
    recordRouterDescribe(sid: string, toolName: string): void;
    cleanupSession(sid: string): void;
}
