export class BMXIndex {
    // Optional parameter overrides
    alphaOverride;
    betaOverride;
    normalizeScores = false;
    // Internal state
    _documents = new Map();
    _docLengths = new Map();
    _avgDocLength = 0.0;
    _docFreqs = new Map();
    _idfCache = new Map();
    _totalDocs = 0;
    _isBuilt = false;
    // BMX-specific state
    _alpha = 1.0;
    _beta = 0.01;
    _termEntropy = new Map();
    _termTotalFreqs = new Map();
    _postingListTFs = new Map();
    _invertedIndex = new Map();
    _dirtyTerms = new Set();
    // BMXF field indexes
    _fieldIndexes = new Map();
    _fieldWeights = new Map();
    constructor(opts) {
        if (opts?.alphaOverride !== undefined)
            this.alphaOverride = opts.alphaOverride;
        if (opts?.betaOverride !== undefined)
            this.betaOverride = opts.betaOverride;
        if (opts?.normalizeScores !== undefined)
            this.normalizeScores = opts.normalizeScores;
    }
    // ─── Tokenization ────────────────────────────────────────────────────────
    _tokenize(text) {
        if (!text)
            return [];
        const lower = text.toLowerCase();
        const matches = lower.match(/[a-z0-9_]+/g) ?? [];
        return matches.filter((t) => t.length > 1 || t === "a" || t === "i");
    }
    // ─── Core math primitives ───────────────────────────────────────────────
    static _sigmoid(x) {
        if (x >= 500)
            return 1.0;
        if (x <= -500)
            return 0.0;
        return 1 / (1 + Math.exp(-x));
    }
    static _shannonEntropy(probabilities) {
        let h = 0;
        for (const p of probabilities) {
            if (0 < p && p < 1)
                h -= p * Math.log(p);
        }
        return h;
    }
    _computeAlpha() {
        if (this.alphaOverride !== undefined)
            return this.alphaOverride;
        return Math.max(0.5, Math.min(1.5, this._avgDocLength / 100));
    }
    _computeBeta() {
        if (this.betaOverride !== undefined)
            return this.betaOverride;
        if (this._totalDocs <= 0)
            return 0.0;
        return 1 / Math.log(1 + this._totalDocs);
    }
    // ─── Entropy computation ─────────────────────────────────────────────────
    _computeTermEntropies(terms) {
        const targetTerms = terms ?? new Set(this._docFreqs.keys());
        for (const term of targetTerms) {
            const docFreq = this._docFreqs.get(term) ?? 0;
            if (docFreq <= 1) {
                this._termEntropy.set(term, 0.0);
                continue;
            }
            const tfMap = this._postingListTFs.get(term);
            const totalTf = this._termTotalFreqs.get(term) ?? 0;
            if (!tfMap || totalTf <= 0) {
                this._termEntropy.set(term, 0.0);
                continue;
            }
            const probs = [...tfMap.values()].map((tf) => tf / totalTf);
            const rawEntropy = BMXIndex._shannonEntropy(probs);
            const maxEntropy = Math.log(docFreq);
            this._termEntropy.set(term, maxEntropy > 0 ? rawEntropy / maxEntropy : 0.0);
        }
    }
    _flushDirtyEntropies(queryTerms) {
        if (this._dirtyTerms.size === 0)
            return;
        const toFlush = queryTerms ? new Set([...this._dirtyTerms].filter((t) => queryTerms.has(t))) : new Set(this._dirtyTerms);
        if (toFlush.size > 0) {
            this._computeTermEntropies(toFlush);
            for (const t of toFlush)
                this._dirtyTerms.delete(t);
        }
    }
    _getNormalizedEntropy(queryTokens) {
        const uniqueTokens = [...new Set(queryTokens)];
        const rawInfo = new Map();
        for (const t of uniqueTokens) {
            rawInfo.set(t, 1.0 - (this._termEntropy.get(t) ?? 1.0));
        }
        const maxInfo = Math.max(...rawInfo.values(), 0);
        if (maxInfo === 0)
            return new Map(uniqueTokens.map((t) => [t, 0.0]));
        return new Map([...rawInfo.entries()].map(([t, i]) => [t, i / maxInfo]));
    }
    _resetIndexState() {
        this._documents.clear();
        this._docLengths.clear();
        this._docFreqs.clear();
        this._idfCache.clear();
        this._totalDocs = 0;
        this._avgDocLength = 0.0;
        this._alpha = 1.0;
        this._beta = 0.01;
        this._isBuilt = false;
        this._termEntropy.clear();
        this._termTotalFreqs.clear();
        this._postingListTFs.clear();
        this._invertedIndex.clear();
        this._dirtyTerms.clear();
        this._fieldIndexes.clear();
        this._fieldWeights.clear();
    }
    // ─── Index building ──────────────────────────────────────────────────────
    buildIndex(chunks) {
        this._resetIndexState();
        if (chunks.length === 0) {
            this._isBuilt = true;
            return;
        }
        let totalLength = 0;
        // Pass 1: tokenize, compute doc lengths
        for (const chunk of chunks) {
            const chunkId = chunk.chunk_id;
            if (!chunkId)
                continue;
            const tokens = this._tokenize(chunk.text ?? "");
            this._documents.set(chunkId, tokens);
            this._docLengths.set(chunkId, tokens.length);
            totalLength += tokens.length;
        }
        this._totalDocs = this._documents.size;
        if (this._totalDocs === 0) {
            this._isBuilt = true;
            return;
        }
        this._avgDocLength = totalLength / this._totalDocs;
        // Pass 2: document frequencies + posting list TFs + inverted index + total freqs
        for (const [chunkId, tokens] of this._documents.entries()) {
            const termCounts = new Map();
            for (const t of tokens)
                termCounts.set(t, (termCounts.get(t) ?? 0) + 1);
            for (const [term, count] of termCounts) {
                this._docFreqs.set(term, (this._docFreqs.get(term) ?? 0) + 1);
                this._termTotalFreqs.set(term, (this._termTotalFreqs.get(term) ?? 0) + count);
                if (!this._postingListTFs.has(term))
                    this._postingListTFs.set(term, new Map());
                this._postingListTFs.get(term).set(chunkId, count);
                if (!this._invertedIndex.has(term))
                    this._invertedIndex.set(term, new Set());
                this._invertedIndex.get(term).add(chunkId);
            }
        }
        // Precompute IDF (Lucene variant)
        for (const [term, df] of this._docFreqs) {
            this._idfCache.set(term, Math.log(((this._totalDocs - df + 0.5) / (df + 0.5)) + 1.0));
        }
        // Precompute term entropies (full build)
        this._computeTermEntropies();
        // Compute dynamic parameters
        this._alpha = this._computeAlpha();
        this._beta = this._computeBeta();
        this._isBuilt = true;
    }
    // ─── Search ─────────────────────────────────────────────────────────────
    search(query, topK = 30, normalize) {
        if (!this._isBuilt)
            return [];
        if (!query)
            return [];
        const queryTokens = this._tokenize(query);
        if (queryTokens.length === 0)
            return [];
        const uniqueQuery = new Set(queryTokens);
        const m = queryTokens.length;
        this._flushDirtyEntropies(uniqueQuery);
        const normEntropy = this._getNormalizedEntropy(queryTokens);
        const eBar = queryTokens.reduce((acc, t) => acc + (normEntropy.get(t) ?? 0), 0) / m;
        const doNormalize = normalize ?? this.normalizeScores;
        // Collect candidate documents
        const candidateIds = new Set();
        for (const token of uniqueQuery) {
            const posting = this._invertedIndex.get(token);
            if (posting)
                for (const id of posting)
                    candidateIds.add(id);
        }
        const scores = new Map();
        for (const chunkId of candidateIds) {
            const docTokens = this._documents.get(chunkId);
            const score = this._scoreDocument(chunkId, docTokens, uniqueQuery, queryTokens, normEntropy, eBar, m);
            if (score > 0)
                scores.set(chunkId, score);
        }
        if (doNormalize && scores.size > 0) {
            const scoreMax = this._computeScoreMax(m);
            if (scoreMax > 0) {
                for (const [cid, s] of scores)
                    scores.set(cid, s / scoreMax);
            }
        }
        return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK);
    }
    _scoreDocument(chunkId, docTokens, uniqueQuery, queryTokens, normEntropy, eBar, m) {
        const docLength = this._docLengths.get(chunkId) ?? 0;
        if (docLength === 0)
            return 0;
        const termFreqs = new Map();
        for (const t of docTokens)
            termFreqs.set(t, (termFreqs.get(t) ?? 0) + 1);
        const uniqueDoc = new Set(docTokens);
        const overlap = [...uniqueQuery].filter((t) => uniqueDoc.has(t)).length;
        const sQd = overlap / m;
        const lenRatio = this._avgDocLength > 0 ? docLength / this._avgDocLength : 1;
        const K = this._alpha * (lenRatio + eBar);
        let score = 0;
        for (const token of queryTokens) {
            const tf = termFreqs.get(token) ?? 0;
            if (tf === 0)
                continue;
            const idf = this._idfCache.get(token) ?? 0;
            if (idf <= 0) {
                const eQi = normEntropy.get(token) ?? 0;
                score += this._beta * eQi * sQd;
                continue;
            }
            const tfSat = BMXIndex._sigmoid(this._alpha * (tf - K / 2) / Math.max(K, 0.01));
            const tfComponent = idf * tfSat;
            const eQi = Math.max(normEntropy.get(token) ?? 0, 0.1);
            const entropyComponent = this._beta * eQi * sQd;
            score += tfComponent + entropyComponent;
        }
        return score;
    }
    _computeScoreMax(m) {
        if (this._totalDocs <= 0 || m <= 0)
            return 1.0;
        const maxIdf = Math.log(1 + (this._totalDocs - 0.5) / 1.5);
        return m * (maxIdf + this._beta);
    }
    // ─── Incremental updates ───────────────────────────────────────────────
    updateIndex(chunkId, text) {
        this.removeFromIndex(chunkId);
        const tokens = this._tokenize(text);
        if (tokens.length === 0)
            return;
        this._documents.set(chunkId, tokens);
        this._docLengths.set(chunkId, tokens.length);
        this._totalDocs++;
        const totalLength = [...this._docLengths.values()].reduce((a, b) => a + b, 0);
        this._avgDocLength = totalLength / this._totalDocs;
        const termCounts = new Map();
        for (const t of tokens)
            termCounts.set(t, (termCounts.get(t) ?? 0) + 1);
        const affectedTerms = new Set();
        for (const [term, count] of termCounts) {
            this._docFreqs.set(term, (this._docFreqs.get(term) ?? 0) + 1);
            this._termTotalFreqs.set(term, (this._termTotalFreqs.get(term) ?? 0) + count);
            if (!this._postingListTFs.has(term))
                this._postingListTFs.set(term, new Map());
            this._postingListTFs.get(term).set(chunkId, count);
            if (!this._invertedIndex.has(term))
                this._invertedIndex.set(term, new Set());
            this._invertedIndex.get(term).add(chunkId);
            affectedTerms.add(term);
        }
        for (const term of affectedTerms) {
            const df = this._docFreqs.get(term);
            this._idfCache.set(term, Math.log(((this._totalDocs - df + 0.5) / (df + 0.5)) + 1.0));
        }
        for (const t of affectedTerms)
            this._dirtyTerms.add(t);
        this._alpha = this._computeAlpha();
        this._beta = this._computeBeta();
        this._isBuilt = true;
    }
    removeFromIndex(chunkId) {
        if (!this._documents.has(chunkId))
            return false;
        const tokens = this._documents.get(chunkId);
        const termCounts = new Map();
        for (const t of tokens)
            termCounts.set(t, (termCounts.get(t) ?? 0) + 1);
        this._documents.delete(chunkId);
        this._docLengths.delete(chunkId);
        this._totalDocs--;
        const totalLength = [...this._docLengths.values()].reduce((a, b) => a + b, 0);
        this._avgDocLength = this._totalDocs > 0 ? totalLength / this._totalDocs : 0;
        const affectedTerms = new Set();
        for (const [term, count] of termCounts) {
            this._docFreqs.set(term, (this._docFreqs.get(term) ?? 0) - 1);
            this._termTotalFreqs.set(term, (this._termTotalFreqs.get(term) ?? 0) - count);
            const tfMap = this._postingListTFs.get(term);
            if (tfMap) {
                tfMap.delete(chunkId);
                if (tfMap.size === 0)
                    this._postingListTFs.delete(term);
            }
            const invIdx = this._invertedIndex.get(term);
            if (invIdx) {
                invIdx.delete(chunkId);
                if (invIdx.size === 0)
                    this._invertedIndex.delete(term);
            }
            const df = this._docFreqs.get(term);
            if (df <= 0) {
                this._docFreqs.delete(term);
                this._idfCache.delete(term);
                this._termEntropy.delete(term);
                this._postingListTFs.delete(term);
                this._invertedIndex.delete(term);
                this._termTotalFreqs.delete(term);
            }
            else {
                affectedTerms.add(term);
            }
        }
        for (const term of affectedTerms) {
            const df = this._docFreqs.get(term);
            this._idfCache.set(term, Math.log(((this._totalDocs - df + 0.5) / (df + 0.5)) + 1.0));
        }
        for (const t of affectedTerms)
            this._dirtyTerms.add(t);
        this._alpha = this._computeAlpha();
        this._beta = this._computeBeta();
        return true;
    }
    // ─── Diagnostics ─────────────────────────────────────────────────────────
    getIndexStats() {
        const entropies = [...this._termEntropy.values()];
        return {
            totalDocuments: this._totalDocs,
            uniqueTerms: this._docFreqs.size,
            avgDocLength: this._avgDocLength,
            isBuilt: this._isBuilt,
            alpha: this._alpha,
            beta: this._beta,
            alphaOverride: this.alphaOverride,
            betaOverride: this.betaOverride,
            normalizeScores: this.normalizeScores,
            avgEntropy: entropies.length > 0 ? entropies.reduce((a, b) => a + b, 0) / entropies.length : 0,
        };
    }
    clear() {
        this._resetIndexState();
        this._fieldIndexes.clear();
        this._fieldWeights.clear();
    }
    // ─── BMXF field-weighted wrapper ───────────────────────────────────────
    buildFieldIndex(toolDocs) {
        this._fieldIndexes.clear();
        this._fieldWeights = new Map([
            ["toolName", 3.0],
            ["namespace", 2.5],
            ["retrievalAliases", 1.5],
            ["description", 1.0],
            ["parameterNames", 0.5],
        ]);
        for (const fieldName of this._fieldWeights.keys()) {
            const fieldIdx = new BMXIndex({
                alphaOverride: this.alphaOverride,
                betaOverride: this.betaOverride,
                normalizeScores: this.normalizeScores,
            });
            const chunks = toolDocs.map((doc) => {
                const text = doc[fieldName] ?? "";
                return { chunk_id: doc.toolKey, text };
            });
            fieldIdx.buildIndex(chunks);
            this._fieldIndexes.set(fieldName, fieldIdx);
        }
    }
    searchFields(query, topK = 30) {
        if (this._fieldIndexes.size === 0)
            return [];
        const combined = new Map();
        for (const [fieldName, weight] of this._fieldWeights) {
            const fieldIdx = this._fieldIndexes.get(fieldName);
            if (!fieldIdx)
                continue;
            const results = fieldIdx.search(query, topK * 2);
            for (const [chunkId, score] of results) {
                combined.set(chunkId, (combined.get(chunkId) ?? 0) + weight * score);
            }
        }
        return [...combined.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK);
    }
}
//# sourceMappingURL=bmx-index.js.map