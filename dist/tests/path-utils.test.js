/**
 * Tests for dist/path-utils.js
 * Covers: normalizePath, expandHome, convertToWindowsPath
 *
 * These tests correspond to the path utilities originally present in
 * .js-backup/core/* files that were removed in this PR.
 */

import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import { normalizePath, expandHome, convertToWindowsPath } from '../path-utils.js';

describe('convertToWindowsPath', () => {
    it('should leave WSL paths unchanged', () => {
        expect(convertToWindowsPath('/mnt/c/Users/test')).toBe('/mnt/c/Users/test');
        expect(convertToWindowsPath('/mnt/d/Projects')).toBe('/mnt/d/Projects');
    });

    it('should leave standard Unix paths unchanged on non-Windows', () => {
        // On Linux (our platform), regular Unix paths are unchanged
        expect(convertToWindowsPath('/home/user/file.txt')).toBe('/home/user/file.txt');
    });

    it('should handle Windows drive-letter paths by ensuring backslashes', () => {
        expect(convertToWindowsPath('C:/Users/test')).toBe('C:\\Users\\test');
        expect(convertToWindowsPath('D:/Projects/file.js')).toBe('D:\\Projects\\file.js');
    });

    it('should return non-Windows paths unchanged', () => {
        expect(convertToWindowsPath('/usr/local/bin')).toBe('/usr/local/bin');
    });
});

describe('normalizePath', () => {
    it('should remove surrounding quotes', () => {
        expect(normalizePath('"  /home/user  "')).toBe('/home/user');
        expect(normalizePath("'/some/path'")).toBe('/some/path');
    });

    it('should trim surrounding whitespace', () => {
        expect(normalizePath('  /home/user  ')).toBe('/home/user');
    });

    it('should normalize double slashes to single slashes', () => {
        expect(normalizePath('/home//user//docs')).toBe('/home/user/docs');
    });

    it('should preserve WSL paths intact', () => {
        expect(normalizePath('/mnt/c/Users/test')).toBe('/mnt/c/Users/test');
        expect(normalizePath('/mnt/d/Projects/repo')).toBe('/mnt/d/Projects/repo');
    });

    it('should remove trailing slash from non-root paths', () => {
        const result = normalizePath('/home/user/');
        expect(result).toBe('/home/user');
    });

    it('should handle simple absolute paths on Linux', () => {
        expect(normalizePath('/home/user/documents')).toBe('/home/user/documents');
    });

    it('should handle empty string gracefully', () => {
        // Empty string after trim - path.normalize('') returns '.'
        const result = normalizePath('');
        expect(typeof result).toBe('string');
    });

    it('should handle paths with multiple leading slashes (non-UNC)', () => {
        const result = normalizePath('///home/user');
        expect(result).toBe('/home/user');
    });
});

describe('expandHome', () => {
    it('should expand tilde to home directory', () => {
        const result = expandHome('~/documents');
        expect(result).toBe(path.join(os.homedir(), '/documents'));
    });

    it('should expand bare tilde to home directory', () => {
        const result = expandHome('~');
        expect(result).toBe(path.join(os.homedir(), ''));
    });

    it('should leave paths without tilde unchanged', () => {
        expect(expandHome('/home/user/docs')).toBe('/home/user/docs');
        expect(expandHome('/usr/local/bin')).toBe('/usr/local/bin');
    });

    it('should leave relative paths without tilde unchanged', () => {
        expect(expandHome('relative/path')).toBe('relative/path');
        expect(expandHome('./current/dir')).toBe('./current/dir');
    });

    it('should not expand tilde in the middle of a path', () => {
        expect(expandHome('/home/user~/docs')).toBe('/home/user~/docs');
    });

    it('should expand ~/nested/deep/path correctly', () => {
        const result = expandHome('~/a/b/c/d');
        expect(result).toBe(path.join(os.homedir(), '/a/b/c/d'));
    });

    it('should return a string when given a string', () => {
        const result = expandHome('~/test');
        expect(typeof result).toBe('string');
    });
});