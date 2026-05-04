/**
 * Tests for dist/lib.js utilities
 * Covers: formatSize, normalizeLineEndings, countOccurrences
 *
 * These tests correspond to utilities originally backed up in
 * .js-backup/core/* files that were removed in this PR.
 */

import { describe, it, expect } from 'vitest';
import {
    formatSize,
    normalizeLineEndings,
    countOccurrences,
} from '../lib.js';

describe('normalizeLineEndings', () => {
    it('should convert CRLF to LF', () => {
        expect(normalizeLineEndings('line1\r\nline2')).toBe('line1\nline2');
    });

    it('should leave LF unchanged', () => {
        expect(normalizeLineEndings('line1\nline2')).toBe('line1\nline2');
    });

    it('should convert multiple CRLF to LF', () => {
        expect(normalizeLineEndings('a\r\nb\r\nc')).toBe('a\nb\nc');
    });

    it('should return empty string unchanged', () => {
        expect(normalizeLineEndings('')).toBe('');
    });

    it('should not modify text without line endings', () => {
        expect(normalizeLineEndings('no newlines here')).toBe('no newlines here');
    });

    it('should handle mixed line endings', () => {
        expect(normalizeLineEndings('a\r\nb\nc')).toBe('a\nb\nc');
    });

    it('should handle Windows-style line endings at end of string', () => {
        expect(normalizeLineEndings('hello\r\n')).toBe('hello\n');
    });

    it('should handle only CRLF', () => {
        expect(normalizeLineEndings('\r\n')).toBe('\n');
    });

    it('should handle lone CR (not converted — only CRLF pairs)', () => {
        expect(normalizeLineEndings('line1\rline2')).toBe('line1\rline2');
    });
});

describe('formatSize', () => {
    it('should return "0 B" for zero bytes', () => {
        expect(formatSize(0)).toBe('0 B');
    });

    it('should format bytes correctly', () => {
        expect(formatSize(100)).toBe('100 B');
        expect(formatSize(999)).toBe('999 B');
        expect(formatSize(1)).toBe('1 B');
    });

    it('should format kilobytes correctly', () => {
        expect(formatSize(1024)).toBe('1.00 KB');
        expect(formatSize(2048)).toBe('2.00 KB');
        expect(formatSize(1536)).toBe('1.50 KB');
    });

    it('should format megabytes correctly', () => {
        expect(formatSize(1024 * 1024)).toBe('1.00 MB');
        expect(formatSize(2 * 1024 * 1024)).toBe('2.00 MB');
    });

    it('should format gigabytes correctly', () => {
        expect(formatSize(1024 * 1024 * 1024)).toBe('1.00 GB');
    });

    it('should format terabytes correctly', () => {
        expect(formatSize(1024 * 1024 * 1024 * 1024)).toBe('1.00 TB');
    });

    it('should return a string', () => {
        expect(typeof formatSize(1024)).toBe('string');
    });

    it('should handle non-round kilobyte values', () => {
        const result = formatSize(1500);
        expect(result).toMatch(/KB/);
    });
});

describe('countOccurrences', () => {
    it('should count exact matches', () => {
        expect(countOccurrences('hello hello hello', 'hello')).toBe(3);
    });

    it('should return 0 when no match', () => {
        expect(countOccurrences('hello world', 'nothere')).toBe(0);
    });

    it('should count single occurrence', () => {
        expect(countOccurrences('only once', 'once')).toBe(1);
    });

    it('should handle overlapping patterns correctly (non-overlapping search)', () => {
        // "aaa" has 1 non-overlapping "aa" (advances past each match)
        expect(countOccurrences('aaa', 'aa')).toBe(1);
    });

    it('should handle empty search string', () => {
        // indexOf with empty string matches every position, but this is edge case
        // Just ensure it doesn't throw
        expect(() => countOccurrences('hello', '')).not.toThrow();
    });

    it('should handle empty text', () => {
        expect(countOccurrences('', 'hello')).toBe(0);
    });

    it('should normalize CRLF before counting', () => {
        // The function normalizes line endings, so CRLF matches LF search
        expect(countOccurrences('a\r\nb\r\nc', '\n')).toBe(2);
    });

    it('should count multiline matches', () => {
        const text = 'function foo() {\n}\nfunction foo() {\n}';
        expect(countOccurrences(text, 'function foo()')).toBe(2);
    });

    it('should be case-sensitive', () => {
        expect(countOccurrences('Hello hello HELLO', 'hello')).toBe(1);
    });

    it('should count consecutive non-overlapping occurrences', () => {
        expect(countOccurrences('ababab', 'ab')).toBe(3);
    });
});