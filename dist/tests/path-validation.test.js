/**
 * Tests for dist/path-validation.js
 * Covers: normalizePath, expandHome, isPathWithinAllowedDirectories
 *
 * These tests correspond to path validation utilities originally backed up in
 * .js-backup/core/* files that were removed in this PR.
 */

import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import { normalizePath, expandHome, isPathWithinAllowedDirectories } from '../path-validation.js';

describe('normalizePath (path-validation)', () => {
    it('should return non-string inputs unchanged', () => {
        expect(normalizePath(null)).toBeNull();
        expect(normalizePath(undefined)).toBeUndefined();
        expect(normalizePath('')).toBe('');
    });

    it('should strip surrounding double quotes', () => {
        expect(normalizePath('"/home/user"')).toBe('/home/user');
    });

    it('should strip surrounding single quotes', () => {
        expect(normalizePath("'/home/user'")).toBe('/home/user');
    });

    it('should trim leading/trailing whitespace', () => {
        expect(normalizePath('  /home/user  ')).toBe('/home/user');
    });

    it('should throw for paths with null bytes', () => {
        expect(() => normalizePath('/home/user\x00/malicious')).toThrow('null bytes');
    });

    it('should expand ~ to home directory', () => {
        const result = normalizePath('~/projects');
        expect(result).toBe(path.normalize(path.join(os.homedir(), '/projects')));
    });

    it('should resolve . and .. segments', () => {
        const result = normalizePath('/home/user/./projects/../docs');
        expect(result).toBe('/home/user/docs');
    });

    it('should remove trailing slash from non-root paths', () => {
        expect(normalizePath('/home/user/')).toBe('/home/user');
    });

    it('should preserve root slash', () => {
        expect(normalizePath('/')).toBe('/');
    });

    it('should normalize a normal absolute path', () => {
        expect(normalizePath('/home/user/projects')).toBe('/home/user/projects');
    });

    it('should handle double slashes', () => {
        const result = normalizePath('/home//user//docs');
        // path.normalize collapses double slashes
        expect(result).toBe('/home/user/docs');
    });
});

describe('expandHome (path-validation)', () => {
    it('should expand tilde to home directory', () => {
        const result = expandHome('~/projects');
        expect(result).toBe(path.join(os.homedir(), '/projects'));
    });

    it('should expand bare tilde to home directory', () => {
        const result = expandHome('~');
        expect(result).toBe(path.join(os.homedir(), ''));
    });

    it('should not modify paths not starting with ~/', () => {
        expect(expandHome('/home/user/projects')).toBe('/home/user/projects');
        expect(expandHome('/usr/local')).toBe('/usr/local');
    });

    it('should not modify relative paths', () => {
        expect(expandHome('relative/path')).toBe('relative/path');
    });

    it('should not expand ~ in the middle of a path', () => {
        expect(expandHome('/some/~/path')).toBe('/some/~/path');
    });
});

describe('isPathWithinAllowedDirectories', () => {
    const homeDir = os.homedir();
    const allowedDirs = ['/home/user/projects', '/tmp/safe'];

    it('should return true for a path that is within an allowed directory', () => {
        expect(isPathWithinAllowedDirectories('/home/user/projects/app.js', allowedDirs)).toBe(true);
    });

    it('should return true for a path that exactly matches an allowed directory', () => {
        expect(isPathWithinAllowedDirectories('/home/user/projects', allowedDirs)).toBe(true);
    });

    it('should return false for a path outside all allowed directories', () => {
        expect(isPathWithinAllowedDirectories('/home/other/secret.txt', allowedDirs)).toBe(false);
    });

    it('should return false for empty allowed directories', () => {
        expect(isPathWithinAllowedDirectories('/home/user/projects/app.js', [])).toBe(false);
    });

    it('should return true for deeply nested paths within allowed dir', () => {
        expect(isPathWithinAllowedDirectories('/home/user/projects/src/utils/helper.js', allowedDirs)).toBe(true);
    });

    it('should not allow partial prefix matches (e.g. /home/user/projects2)', () => {
        // /home/user/projects2 should NOT be inside /home/user/projects
        expect(isPathWithinAllowedDirectories('/home/user/projects2/file.js', allowedDirs)).toBe(false);
    });

    it('should handle multiple allowed directories', () => {
        expect(isPathWithinAllowedDirectories('/tmp/safe/tempfile.txt', allowedDirs)).toBe(true);
        expect(isPathWithinAllowedDirectories('/tmp/unsafe/file.txt', allowedDirs)).toBe(false);
    });

    it('should return true when path is inside the second allowed directory', () => {
        expect(isPathWithinAllowedDirectories('/tmp/safe/subdir/file.txt', allowedDirs)).toBe(true);
    });
});