import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';

import {
    convertToWindowsPath,
    normalizePath,
    expandHome,
} from '../dist/core/path-utils.js';

describe('path-utils convertToWindowsPath', () => {
    const isWindows = process.platform === 'win32';

    it('preserves WSL paths unchanged (security: prevents format conversion)', () => {
        const wslPath = '/mnt/c/Users/test';
        expect(convertToWindowsPath(wslPath)).toBe(wslPath);
    });

    it('preserves WSL paths with deep directories unchanged', () => {
        const wslPath = '/mnt/d/projects/my-app/src/index.js';
        expect(convertToWindowsPath(wslPath)).toBe(wslPath);
    });

    it('converts Unix-style Windows paths on Windows platform', () => {
        if (!isWindows) return;
        const unixStylePath = '/c/Users/test';
        const result = convertToWindowsPath(unixStylePath);
        expect(result).toMatch(/^[A-Z]:/);
        expect(result).toContain('\\');
    });

    it('converts standard Windows paths to backslashes', () => {
        if (!isWindows) return;
        const windowsPath = 'C:/Users/test';
        const result = convertToWindowsPath(windowsPath);
        expect(result).toBe('C:\\Users\\test');
    });

    it('leaves Unix paths unchanged on Linux', () => {
        if (isWindows) return;
        const unixPath = '/home/user/file.txt';
        expect(convertToWindowsPath(unixPath)).toBe(unixPath);
    });

    it('handles paths starting with single letter followed by slash', () => {
        if (!isWindows) return;
        const result = convertToWindowsPath('/d/code');
        expect(result).toMatch(/^[D]:/);
    });
});

describe('path-utils normalizePath', () => {
    it('removes surrounding quotes', () => {
        expect(normalizePath('"test"')).toBe('test');
        expect(normalizePath("'test'")).toBe('test');
        expect(normalizePath('"nested"path"')).toBe('nested"path');
    });

    it('trims whitespace', () => {
        expect(normalizePath('  test  ')).toBe('test');
        expect(normalizePath('\ttest\n')).toBe('test');
    });

    it('preserves WSL paths without modification', () => {
        const wslPath = '/mnt/c/Users/Test';
        expect(normalizePath(wslPath)).toBe(wslPath);
    });

    it('collapses double slashes', () => {
        expect(normalizePath('//home//user')).toBe('/home/user');
        expect(normalizePath('/home//user//file')).toBe('/home/user/file');
    });

    it('removes trailing slashes (except root)', () => {
        expect(normalizePath('/home/user/')).toBe('/home/user');
        expect(normalizePath('/home/user/file/')).toBe('/home/user/file');
        expect(normalizePath('/')).toBe('/');
    });

    it('resolves dot segments', () => {
        expect(normalizePath('/home/./user')).toBe('/home/user');
        expect(normalizePath('/home/../user')).toBe('/user');
    });

    it('handles relative paths', () => {
        expect(normalizePath('./test')).toBe('test');
        expect(normalizePath('../test')).toBe('../test');
    });

    it('normalizes Windows drive letters to uppercase', () => {
        if (process.platform !== 'win32') return;
        expect(normalizePath('c:\\Users\\test')).toMatch(/^C:/);
    });

    it('converts forward slashes on Windows', () => {
        if (process.platform !== 'win32') return;
        expect(normalizePath('C:/Users/test')).toBe('C:\\Users\\test');
    });

    it('handles UNC paths', () => {
        if (process.platform !== 'win32') return;
        const uncPath = '\\\\server\\share\\file';
        expect(normalizePath(uncPath)).toBe('\\\\server\\share\\file');
    });

    it('handles excessive leading backslashes in UNC paths', () => {
        if (process.platform !== 'win32') return;
        expect(normalizePath('\\\\\\\\server\\share')).toBe('\\\\server\\share');
    });

    it('handles empty string', () => {
        expect(normalizePath('')).toBe('');
    });

    it('handles null-like input by returning as-is', () => {
        expect(normalizePath('test')).toBe('test');
    });
});

describe('path-utils expandHome', () => {
    const homeDir = os.homedir();

    it('expands tilde with path', () => {
        const result = expandHome('~/test');
        expect(result).toBe(path.join(homeDir, 'test'));
    });

    it('expands standalone tilde', () => {
        const result = expandHome('~');
        expect(result).toBe(homeDir);
    });

    it('leaves non-tilde paths unchanged', () => {
        const absolutePath = '/home/user/file.txt';
        expect(expandHome(absolutePath)).toBe(absolutePath);
    });

    it('leaves relative paths unchanged', () => {
        expect(expandHome('./test')).toBe('./test');
        expect(expandHome('../test')).toBe('../test');
    });

    it('handles WSL home paths', () => {
        const result = expandHome('~');
        expect(result).toBe(homeDir);
    });

    it('expands tilde with multi-level path', () => {
        const result = expandHome('~/projects/app/src');
        expect(result).toBe(path.join(homeDir, 'projects/app/src'));
    });
});

describe('path-utils integration', () => {
    it('normalizePath and expandHome compose correctly', () => {
        const input = '~/test file';
        const expanded = expandHome(input);
        const normalized = normalizePath(expanded);
        expect(normalized).toBe(path.join(os.homedir(), 'test file'));
    });

    it('handles quoted tilde paths', () => {
        const expanded = expandHome('"~/test"');
        expect(expanded).toBe('"~/test"');
        const normalized = normalizePath(expanded);
        expect(normalized).toBe(path.join(os.homedir(), 'test'));
    });

    it('handles Windows-style home paths on Windows', () => {
        if (process.platform !== 'win32') return;
        const normalized = normalizePath('~\\Desktop');
        expect(normalized).toContain(os.homedir());
    });
});