/**
 * Reciprocal Rank Fusion and alpha-decay blending for turn-by-turn tool ranking.
 */
import type { ScoredTool } from "../models.js";
export declare const RRF_K = 10;
export declare function weightedRrf(envRanked: ScoredTool[], convRanked: ScoredTool[], alpha: number): ScoredTool[];
export declare function computeAlpha(turn: number, workspaceConfidence: number, convConfidence: number, rootsChanged?: boolean, explicitToolMention?: boolean): number;
