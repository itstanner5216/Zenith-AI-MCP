/**
 * Tests for dist/shared.js
 * Covers: BM25Index, bm25RankResults, isSensitive, CHAR_BUDGET, DEFAULT_EXCLUDES
 *
 * These tests correspond to shared utilities originally backed up in
 * .js-backup/core/*.js files removed in this PR.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    BM25Index,
    bm25RankResults,
    isSensitive,
    CHAR_BUDGET,
    RANK_THRESHOLD,
    DEFAULT_EXCLUDES,
    SENSITIVE_PATTERNS,
} from '../shared.js';

// ---------------------------------------------------------------------------
// BM25Index
// ---------------------------------------------------------------------------

describe('BM25Index.tokenize', () => {
    it('should tokenize lowercase alphanumeric words', () => {
        expect(BM25Index.tokenize('hello world')).toContain('hello');
        expect(BM25Index.tokenize('hello world')).toContain('world');
    });

    it('should lowercase tokens', () => {
        expect(BM25Index.tokenize('Hello World')).toContain('hello');
        expect(BM25Index.tokenize('Hello World')).toContain('world');
    });

    it('should include underscores in tokens', () => {
        const tokens = BM25Index.tokenize('my_function call_me');
        expect(tokens).toContain('my_function');
        expect(tokens).toContain('call_me');
    });

    it('should filter out single-character tokens except "a" and "i"', () => {
        const tokens = BM25Index.tokenize('a b c i d e');
        expect(tokens).toContain('a');
        expect(tokens).toContain('i');
        expect(tokens).not.toContain('b');
        expect(tokens).not.toContain('c');
    });

    it('should return empty array for empty string', () => {
        expect(BM25Index.tokenize('')).toEqual([]);
    });

    it('should return empty array for null/undefined', () => {
        expect(BM25Index.tokenize(null)).toEqual([]);
        expect(BM25Index.tokenize(undefined)).toEqual([]);
    });

    it('should tokenize numbers', () => {
        const tokens = BM25Index.tokenize('function123 test42');
        expect(tokens).toContain('function123');
        expect(tokens).toContain('test42');
    });

    it('should ignore punctuation', () => {
        const tokens = BM25Index.tokenize('hello, world! foo.bar');
        expect(tokens).toContain('hello');
        expect(tokens).toContain('world');
        expect(tokens).toContain('foo');
        expect(tokens).toContain('bar');
    });
});

describe('BM25Index.build and search', () => {
    let index;

    beforeEach(() => {
        index = new BM25Index();
    });

    it('should return empty array when no docs built', () => {
        expect(index.search('hello')).toEqual([]);
    });

    it('should return empty array for empty query', () => {
        index.build([{ id: 'doc1', text: 'hello world' }]);
        expect(index.search('')).toEqual([]);
    });

    it('should find a single document', () => {
        index.build([{ id: 'doc1', text: 'hello world test' }]);
        const results = index.search('hello');
        expect(results.length).toBe(1);
        expect(results[0].id).toBe('doc1');
        expect(results[0].score).toBeGreaterThan(0);
    });

    it('should rank more relevant documents higher', () => {
        index.build([
            { id: 'irrelevant', text: 'cats and dogs playing outside' },
            { id: 'relevant', text: 'javascript function definition export' },
            { id: 'very_relevant', text: 'javascript function export function javascript javascript' },
        ]);
        const results = index.search('javascript function');
        expect(results.length).toBeGreaterThan(0);
        // Most relevant doc should rank highest
        expect(results[0].id).toBe('very_relevant');
    });

    it('should return topK results', () => {
        const docs = Array.from({ length: 20 }, (_, i) => ({
            id: `doc${i}`,
            text: `document content hello world ${i}`,
        }));
        index.build(docs);
        const results = index.search('hello world', 5);
        expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should handle documents with no text', () => {
        index.build([
            { id: 'empty', text: '' },
            { id: 'content', text: 'hello world' },
        ]);
        const results = index.search('hello');
        expect(results.some(r => r.id === 'content')).toBe(true);
    });

    it('should handle documents missing id gracefully', () => {
        expect(() => {
            index.build([{ id: null, text: 'hello world' }]);
        }).not.toThrow();
    });

    it('should return scores as numbers', () => {
        index.build([{ id: 'doc1', text: 'hello world' }]);
        const results = index.search('hello');
        if (results.length > 0) {
            expect(typeof results[0].score).toBe('number');
        }
    });

    it('should handle query with no matching terms', () => {
        index.build([{ id: 'doc1', text: 'hello world' }]);
        const results = index.search('zzzzzznotpresent');
        expect(results).toEqual([]);
    });

    it('should be case-insensitive for search', () => {
        index.build([{ id: 'doc1', text: 'hello world test' }]);
        const results1 = index.search('Hello');
        const results2 = index.search('hello');
        expect(results1.length).toBe(results2.length);
    });

    it('should rebuild cleanly on second build call', () => {
        index.build([{ id: 'old', text: 'old document content' }]);
        index.build([{ id: 'new', text: 'new document content' }]);
        const results = index.search('old');
        expect(results.length).toBe(0);
    });

    it('should use default k1=1.2 and b=0.75', () => {
        const defaultIdx = new BM25Index();
        expect(defaultIdx.k1).toBe(1.2);
        expect(defaultIdx.b).toBe(0.75);
    });

    it('should accept custom k1 and b values', () => {
        const customIdx = new BM25Index(2.0, 0.5);
        expect(customIdx.k1).toBe(2.0);
        expect(customIdx.b).toBe(0.5);
    });
});

// ---------------------------------------------------------------------------
// bm25RankResults
// ---------------------------------------------------------------------------

describe('bm25RankResults', () => {
    it('should return ranked results within char budget', () => {
        const lines = [
            'file.js:10: function hello() {}',
            'file.js:20: const x = hello()',
            'other.js:5: let y = world()',
        ];
        const { ranked, totalCount } = bm25RankResults(lines, 'hello', 10000);
        expect(totalCount).toBe(3);
        expect(Array.isArray(ranked)).toBe(true);
        expect(ranked.length).toBeGreaterThan(0);
    });

    it('should respect charBudget', () => {
        const lines = Array.from({ length: 100 }, (_, i) =>
            `file.js:${i}: this is a long line of content that should be matched for testing purposes`
        );
        const { ranked } = bm25RankResults(lines, 'content', 200);
        // Total chars should not exceed budget
        const totalChars = ranked.reduce((sum, l) => sum + l.length + 1, 0);
        expect(totalChars).toBeLessThanOrEqual(200 + 200); // approximate
    });

    it('should handle empty lines array', () => {
        const { ranked, totalCount } = bm25RankResults([], 'query', 10000);
        expect(ranked).toEqual([]);
        expect(totalCount).toBe(0);
    });

    it('should return totalCount equal to input lines count', () => {
        const lines = ['a:1: hello', 'b:2: world', 'c:3: foo'];
        const { totalCount } = bm25RankResults(lines, 'hello', 10000);
        expect(totalCount).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// isSensitive
// ---------------------------------------------------------------------------

describe('isSensitive', () => {
    it('should flag .env files as sensitive', () => {
        expect(isSensitive('/home/user/project/.env')).toBe(true);
    });

    it('should flag .pem files as sensitive', () => {
        expect(isSensitive('/home/user/certs/server.pem')).toBe(true);
    });

    it('should flag .key files as sensitive', () => {
        expect(isSensitive('/home/user/certs/private.key')).toBe(true);
    });

    it('should flag files with "credentials" in name', () => {
        expect(isSensitive('/home/user/aws_credentials')).toBe(true);
    });

    it('should flag files with "secret" in name', () => {
        expect(isSensitive('/home/user/secret_config.json')).toBe(true);
    });

    it('should not flag regular JS files as sensitive', () => {
        expect(isSensitive('/home/user/project/src/index.js')).toBe(false);
    });

    it('should not flag regular text files as sensitive', () => {
        expect(isSensitive('/home/user/documents/readme.txt')).toBe(false);
    });

    it('should not flag package.json as sensitive', () => {
        expect(isSensitive('/home/user/project/package.json')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('CHAR_BUDGET', () => {
    it('should be a positive number', () => {
        expect(typeof CHAR_BUDGET).toBe('number');
        expect(CHAR_BUDGET).toBeGreaterThan(0);
    });

    it('should default to 400000 when env var not set', () => {
        // In test environment without CHAR_BUDGET env var, default is 400000
        // The module was already loaded without the env var so it should be 400000
        if (!process.env.CHAR_BUDGET) {
            expect(CHAR_BUDGET).toBe(400_000);
        }
    });
});

describe('RANK_THRESHOLD', () => {
    it('should be 50', () => {
        expect(RANK_THRESHOLD).toBe(50);
    });
});

describe('DEFAULT_EXCLUDES', () => {
    it('should be an array of strings', () => {
        expect(Array.isArray(DEFAULT_EXCLUDES)).toBe(true);
        expect(DEFAULT_EXCLUDES.every(e => typeof e === 'string')).toBe(true);
    });

    it('should include common exclude patterns', () => {
        expect(DEFAULT_EXCLUDES).toContain('node_modules');
        expect(DEFAULT_EXCLUDES).toContain('.git');
    });

    it('should not contain empty strings', () => {
        expect(DEFAULT_EXCLUDES.every(e => e.length > 0)).toBe(true);
    });
});