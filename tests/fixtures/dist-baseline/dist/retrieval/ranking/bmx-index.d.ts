/**
 * BMX (BM𝒳) — Entropy-Weighted Lexical Search Index for Hybrid Retrieval.
 *
 * Implements the BMX algorithm (arXiv:2408.06643, Li et al., August 2024),
 * a deterministic, CPU-only successor to BM25 that adds entropy-weighted
 * query-document similarity scoring atop a restructured TF-IDF core.
 */
import type { ToolDoc } from "../models.js";
export declare class BMXIndex {
    alphaOverride?: number;
    betaOverride?: number;
    normalizeScores: boolean;
    private _documents;
    private _docLengths;
    private _avgDocLength;
    private _docFreqs;
    private _idfCache;
    private _totalDocs;
    private _isBuilt;
    private _alpha;
    private _beta;
    private _termEntropy;
    private _termTotalFreqs;
    private _postingListTFs;
    private _invertedIndex;
    private _dirtyTerms;
    private _fieldIndexes;
    private _fieldWeights;
    constructor(opts?: {
        alphaOverride?: number;
        betaOverride?: number;
        normalizeScores?: boolean;
    });
    private _tokenize;
    private static _sigmoid;
    private static _shannonEntropy;
    private _computeAlpha;
    private _computeBeta;
    private _computeTermEntropies;
    private _flushDirtyEntropies;
    private _getNormalizedEntropy;
    private _resetIndexState;
    buildIndex(chunks: Array<{
        chunk_id: string;
        text: string;
    }>): void;
    search(query: string, topK?: number, normalize?: boolean): Array<[string, number]>;
    private _scoreDocument;
    private _computeScoreMax;
    updateIndex(chunkId: string, text: string): void;
    removeFromIndex(chunkId: string): boolean;
    getIndexStats(): {
        totalDocuments: number;
        uniqueTerms: number;
        avgDocLength: number;
        isBuilt: boolean;
        alpha: number;
        beta: number;
        alphaOverride: number | undefined;
        betaOverride: number | undefined;
        normalizeScores: boolean;
        avgEntropy: number;
    };
    clear(): void;
    buildFieldIndex(toolDocs: ToolDoc[]): void;
    searchFields(query: string, topK?: number): Array<[string, number]>;
}
