/**
 * Two-tier description assembly for token-optimized tool lists.
 *
 * Full tier: complete description + full inputSchema (top-K tools).
 * Summary tier: truncated description + simplified schema (remaining tools).
 * ~90% token reduction for summary-tier tools.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { RetrievalConfig, ScoredTool } from "./models.js";
export declare class TieredAssembler {
    assemble(tools: ScoredTool[], config: RetrievalConfig, routingToolSchema?: Tool): Tool[];
}
