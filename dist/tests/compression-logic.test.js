/**
 * Tests for compression budget and truncation logic
 * originally contained in .js-backup/core/compression.js (deleted in this PR).
 *
 * These functions were pure computation helpers — no I/O — deleted along
 * with the .js-backup directory. This test file verifies the algorithm
 * behaviour so the logic can be safely re-introduced or replaced.
 *
 * Functions under test (re-implemented inline as reference):
 *   - computeCompressionBudget(rawLength, maxChars, keepRatio)
 *   - isCompressionUseful(rawText, compressedText, maxChars, keepRatio)
 *   - truncateToBudget(text, budget)
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Reference implementations of the deleted pure functions
// (exact logic as they appeared in .js-backup/core/compression.js)
// ---------------------------------------------------------------------------

const DEFAULT_COMPRESSION_KEEP_RATIO = 0.70;

function computeCompressionBudget(rawLength, maxChars, keepRatio = DEFAULT_COMPRESSION_KEEP_RATIO) {
    if (!Number.isFinite(rawLength) || rawLength <= 0) return 0;
    const boundedMaxChars = Math.max(0, Math.floor(maxChars));
    const ratioBudget = Math.max(1, Math.floor(rawLength * keepRatio));
    return Math.min(boundedMaxChars, ratioBudget);
}

function isCompressionUseful(rawText, compressedText, maxChars, keepRatio = DEFAULT_COMPRESSION_KEEP_RATIO) {
    if (typeof rawText !== 'string' || typeof compressedText !== 'string') return false;
    if (compressedText.length === 0 || rawText.length === 0) return false;

    const targetBudget = computeCompressionBudget(rawText.length, maxChars, keepRatio);
    if (targetBudget <= 0 || targetBudget >= rawText.length) return false;

    return compressedText.length < rawText.length && compressedText.length <= targetBudget;
}

function truncateToBudget(text, budget) {
    if (typeof text !== 'string') {
        return { text: '', truncated: false };
    }

    if (text.length <= budget) {
        return { text, truncated: false };
    }

    let cutoff = text.lastIndexOf('\n', budget);
    if (cutoff === -1) cutoff = budget;

    return {
        text: text.slice(0, cutoff),
        truncated: true,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeCompressionBudget', () => {
    it('should return 0 for non-finite rawLength', () => {
        expect(computeCompressionBudget(NaN, 1000)).toBe(0);
        expect(computeCompressionBudget(Infinity, 1000)).toBe(0);
        expect(computeCompressionBudget(-Infinity, 1000)).toBe(0);
    });

    it('should return 0 for rawLength <= 0', () => {
        expect(computeCompressionBudget(0, 1000)).toBe(0);
        expect(computeCompressionBudget(-1, 1000)).toBe(0);
    });

    it('should return ratioBudget when it is less than maxChars', () => {
        // rawLength=1000, keepRatio=0.70 → ratioBudget=700; maxChars=1000 → min(1000, 700)=700
        expect(computeCompressionBudget(1000, 1000, 0.70)).toBe(700);
    });

    it('should return maxChars when it is less than ratioBudget', () => {
        // rawLength=10000, keepRatio=0.70 → ratioBudget=7000; maxChars=500 → min(500, 7000)=500
        expect(computeCompressionBudget(10000, 500, 0.70)).toBe(500);
    });

    it('should use default keepRatio of 0.70', () => {
        const result = computeCompressionBudget(100, 200);
        // ratioBudget = floor(100 * 0.70) = 70; maxChars = 200 → 70
        expect(result).toBe(70);
    });

    it('should floor the ratioBudget', () => {
        // rawLength=100, keepRatio=0.15 → ratioBudget=floor(15)=15; maxChars=100 → 15
        expect(computeCompressionBudget(100, 100, 0.15)).toBe(15);
    });

    it('should clamp ratioBudget to minimum 1', () => {
        // rawLength=1, keepRatio=0.01 → ratioBudget=max(1, floor(0.01))=max(1,0)=1; maxChars=100 → 1
        expect(computeCompressionBudget(1, 100, 0.01)).toBe(1);
    });

    it('should clamp maxChars floor to 0', () => {
        // maxChars=-5 → boundedMaxChars=0; ratioBudget=70; min(0, 70)=0
        expect(computeCompressionBudget(100, -5, 0.70)).toBe(0);
    });

    it('should handle small text that fits in budget', () => {
        // rawLength=10, keepRatio=0.70 → ratioBudget=7; maxChars=50 → 7
        expect(computeCompressionBudget(10, 50, 0.70)).toBe(7);
    });

    it('should handle exact boundary: ratioBudget equals maxChars', () => {
        // rawLength=1000, keepRatio=0.5 → ratioBudget=500; maxChars=500 → 500
        expect(computeCompressionBudget(1000, 500, 0.5)).toBe(500);
    });

    it('should handle very high keepRatio', () => {
        // rawLength=1000, keepRatio=0.99 → ratioBudget=990; maxChars=1000 → 990
        expect(computeCompressionBudget(1000, 1000, 0.99)).toBe(990);
    });
});

describe('isCompressionUseful', () => {
    it('should return false for non-string inputs', () => {
        expect(isCompressionUseful(null, 'compressed', 1000)).toBe(false);
        expect(isCompressionUseful('raw', null, 1000)).toBe(false);
        expect(isCompressionUseful(123, 'compressed', 1000)).toBe(false);
    });

    it('should return false when either text is empty', () => {
        expect(isCompressionUseful('', 'compressed', 1000)).toBe(false);
        expect(isCompressionUseful('rawtext', '', 1000)).toBe(false);
    });

    it('should return true when compression is smaller and fits budget', () => {
        const rawText = 'a'.repeat(1000);
        const compressedText = 'a'.repeat(600);  // smaller than raw (1000), within budget (700)
        expect(isCompressionUseful(rawText, compressedText, 1000)).toBe(true);
    });

    it('should return false when compressed text is not smaller than raw', () => {
        const rawText = 'short';
        const compressedText = 'short-and-same';  // NOT smaller
        expect(isCompressionUseful(rawText, compressedText, 1000)).toBe(false);
    });

    it('should return false when compressed text exceeds target budget', () => {
        const rawText = 'a'.repeat(1000);
        const compressedText = 'a'.repeat(800);  // smaller than raw but exceeds budget (700)
        expect(isCompressionUseful(rawText, compressedText, 1000)).toBe(false);
    });

    it('should return false when targetBudget is 0', () => {
        const rawText = 'a'.repeat(1000);
        const compressedText = 'a'.repeat(500);
        // maxChars=0 → targetBudget=0 → false
        expect(isCompressionUseful(rawText, compressedText, 0)).toBe(false);
    });

    it('should return false when targetBudget >= rawText.length', () => {
        const rawText = 'hello';  // length 5
        const compressedText = 'he';
        // rawLength=5, keepRatio=0.70 → ratioBudget=3; maxChars=10 → targetBudget=3
        // BUT targetBudget(3) < rawText.length(5) so it IS less... test when budget >= rawLength
        const bigText = 'small';  // length 5
        // maxChars=1000, keepRatio=1.0 → ratioBudget=5=rawLength → targetBudget>=rawLength → false
        expect(isCompressionUseful(bigText, 'sma', 1000, 1.0)).toBe(false);
    });

    it('should use default keepRatio of 0.70', () => {
        const rawText = 'x'.repeat(100);
        // targetBudget = min(maxChars=200, floor(100*0.70)=70) = 70
        const compressedText = 'x'.repeat(50);  // 50 < 100 (raw) AND 50 <= 70 (budget) → true
        expect(isCompressionUseful(rawText, compressedText, 200)).toBe(true);
    });

    it('should return false when compressed text exactly equals budget boundary (edge)', () => {
        const rawText = 'x'.repeat(1000);
        // budget=700 (default keepRatio), compressed=700 (not < raw? no, 700 < 1000)
        // compressed.length <= targetBudget → 700 <= 700 → true, AND 700 < 1000 → true
        const compressedText = 'x'.repeat(700);
        expect(isCompressionUseful(rawText, compressedText, 1000)).toBe(true);
    });

    it('should return false when compressed text length equals raw text length', () => {
        const rawText = 'sametext';
        const compressedText = 'sametext';
        expect(isCompressionUseful(rawText, compressedText, 1000)).toBe(false);
    });
});

describe('truncateToBudget', () => {
    it('should return the original text without truncation when within budget', () => {
        const result = truncateToBudget('hello world', 100);
        expect(result).toEqual({ text: 'hello world', truncated: false });
    });

    it('should return the original text when exactly at budget', () => {
        const result = truncateToBudget('hello', 5);
        expect(result).toEqual({ text: 'hello', truncated: false });
    });

    it('should truncate at the last newline before budget when over budget', () => {
        const text = 'line1\nline2\nline3';
        // budget=11 — last \n before position 11 is at index 5 (after 'line1')
        const result = truncateToBudget(text, 11);
        expect(result.truncated).toBe(true);
        expect(result.text).toBe('line1');
    });

    it('should truncate at budget when no newline found before budget', () => {
        const text = 'verylonglinewithoutnewlines';
        const result = truncateToBudget(text, 10);
        expect(result.truncated).toBe(true);
        expect(result.text).toBe('verylongli');
        expect(result.text.length).toBe(10);
    });

    it('should return empty text for non-string input', () => {
        expect(truncateToBudget(null, 10)).toEqual({ text: '', truncated: false });
        expect(truncateToBudget(undefined, 10)).toEqual({ text: '', truncated: false });
        expect(truncateToBudget(123, 10)).toEqual({ text: '', truncated: false });
    });

    it('should return empty text without truncation for empty string', () => {
        const result = truncateToBudget('', 10);
        expect(result).toEqual({ text: '', truncated: false });
    });

    it('should prefer line boundaries over hard cuts', () => {
        const text = 'first line\nsecond line\nthird line';
        // budget=25 — the newline at index 21 (before 'third') is before 25
        const result = truncateToBudget(text, 25);
        expect(result.truncated).toBe(true);
        // Should cut at last \n before position 25
        expect(result.text).toBe('first line\nsecond line');
    });

    it('should handle text with only one newline', () => {
        const text = 'hello\nworld';
        const result = truncateToBudget(text, 8);
        expect(result.truncated).toBe(true);
        // last \n before position 8 is at index 5
        expect(result.text).toBe('hello');
    });

    it('should handle budget of 0', () => {
        const result = truncateToBudget('hello', 0);
        // text.length (5) > budget (0) → truncate
        // lastIndexOf('\n', 0) returns -1 → cutoff=0
        expect(result.truncated).toBe(true);
        expect(result.text).toBe('');
    });

    it('should handle multiline text with newlines at various positions', () => {
        const lines = ['aaa', 'bbb', 'ccc', 'ddd'];
        const text = lines.join('\n');  // 'aaa\nbbb\nccc\nddd' length=15
        const result = truncateToBudget(text, 10);
        expect(result.truncated).toBe(true);
        // lastIndexOf('\n', 10) → position 7 (before 'ccc')
        expect(result.text).toBe('aaa\nbbb');
    });
});