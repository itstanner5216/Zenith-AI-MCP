/**
 * Relevance ranker with specificity-based tiebreaking.
 *
 * Ranks tools by score (descending) with most-specific-first tiebreaking
 * for tools with similar scores. Exploits LLM primacy bias (1.3-3.4x).
 */
import type { ScoredTool } from "../models.js";
export declare class RelevanceRanker {
    rank(tools: ScoredTool[]): ScoredTool[];
}
