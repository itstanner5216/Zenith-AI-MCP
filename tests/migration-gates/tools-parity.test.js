import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  captureServer,
  exportedKeys,
  fileExists,
  importPair,
  makeCtx,
  normalizeText,
  readIfExists,
  runToolInTwinDirs,
  toolRegistrationSummary,
  withTempDir,
} from './parity-helpers.js';

const TOOL_FILES = [
  'directory.js',
  'edit_file.js',
  'filesystem.js',
  'read_file.js',
  'read_media_file.js',
  'read_multiple_files.js',
  'refactor_batch.js',
  'search_file.js',
  'search_files.js',
  'stash_restore.js',
  'write_file.js',
];

async function registeredPair(file, root) {
  const { baseline, rebuilt } = await importPair('tools', file);
  const baseCapture = captureServer();
  const rebuiltCapture = captureServer();
  baseline.register(baseCapture.server, makeCtx(root));
  rebuilt.register(rebuiltCapture.server, makeCtx(root));
  return { baseline, rebuilt, baseCapture, rebuiltCapture };
}

async function expectToolResultParity(file, args, options = {}) {
  const result = await runToolInTwinDirs(['tools', file], args, options);
  const parentRoot = path.dirname(result.baseRoot);
  const replacements = [[result.baseRoot, '<ROOT>'], [result.rebuiltRoot, '<ROOT>'], [path.join(parentRoot, 'baseline'), '<ROOT>'], [path.join(parentRoot, 'rebuilt'), '<ROOT>'], [parentRoot, '<PARENT>'], ['/baseline/', '/<ROOT>/'], ['/rebuilt/', '/<ROOT>/']];
  expect(normalizeText(result.rebuiltResult, replacements)).toEqual(normalizeText(result.baseResult, replacements));
  return result;
}

describe('MIGRATION GATE: MCP tool schema and handler parity', () => {
  for (const file of TOOL_FILES) {
    it(`${file} preserves real public exports and registration schema`, async () => {
      await withTempDir('zenith-tool-schema-', async (root) => {
        const { baseline, rebuilt, baseCapture, rebuiltCapture } = await registeredPair(file, root);
        expect(exportedKeys(rebuilt)).toEqual(exportedKeys(baseline));
        expect(toolRegistrationSummary(rebuiltCapture.calls)).toEqual(toolRegistrationSummary(baseCapture.calls));
        expect(rebuiltCapture.calls.length).toBeGreaterThan(0);
        for (const call of rebuiltCapture.calls) {
          expect(typeof call.handler).toBe('function');
        }
      });
    });
  }

  it('write_file preserves create, overwrite, failIfExists, append/overlap, CRLF normalization, and side effects', async () => {
    let r = await expectToolResultParity('write_file.js', { path: 'new.txt', content: 'a\r\nb' });
    expect(await readIfExists(path.join(r.rebuiltRoot, 'new.txt'))).toBe(await readIfExists(path.join(r.baseRoot, 'new.txt')));

    r = await expectToolResultParity('write_file.js', { path: 'alpha.txt', content: 'replacement' });
    expect(await readIfExists(path.join(r.rebuiltRoot, 'alpha.txt'))).toBe(await readIfExists(path.join(r.baseRoot, 'alpha.txt')));

    await expectToolResultParity('write_file.js', { path: 'alpha.txt', content: 'x', failIfExists: true });

    r = await expectToolResultParity('write_file.js', { path: 'alpha.txt', content: 'needle\nfour\nadded\n', append: true });
    expect(await readIfExists(path.join(r.rebuiltRoot, 'alpha.txt'))).toBe(await readIfExists(path.join(r.baseRoot, 'alpha.txt')));
  });

  it('read_file preserves full, head, tail, offset, ranges, line numbers, truncation, and missing file behavior', async () => {
    for (const args of [
      { path: 'alpha.txt' },
      { path: 'alpha.txt', head: 2 },
      { path: 'alpha.txt', tail: 2 },
      { path: 'alpha.txt', offset: 1, head: 2, showLineNumbers: true },
      { path: 'alpha.txt', aroundLine: 3, context: 1 },
      { path: 'alpha.txt', ranges: [{ startLine: 2, endLine: 4 }] },
      { path: 'alpha.txt', maxChars: 6 },
      { path: 'missing.txt' },
    ]) {
      await expectToolResultParity('read_file.js', args);
    }
  });

  it('read_multiple_files preserves multi-read, line numbers, compression false, and per-file errors', async () => {
    for (const args of [
      { paths: ['alpha.txt', 'beta.txt'], compression: false },
      { paths: ['alpha.txt', 'missing.txt'], compression: false },
      { paths: ['alpha.txt'], compression: false, showLineNumbers: true },
      { paths: ['alpha.txt', 'beta.txt'], maxCharsPerFile: 12, compression: false },
    ]) {
      await expectToolResultParity('read_multiple_files.js', args);
    }
  });

  it('read_media_file preserves MIME/base64 output and missing file behavior', async () => {
    await expectToolResultParity('read_media_file.js', { path: 'pixel.png' });
    await expectToolResultParity('read_media_file.js', { path: 'alpha.txt' });
    await expectToolResultParity('read_media_file.js', { path: 'missing.png' });
  });

  it('search_file preserves grep, context, no-match, symbol, and unsupported behavior', async () => {
    for (const args of [
      { path: 'alpha.txt', grep: 'needle' },
      { path: 'alpha.txt', grep: 'needle', grepContext: 1 },
      { path: 'alpha.txt', grep: 'does-not-exist' },
      { path: 'sub/gamma.js', symbol: 'add' },
      { path: 'alpha.txt', symbol: 'nope' },
    ]) {
      await expectToolResultParity('search_file.js', args);
    }
  });

  it('directory preserves list/tree outputs including sizes, depth, excludes, and symbols flags', async () => {
    for (const args of [
      { mode: 'list', path: '.', depth: 1 },
      { mode: 'list', path: '.', depth: 2, includeSizes: true, sortBy: 'name' },
      { mode: 'tree', path: '.', excludePatterns: ['beta.txt'] },
      { mode: 'tree', path: '.', showSymbols: true },
      { mode: 'tree', path: '.', showSymbolNames: true },
    ]) {
      await expectToolResultParity('directory.js', args);
    }
  });

  it('filesystem preserves mkdir/info/move/delete behavior and side effects', async () => {
    let r = await expectToolResultParity('filesystem.js', { mode: 'mkdir', path: 'made/deep' });
    expect(fileExists(path.join(r.rebuiltRoot, 'made', 'deep'))).toBe(fileExists(path.join(r.baseRoot, 'made', 'deep')));

    await expectToolResultParity('filesystem.js', { mode: 'info', path: 'alpha.txt' });

    r = await expectToolResultParity('filesystem.js', { mode: 'move', source: 'alpha.txt', destination: 'moved.txt' });
    expect(await readIfExists(path.join(r.rebuiltRoot, 'moved.txt'))).toBe(await readIfExists(path.join(r.baseRoot, 'moved.txt')));

    r = await expectToolResultParity('filesystem.js', { mode: 'delete', path: 'alpha.txt' });
    expect(await readIfExists(path.join(r.rebuiltRoot, 'alpha.txt'))).toBe(await readIfExists(path.join(r.baseRoot, 'alpha.txt')));
  });

  it('edit_file preserves dry-run, apply, failures, and content side effects', async () => {
    await expectToolResultParity('edit_file.js', {
      path: 'alpha.txt',
      dryRun: true,
      edits: [{ mode: 'content', oldContent: 'two', newContent: 'TWO' }],
    });

    let r = await expectToolResultParity('edit_file.js', {
      path: 'alpha.txt',
      edits: [{ mode: 'content', oldContent: 'two', newContent: 'TWO' }],
    });
    expect(await readIfExists(path.join(r.rebuiltRoot, 'alpha.txt'))).toBe(await readIfExists(path.join(r.baseRoot, 'alpha.txt')));

    await expectToolResultParity('edit_file.js', {
      path: 'alpha.txt',
      edits: [{ mode: 'content', oldContent: 'missing', newContent: 'x' }],
    });
  });

  it('stash_restore preserves list/read missing/restore missing behavior', async () => {
    for (const args of [
      { mode: 'list' },
      { mode: 'read', stashId: 999999 },
      { mode: 'restore', stashId: 999999 },
      { mode: 'apply', stashId: 999999 },
    ]) {
      await expectToolResultParity('stash_restore.js', args);
    }
  });

  it('refactor_batch preserves representative validation/no-root behavior without mutating files', async () => {
    for (const args of [
      { mode: 'query' },
      { mode: 'query', target: 'add' },
      { mode: 'loadDiff' },
      { mode: 'loadDiff', loadMore: true },
      { mode: 'history', symbol: 'add' },
      { mode: 'restore', symbol: 'add' },
    ]) {
      await expectToolResultParity('refactor_batch.js', args);
    }
  });

  it('search_files preserves files/content/symbol modes on representative project', async () => {
    for (const args of [
      { mode: 'files', path: '.', namePattern: '*.txt', maxResults: 10 },
      { mode: 'files', path: '.', extensions: ['.js'], maxResults: 10, includeMetadata: true },
      { mode: 'content', path: '.', contentQuery: 'needle', literalSearch: true, contextLines: 1, maxResults: 10, countOnly: true },
      { mode: 'content', path: '.', contentQuery: 'needle', countOnly: true },
      { mode: 'symbol', path: '.', symbolQuery: 'add', maxResults: 10 },
      { mode: 'definition', path: '.', definesSymbol: 'add', maxResults: 10 },
      { mode: 'structural', path: '.', structuralQuery: 'add' },
    ]) {
      await expectToolResultParity('search_files.js', args);
    }
  });
});
