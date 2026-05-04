import type { RetrievalContext, ScoredTool, ToolMapping } from "./models.js";
export declare abstract class ToolRetriever {
    /**
     * Score and filter candidate tools based on context.
     *
     * Implementations MUST NOT modify tool_to_server — read-only consumers.
     * Returns scored subset ordered by relevance.
     */
    abstract retrieve(context: RetrievalContext, candidates: ToolMapping[]): Promise<ScoredTool[]>;
}
export declare class PassthroughRetriever extends ToolRetriever {
    retrieve(_context: RetrievalContext, candidates: ToolMapping[]): Promise<ScoredTool[]>;
}
