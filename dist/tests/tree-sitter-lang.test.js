/**
 * Tests for dist/tree-sitter.js pure functions
 * Covers: getLangForFile, getSupportedExtensions, isSupported
 *
 * These tests correspond to the tree-sitter utility functions originally
 * backed up in .js-backup/core/tree-sitter.js that was removed in this PR.
 * The dist/tree-sitter.js is the equivalent current implementation.
 *
 * Note: Tests here focus only on the pure synchronous functions that don't
 * require WASM loading (getLangForFile, isSupported, getSupportedExtensions).
 */

import { describe, it, expect, vi } from 'vitest';

// Mock web-tree-sitter since WASM is not available in the test environment.
// The pure functions under test (getLangForFile, isSupported, getSupportedExtensions)
// do not use Parser at all — they only use the EXT_TO_LANG lookup table.
vi.mock('web-tree-sitter', () => ({
    default: {},
    Parser: class MockParser {
        static async init() {}
        setLanguage() {}
        parse() { return { rootNode: { hasError: false, childCount: 0 }, delete: () => {} }; }
        delete() {}
    },
    Language: { load: async () => ({}) },
    Query: class MockQuery {
        constructor() {}
        matches() { return []; }
    },
}));

import { getLangForFile, getSupportedExtensions, isSupported } from '../tree-sitter.js';

describe('getLangForFile', () => {
    // JavaScript / TypeScript
    it('should return "javascript" for .js files', () => {
        expect(getLangForFile('app.js')).toBe('javascript');
    });

    it('should return "javascript" for .mjs files', () => {
        expect(getLangForFile('module.mjs')).toBe('javascript');
    });

    it('should return "javascript" for .cjs files', () => {
        expect(getLangForFile('config.cjs')).toBe('javascript');
    });

    it('should return "javascript" for .jsx files', () => {
        expect(getLangForFile('Component.jsx')).toBe('javascript');
    });

    it('should return "typescript" for .ts files', () => {
        expect(getLangForFile('app.ts')).toBe('typescript');
    });

    it('should return "typescript" for .mts files', () => {
        expect(getLangForFile('module.mts')).toBe('typescript');
    });

    it('should return "typescript" for .cts files', () => {
        expect(getLangForFile('config.cts')).toBe('typescript');
    });

    it('should return "tsx" for .tsx files', () => {
        expect(getLangForFile('Component.tsx')).toBe('tsx');
    });

    // Python
    it('should return "python" for .py files', () => {
        expect(getLangForFile('script.py')).toBe('python');
    });

    it('should return "python" for .pyi files', () => {
        expect(getLangForFile('types.pyi')).toBe('python');
    });

    // Shell
    it('should return "bash" for .sh files', () => {
        expect(getLangForFile('script.sh')).toBe('bash');
    });

    it('should return "bash" for .bash files', () => {
        expect(getLangForFile('config.bash')).toBe('bash');
    });

    it('should return "bash" for .zsh files', () => {
        expect(getLangForFile('profile.zsh')).toBe('bash');
    });

    // Go
    it('should return "go" for .go files', () => {
        expect(getLangForFile('main.go')).toBe('go');
    });

    // Rust
    it('should return "rust" for .rs files', () => {
        expect(getLangForFile('lib.rs')).toBe('rust');
    });

    // Java
    it('should return "java" for .java files', () => {
        expect(getLangForFile('Main.java')).toBe('java');
    });

    // C / C++
    it('should return "c" for .c files', () => {
        expect(getLangForFile('main.c')).toBe('c');
    });

    it('should return "c" for .h files', () => {
        expect(getLangForFile('header.h')).toBe('c');
    });

    it('should return "cpp" for .cpp files', () => {
        expect(getLangForFile('main.cpp')).toBe('cpp');
    });

    it('should return "cpp" for .cc files', () => {
        expect(getLangForFile('lib.cc')).toBe('cpp');
    });

    it('should return "cpp" for .cxx files', () => {
        expect(getLangForFile('lib.cxx')).toBe('cpp');
    });

    it('should return "cpp" for .hpp files', () => {
        expect(getLangForFile('header.hpp')).toBe('cpp');
    });

    // C#
    it('should return "csharp" for .cs files', () => {
        expect(getLangForFile('Program.cs')).toBe('csharp');
    });

    // Kotlin
    it('should return "kotlin" for .kt files', () => {
        expect(getLangForFile('Main.kt')).toBe('kotlin');
    });

    it('should return "kotlin" for .kts files', () => {
        expect(getLangForFile('build.kts')).toBe('kotlin');
    });

    // PHP
    it('should return "php" for .php files', () => {
        expect(getLangForFile('index.php')).toBe('php');
    });

    // Ruby
    it('should return "ruby" for .rb files', () => {
        expect(getLangForFile('script.rb')).toBe('ruby');
    });

    it('should return "ruby" for .rake files', () => {
        expect(getLangForFile('Rakefile.rake')).toBe('ruby');
    });

    it('should return "ruby" for .gemspec files', () => {
        expect(getLangForFile('gem.gemspec')).toBe('ruby');
    });

    // Swift
    it('should return "swift" for .swift files', () => {
        expect(getLangForFile('App.swift')).toBe('swift');
    });

    // Web
    it('should return "css" for .css files', () => {
        expect(getLangForFile('styles.css')).toBe('css');
    });

    it('should return "css" for .scss files', () => {
        expect(getLangForFile('styles.scss')).toBe('css');
    });

    // Data formats
    it('should return "json" for .json files', () => {
        expect(getLangForFile('config.json')).toBe('json');
    });

    it('should return "json" for .jsonc files', () => {
        expect(getLangForFile('tsconfig.jsonc')).toBe('json');
    });

    it('should return "yaml" for .yaml files', () => {
        expect(getLangForFile('config.yaml')).toBe('yaml');
    });

    it('should return "yaml" for .yml files', () => {
        expect(getLangForFile('config.yml')).toBe('yaml');
    });

    it('should return "sql" for .sql files', () => {
        expect(getLangForFile('query.sql')).toBe('sql');
    });

    // Documentation
    it('should return "markdown" for .md files', () => {
        expect(getLangForFile('README.md')).toBe('markdown');
    });

    it('should return "markdown" for .mdx files', () => {
        expect(getLangForFile('blog.mdx')).toBe('markdown');
    });

    // Unsupported
    it('should return null for .txt files', () => {
        expect(getLangForFile('notes.txt')).toBeNull();
    });

    it('should return null for .log files', () => {
        expect(getLangForFile('app.log')).toBeNull();
    });

    it('should return null for .png files', () => {
        expect(getLangForFile('image.png')).toBeNull();
    });

    it('should return null for .pdf files', () => {
        expect(getLangForFile('document.pdf')).toBeNull();
    });

    it('should return null for files with no extension', () => {
        expect(getLangForFile('Makefile')).toBeNull();
        expect(getLangForFile('Dockerfile')).toBeNull();
    });

    it('should return null for .unknown extension', () => {
        expect(getLangForFile('file.unknownext')).toBeNull();
    });

    // Case insensitivity
    it('should handle uppercase extensions case-insensitively', () => {
        expect(getLangForFile('FILE.JS')).toBe('javascript');
        expect(getLangForFile('SCRIPT.PY')).toBe('python');
        expect(getLangForFile('MAIN.TS')).toBe('typescript');
    });

    it('should handle mixed case extensions', () => {
        expect(getLangForFile('file.Js')).toBe('javascript');
        expect(getLangForFile('script.Py')).toBe('python');
    });

    // Paths with directories
    it('should work with full absolute paths', () => {
        expect(getLangForFile('/home/user/project/src/index.ts')).toBe('typescript');
    });

    it('should work with relative paths', () => {
        expect(getLangForFile('./src/utils.js')).toBe('javascript');
        expect(getLangForFile('src/models/user.py')).toBe('python');
    });

    it('should work with Windows-style paths', () => {
        expect(getLangForFile('C:\\project\\src\\app.ts')).toBe('typescript');
    });
});

describe('getSupportedExtensions', () => {
    it('should return an array', () => {
        const extensions = getSupportedExtensions();
        expect(Array.isArray(extensions)).toBe(true);
    });

    it('should return non-empty array', () => {
        expect(getSupportedExtensions().length).toBeGreaterThan(0);
    });

    it('should include common extensions', () => {
        const extensions = getSupportedExtensions();
        expect(extensions).toContain('.js');
        expect(extensions).toContain('.ts');
        expect(extensions).toContain('.py');
        expect(extensions).toContain('.go');
    });

    it('should return extensions starting with a dot', () => {
        const extensions = getSupportedExtensions();
        expect(extensions.every(ext => ext.startsWith('.'))).toBe(true);
    });

    it('should not contain duplicates', () => {
        const extensions = getSupportedExtensions();
        const unique = new Set(extensions);
        expect(unique.size).toBe(extensions.length);
    });

    it('should be consistent across calls', () => {
        const first = getSupportedExtensions();
        const second = getSupportedExtensions();
        expect(first).toEqual(second);
    });
});

describe('isSupported', () => {
    it('should return true for supported .js files', () => {
        expect(isSupported('app.js')).toBe(true);
    });

    it('should return true for supported .ts files', () => {
        expect(isSupported('app.ts')).toBe(true);
    });

    it('should return true for supported .py files', () => {
        expect(isSupported('script.py')).toBe(true);
    });

    it('should return false for unsupported .txt files', () => {
        expect(isSupported('notes.txt')).toBe(false);
    });

    it('should return false for unsupported .log files', () => {
        expect(isSupported('app.log')).toBe(false);
    });

    it('should return false for files with no extension', () => {
        expect(isSupported('Makefile')).toBe(false);
    });

    it('should return a boolean', () => {
        expect(typeof isSupported('file.js')).toBe('boolean');
        expect(typeof isSupported('file.txt')).toBe('boolean');
    });

    it('should be consistent with getLangForFile', () => {
        const testCases = ['file.js', 'file.ts', 'file.py', 'file.txt', 'file.log', 'Makefile'];
        for (const f of testCases) {
            const lang = getLangForFile(f);
            const supported = isSupported(f);
            expect(supported).toBe(lang !== null);
        }
    });
});
