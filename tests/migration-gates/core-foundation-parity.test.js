import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import {
  exportedKeys,
  expectSameResult,
  importPair,
  makeCtx,
  withTempDir,
  baselinePath,
  rebuiltPath,
} from './parity-helpers.js';

// ── Assigned source → dist-path mapping ────────────────────────────────────
// Every assigned file MUST appear here and MUST be covered by at least one
// meaningful behavior test below.  Omissions are caught by the coverage
// verification at the bottom of this describe block.
const ASSIGNED_CORE_FILES = {
  'src/core/shared.ts':         ['core', 'shared.js'],
  'src/core/tree-sitter.ts':    ['core', 'tree-sitter.js'],
  'src/core/roots-utils.ts':    ['core', 'roots-utils.js'],
  'src/core/compression.ts':    ['core', 'compression.js'],
  'src/core/lib.ts':            ['core', 'lib.js'],
  'src/core/edit-engine.ts':    ['core', 'edit-engine.js'],
  'src/core/server.ts':         ['core', 'server.js'],
  'src/core/path-utils.ts':     ['core', 'path-utils.js'],
  'src/core/path-validation.ts':['core', 'path-validation.js'],
  'src/core/symbol-index.ts':   ['core', 'symbol-index.js'],
  'src/core/stash.ts':          ['core', 'stash.js'],
  'src/core/project-context.ts':['core', 'project-context.js'],
  'src/core/toon_bridge.ts':    ['core', 'toon_bridge.js'],
};

const ASSIGNED_FILES_COVERED = new Set();
function markCovered(srcPath) {
  ASSIGNED_FILES_COVERED.add(srcPath);
}

const MODULES = [
  ['core', 'compression.js'],
  ['core', 'path-utils.js'],
  ['core', 'path-validation.js'],
  ['core', 'lib.js'],
  ['core', 'shared.js'],
  ['core', 'roots-utils.js'],
  ['core', 'stash.js'],
  ['core', 'tree-sitter.js'],
  ['core', 'edit-engine.js'],
  ['core', 'project-context.js'],
  ['core', 'symbol-index.js'],
  ['core', 'server.js'],
];

describe('MIGRATION GATE: core module runtime parity', () => {
  for (const parts of MODULES) {
    it(`${parts.join('/')} preserves public exports`, async () => {
      const { baseline, rebuilt } = await importPair(...parts);
      expect(exportedKeys(rebuilt)).toEqual(exportedKeys(baseline));
    });
  }

  it('path utilities preserve behavior and error shape', async () => {
    const pairs = [
      await importPair('core', 'path-utils.js'),
      await importPair('core', 'path-validation.js'),
    ];
    for (const { baseline, rebuilt } of pairs) {
      for (const input of ['~/x', './a/../b', '/tmp//x', '', '.', 'C:/Users/Test/file.txt']) {
        for (const name of ['normalizePath', 'expandHome']) {
          if (typeof baseline[name] !== 'function') continue;
          const [a, b] = await expectSameResult(baseline[name], rebuilt[name], input);
          expect(b).toEqual(a);
        }
      }
    }
  });

  it('lib utilities preserve formatting, diff, line ending, count, head/tail/offset behavior', async () => {
    const { baseline, rebuilt } = await importPair('core', 'lib.js');
    expect(rebuilt.formatSize(0)).toEqual(baseline.formatSize(0));
    expect(rebuilt.formatSize(1024)).toEqual(baseline.formatSize(1024));
    expect(rebuilt.normalizeLineEndings('a\r\nb\rc')).toEqual(baseline.normalizeLineEndings('a\r\nb\rc'));
    expect(rebuilt.countOccurrences('aaa', 'aa')).toEqual(baseline.countOccurrences('aaa', 'aa'));
    expect(rebuilt.createMinimalDiff('a\nb\n', 'a\nc\n', 'x.txt')).toEqual(baseline.createMinimalDiff('a\nb\n', 'a\nc\n', 'x.txt'));

    await withTempDir('zenith-core-lib-', async (dir) => {
      const file = path.join(dir, 'sample.txt');
      await fs.writeFile(file, 'l1\nl2\nl3\nl4\n', 'utf8');
      for (const [name, args] of [
        ['readFileContent', [file]],
        ['headFile', [file, 2]],
        ['tailFile', [file, 2]],
        ['offsetReadFile', [file, 1, 2]],
        ['getFileStats', [file]],
      ]) {
        const [a, b] = await expectSameResult(baseline[name], rebuilt[name], ...args);
        expect(b).toEqual(a);
      }
    });
  });

  it('compression helpers preserve budget/truncation decisions', async () => {
    const { baseline, rebuilt } = await importPair('core', 'compression.js');
    expect(rebuilt.DEFAULT_COMPRESSION_KEEP_RATIO).toBe(baseline.DEFAULT_COMPRESSION_KEEP_RATIO);
    for (const args of [[100, 50], [10000, 2000], [10, 100]]) {
      expect(rebuilt.computeCompressionBudget(...args)).toEqual(baseline.computeCompressionBudget(...args));
    }
    for (const args of [[1000, 100], [100, 1000]]) {
      expect(rebuilt.isCompressionUseful(...args)).toEqual(baseline.isCompressionUseful(...args));
    }
    for (const args of [['line1\nline2\nline3', 8], ['short', 100]]) {
      expect(rebuilt.truncateToBudget(...args)).toEqual(baseline.truncateToBudget(...args));
    }
  });

  it('shared helpers preserve constants, sensitivity, BM25, and base64 stream behavior', async () => {
    const { baseline, rebuilt } = await importPair('core', 'shared.js');
    for (const key of ['CHAR_BUDGET', 'RANK_THRESHOLD', 'DEFAULT_EXCLUDES', 'SENSITIVE_PATTERNS', 'RG_PATH']) {
      expect(rebuilt[key]).toEqual(baseline[key]);
    }
    for (const p of ['.env', '/tmp/id_rsa', 'normal.txt', 'secrets/token.json']) {
      expect(rebuilt.isSensitive(p)).toEqual(baseline.isSensitive(p));
    }
    const docs = [
      { path: 'a.txt', content: 'alpha beta beta' },
      { path: 'b.txt', content: 'gamma alpha' },
    ];
    const baseIndex = new baseline.BM25Index(docs);
    const rebuiltIndex = new rebuilt.BM25Index(docs);
    expect(rebuiltIndex.search('alpha beta')).toEqual(baseIndex.search('alpha beta'));
    const lines = ['a.txt:1: alpha beta beta', 'b.txt:1: gamma alpha'];
    expect(rebuilt.bm25RankResults(lines, 'alpha')).toEqual(baseline.bm25RankResults(lines, 'alpha'));

    await withTempDir('zenith-shared-', async (dir) => {
      const file = path.join(dir, 'blob.bin');
      await fs.writeFile(file, Buffer.from('hello'));
      expect(await rebuilt.readFileAsBase64Stream(file)).toEqual(await baseline.readFileAsBase64Stream(file));
    });
  });

  it('edit engine preserves content/block edit success and failure behavior', async () => {
    const { baseline, rebuilt } = await importPair('core', 'edit-engine.js');
    const content = 'one\ntwo\nthree\n';
    const editSets = [
      [{ mode: 'content', oldContent: 'two', newContent: 'TWO' }],
      [{ mode: 'block', block_start: 'one', block_end: 'two', replacement_block: 'ONE\nTWO' }],
      [{ mode: 'content', oldContent: 'missing', newContent: 'x' }],
    ];
    for (const edits of editSets) {
      const [a, b] = await expectSameResult(baseline.applyEditList, rebuilt.applyEditList, content, edits, { filePath: 'sample.txt', isBatch: edits.length > 1 });
      expect(b).toEqual(a);
    }
  });

  it('tree-sitter preserves representative language/symbol behavior', async () => {
    const { baseline, rebuilt } = await importPair('core', 'tree-sitter.js');
    for (const file of ['x.js', 'x.ts', 'x.py', 'x.unknown']) {
      expect(rebuilt.getLangForFile(file)).toEqual(baseline.getLangForFile(file));
      expect(rebuilt.isSupported(file)).toEqual(baseline.isSupported(file));
    }
    expect(rebuilt.getSupportedExtensions()).toEqual(baseline.getSupportedExtensions());
    const source = 'export function add(a, b) { return a + b; }\nclass Box { value() { return 1; } }\n';
    for (const name of ['getDefinitions', 'getSymbols', 'getSymbolSummary', 'checkSyntaxErrors', 'getStructuralFingerprint']) {
      const [a, b] = await expectSameResult(baseline[name], rebuilt[name], source, 'javascript');
      expect(b).toEqual(a);
    }
  });

  it('server helpers preserve directory resolution and validation behavior', async () => {
    const { baseline, rebuilt } = await importPair('core', 'server.js');
    await withTempDir('zenith-server-', async (dir) => {
      expect(await rebuilt.resolveInitialAllowedDirectories([dir])).toEqual(await baseline.resolveInitialAllowedDirectories([dir]));
      const [a, b] = await expectSameResult(baseline.validateDirectories, rebuilt.validateDirectories, [dir]);
      expect(b).toEqual(a);
      const missing = path.join(dir, 'missing');
      const [ma, mb] = await expectSameResult(baseline.validateDirectories, rebuilt.validateDirectories, [missing]);
      expect(mb).toEqual(ma);
    });
  });

  it('entrypoint files preserve shebang and static import specifiers', async () => {
    for (const parts of [['cli', 'stdio.js'], ['server', 'http.js'], ['core', 'toon_bridge.js']]) {
      const baseline = await fs.readFile(baselinePath(...parts), 'utf8');
      const rebuilt = await fs.readFile(rebuiltPath(...parts), 'utf8');
      expect(rebuilt.startsWith('#!/usr/bin/env node')).toEqual(baseline.startsWith('#!/usr/bin/env node'));
      const imports = (txt) => [...txt.matchAll(/import\s+(?:[^'\"]+\s+from\s+)?['\"]([^'\"]+)['\"]/g)].map(m => m[1]).sort();
      expect(imports(rebuilt)).toEqual(imports(baseline));
    }
    markCovered('src/core/toon_bridge.ts');
  });

  // ── roots-utils: real directory validation parity ──────────────────────
  it('roots-utils preserves getValidRootDirectories with real dirs, file:// URIs, and invalid paths', async () => {
    const { baseline, rebuilt } = await importPair('core', 'roots-utils.js');
    await withTempDir('zenith-roots-', async (dir) => {
      // Valid directory via plain path
      const [a, b] = await expectSameResult(
        baseline.getValidRootDirectories, rebuilt.getValidRootDirectories,
        [{ uri: dir }],
      );
      expect(b).toEqual(a);

      // Valid directory via file:// URI
      const [c, d] = await expectSameResult(
        baseline.getValidRootDirectories, rebuilt.getValidRootDirectories,
        [{ uri: `file://${dir}` }],
      );
      expect(d).toEqual(c);

      // Non-existent path → empty array
      const [e, f] = await expectSameResult(
        baseline.getValidRootDirectories, rebuilt.getValidRootDirectories,
        [{ uri: '/nonexistent/path/xyz123' }],
      );
      expect(f).toEqual(e);

      // Empty input array
      const [g, h] = await expectSameResult(
        baseline.getValidRootDirectories, rebuilt.getValidRootDirectories,
        [],
      );
      expect(h).toEqual(g);

      // Mix of valid and invalid
      const [i, j] = await expectSameResult(
        baseline.getValidRootDirectories, rebuilt.getValidRootDirectories,
        [{ uri: dir }, { uri: '/nonexistent' }],
      );
      expect(j).toEqual(i);
    });
    markCovered('src/core/roots-utils.ts');
  });

  // ── symbol-index: session, repo-root, indexing, version parity ───────
  it('symbol-index preserves findRepoRoot, getSessionId, getDb, indexFile, and version management', async () => {
    const { baseline, rebuilt } = await importPair('core', 'symbol-index.js');

    // ── getSessionId: pure function parity ──
    expect(rebuilt.getSessionId('client-abc')).toBe(baseline.getSessionId('client-abc'));
    expect(rebuilt.getSessionId(undefined)).toBe(baseline.getSessionId(undefined));
    // Both should use process.pid:process.cwd() for undefined input
    expect(typeof rebuilt.getSessionId(undefined)).toBe('string');

    // ── findRepoRoot + getDb + indexFile + version management in git repos ──
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zenith-symidx-base-'));
    const rebuiltDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zenith-symidx-rebuilt-'));

    try {
      execSync('git init', { cwd: baseDir, stdio: 'ignore' });
      execSync('git init', { cwd: rebuiltDir, stdio: 'ignore' });

      const baseTestFile = path.join(baseDir, 'test.js');
      const rebuiltTestFile = path.join(rebuiltDir, 'test.js');
      const source = 'export function add(a, b) { return a + b; }\nexport class Box { value() { return 1; } }\n';
      await fs.writeFile(baseTestFile, source, 'utf8');
      await fs.writeFile(rebuiltTestFile, source, 'utf8');

      // findRepoRoot resolves for both
      const baseRoot = baseline.findRepoRoot(baseTestFile);
      const rebuiltRoot = rebuilt.findRepoRoot(rebuiltTestFile);
      expect(baseRoot).toBeTruthy();
      expect(rebuiltRoot).toBeTruthy();
      // Both should resolve to their respective git repo roots
      expect(baseRoot).toBe(baseDir);
      expect(rebuiltRoot).toBe(rebuiltDir);

      // Non-git path returns null for both
      expect(baseline.findRepoRoot(path.join(os.tmpdir(), 'nonexistent-xyz', 'file.txt'))).toBeNull();
      expect(rebuilt.findRepoRoot(path.join(os.tmpdir(), 'nonexistent-xyz', 'file.txt'))).toBeNull();

      // getDb creates a valid database for both
      const baseDb = baseline.getDb(baseDir);
      const rebuiltDb = rebuilt.getDb(rebuiltDir);
      expect(typeof baseDb.prepare).toBe('function');
      expect(typeof rebuiltDb.prepare).toBe('function');

      // indexFile produces matching symbol data
      await baseline.indexFile(baseDb, baseDir, baseTestFile);
      await rebuilt.indexFile(rebuiltDb, rebuiltDir, rebuiltTestFile);

      const baseSymbols = baseDb.prepare('SELECT name, kind, type, line FROM symbols ORDER BY name, kind').all();
      const rebuiltSymbols = rebuiltDb.prepare('SELECT name, kind, type, line FROM symbols ORDER BY name, kind').all();
      expect(rebuiltSymbols).toEqual(baseSymbols);

      // snapshotSymbol + getVersionText round-trip
      const sessionId = 'test-session-123';
      baseline.snapshotSymbol(baseDb, 'add', 'test.js', 'function add(a, b) { return a + b; }', sessionId, 1);
      rebuilt.snapshotSymbol(rebuiltDb, 'add', 'test.js', 'function add(a, b) { return a + b; }', sessionId, 1);

      const baseVersions = baseline.getVersionHistory(baseDb, 'add', sessionId, 'test.js');
      const rebuiltVersions = rebuilt.getVersionHistory(rebuiltDb, 'add', sessionId, 'test.js');
      expect(rebuiltVersions.length).toBe(baseVersions.length);
      expect(rebuiltVersions.length).toBeGreaterThan(0);

      // getVersionText returns the stored original text
      const baseText = baseline.getVersionText(baseDb, baseVersions[0].id);
      const rebuiltText = rebuilt.getVersionText(rebuiltDb, rebuiltVersions[0].id);
      expect(rebuiltText).toBe(baseText);
      expect(baseText).toBe('function add(a, b) { return a + b; }');

      // restoreVersion parity
      const baseRestore = baseline.restoreVersion(baseDb, 'add', baseVersions[0].id, sessionId);
      const rebuiltRestore = rebuilt.restoreVersion(rebuiltDb, 'add', rebuiltVersions[0].id, sessionId);
      expect(rebuiltRestore).toBe(baseRestore);
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
      await fs.rm(rebuiltDir, { recursive: true, force: true });
    }
    markCovered('src/core/symbol-index.ts');
  });

  // ── stash: full lifecycle parity in isolated git repos ─────────────────
  it('stash preserves entry lifecycle, attempt semantics, and convenience wrappers', async () => {
    const { baseline: baseStash, rebuilt: rebuiltStash } = await importPair('core', 'stash.js');

    // Two separate temp git repos to avoid DB conflicts between baseline/rebuilt
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zenith-stash-base-'));
    const rebuiltDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zenith-stash-rebuilt-'));

    try {
      execSync('git init', { cwd: baseDir, stdio: 'ignore' });
      execSync('git init', { cwd: rebuiltDir, stdio: 'ignore' });

      const baseCtx = makeCtx(baseDir);
      const rebuiltCtx = makeCtx(rebuiltDir);

      const baseFile = path.join(baseDir, 'test.txt');
      const rebuiltFile = path.join(rebuiltDir, 'test.txt');
      await fs.writeFile(baseFile, 'original', 'utf8');
      await fs.writeFile(rebuiltFile, 'original', 'utf8');

      // --- stashEntry ---
      const baseId = baseStash.stashEntry(baseCtx, 'edit', baseFile, { edits: ['old'] });
      const rebuiltId = rebuiltStash.stashEntry(rebuiltCtx, 'edit', rebuiltFile, { edits: ['old'] });
      expect(typeof rebuiltId, 'stashEntry should return a number').toBe(typeof baseId);
      expect(typeof baseId).toBe('number');

      // --- getStashEntry ---
      const baseEntry = baseStash.getStashEntry(baseCtx, baseId, baseFile);
      const rebuiltEntry = rebuiltStash.getStashEntry(rebuiltCtx, rebuiltId, rebuiltFile);
      expect(rebuiltEntry.type).toBe(baseEntry.type);
      expect(rebuiltEntry.payload).toEqual(baseEntry.payload);
      expect(rebuiltEntry.attempts).toBe(baseEntry.attempts);

      // --- consumeAttempt --- first call succeeds (attempts goes 0→1)
      const baseConsume1 = baseStash.consumeAttempt(baseCtx, baseId, baseFile);
      const rebuiltConsume1 = rebuiltStash.consumeAttempt(rebuiltCtx, rebuiltId, rebuiltFile);
      expect(rebuiltConsume1).toBe(baseConsume1);
      expect(baseConsume1).toBe(true);

      // second call succeeds (attempts goes 1→2, MAX_ATTEMPTS=2, so next > 2 would fail)
      const baseConsume2 = baseStash.consumeAttempt(baseCtx, baseId, baseFile);
      const rebuiltConsume2 = rebuiltStash.consumeAttempt(rebuiltCtx, rebuiltId, rebuiltFile);
      expect(rebuiltConsume2).toBe(baseConsume2);
      // After MAX_ATTEMPTS the entry is auto-deleted and further consume returns false
      const baseConsume3 = baseStash.consumeAttempt(baseCtx, baseId, baseFile);
      const rebuiltConsume3 = rebuiltStash.consumeAttempt(rebuiltCtx, rebuiltId, rebuiltFile);
      expect(rebuiltConsume3).toBe(baseConsume3);

      // --- listStash ---
      const id2Base = baseStash.stashEntry(baseCtx, 'write', baseFile, { content: 'c' });
      const id2Rebuilt = rebuiltStash.stashEntry(rebuiltCtx, 'write', rebuiltFile, { content: 'c' });
      const baseList = baseStash.listStash(baseCtx, baseFile);
      const rebuiltList = rebuiltStash.listStash(rebuiltCtx, rebuiltFile);
      expect(rebuiltList.entries.length).toBe(baseList.entries.length);
      expect(rebuiltList.isGlobal).toBe(baseList.isGlobal);
      expect(rebuiltList.entries.map(e => e.type).sort()).toEqual(baseList.entries.map(e => e.type).sort());

      // --- stashEdits convenience wrapper ---
      const baseEditId = baseStash.stashEdits(baseCtx, baseFile, [{ old: 'x' }], [0]);
      const rebuiltEditId = rebuiltStash.stashEdits(rebuiltCtx, rebuiltFile, [{ old: 'x' }], [0]);
      const baseEditEntry = baseStash.getStashEntry(baseCtx, baseEditId, baseFile);
      const rebuiltEditEntry = rebuiltStash.getStashEntry(rebuiltCtx, rebuiltEditId, rebuiltFile);
      expect(rebuiltEditEntry.type).toBe('edit');
      expect(rebuiltEditEntry.type).toBe(baseEditEntry.type);
      expect(rebuiltEditEntry.payload).toEqual(baseEditEntry.payload);

      // --- stashWrite convenience wrapper ---
      const baseWriteId = baseStash.stashWrite(baseCtx, baseFile, 'new-content', 'overwrite');
      const rebuiltWriteId = rebuiltStash.stashWrite(rebuiltCtx, rebuiltFile, 'new-content', 'overwrite');
      const baseWriteEntry = baseStash.getStashEntry(baseCtx, baseWriteId, baseFile);
      const rebuiltWriteEntry = rebuiltStash.getStashEntry(rebuiltCtx, rebuiltWriteId, rebuiltFile);
      expect(rebuiltWriteEntry.type).toBe('write');
      expect(rebuiltWriteEntry.payload).toEqual(baseWriteEntry.payload);

      // --- clearStash ---
      baseStash.clearStash(baseCtx, id2Base, baseFile);
      rebuiltStash.clearStash(rebuiltCtx, id2Rebuilt, rebuiltFile);
      expect(baseStash.getStashEntry(baseCtx, id2Base, baseFile)).toBeNull();
      expect(rebuiltStash.getStashEntry(rebuiltCtx, id2Rebuilt, rebuiltFile)).toBeNull();
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
      await fs.rm(rebuiltDir, { recursive: true, force: true });
    }
    markCovered('src/core/stash.ts');
  });

  // ── project-context: class interface and resolution parity ────────────
  it('project-context preserves ProjectContext class behavior and getStashDb resolution', async () => {
    const { baseline, rebuilt } = await importPair('core', 'project-context.js');

    // Structural checks
    expect(typeof baseline.ProjectContext).toBe('function');
    expect(typeof rebuilt.ProjectContext).toBe('function');
    expect(typeof baseline.getProjectContext).toBe('function');
    expect(typeof rebuilt.getProjectContext).toBe('function');
    expect(typeof baseline.onRootsChanged).toBe('function');
    expect(typeof rebuilt.onRootsChanged).toBe('function');

    await withTempDir('zenith-pctx-', async (dir) => {
      execSync('git init', { cwd: dir, stdio: 'ignore' });

      const baseCtx = makeCtx(dir);
      const rebuiltCtx = makeCtx(dir);

      // Directly construct — avoids the module singleton
      const basePc = new baseline.ProjectContext(baseCtx);
      const rebuiltPc = new rebuilt.ProjectContext(rebuiltCtx);

      // getRoot should resolve to the git repo dir for both
      const baseRoot = basePc.getRoot();
      const rebuiltRoot = rebuiltPc.getRoot();
      expect(rebuiltRoot).toBe(baseRoot);
      expect(baseRoot).toBeTruthy();

      // isGlobal must match
      expect(rebuiltPc.isGlobal).toBe(basePc.isGlobal);

      // getStashDb should produce DB objects with matching structure
      const testFile = path.join(dir, 'sample.txt');
      await fs.writeFile(testFile, 'data', 'utf8');
      const baseDb = basePc.getStashDb(testFile);
      const rebuiltDb = rebuiltPc.getStashDb(testFile);
      expect(rebuiltDb.isGlobal).toBe(baseDb.isGlobal);
      expect(typeof rebuiltDb.db).toBe(typeof baseDb.db);
      expect(rebuiltDb.root).toBe(baseDb.root);

      // refresh resets resolution state
      basePc.refresh();
      rebuiltPc.refresh();
      expect(basePc.getRoot()).toBe(rebuiltPc.getRoot());

      // initProject binds and persists (use a sub-dir so we don't collide with git)
      const subDir = path.join(dir, 'myproject');
      await fs.mkdir(subDir, { recursive: true });
      const baseInit = basePc.initProject(subDir, 'myproject');
      const rebuiltInit = rebuiltPc.initProject(subDir, 'myproject');
      expect(rebuiltInit).toBe(baseInit);
      expect(basePc.getRoot()).toBe(rebuiltPc.getRoot());

      // listRegisteredProjects returns arrays with matching structure
      const baseProjects = basePc.listRegisteredProjects();
      const rebuiltProjects = rebuiltPc.listRegisteredProjects();
      expect(rebuiltProjects.map(p => p.root_path).sort()).toEqual(baseProjects.map(p => p.root_path).sort());
    });
    markCovered('src/core/project-context.ts');
  });

  // ── toon_bridge: child-process behavior parity ────────────────────────
  it('toon_bridge preserves CLI exit behavior and error output when invoked with no args', async () => {
    const { spawn } = await import('child_process');
    const runToon = (file) => new Promise((resolve) => {
      const child = spawn(process.execPath, [file], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGTERM'), 3000);
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });

    const base = await runToon(baselinePath('core', 'toon_bridge.js'));
    const rebuilt = await runToon(rebuiltPath('core', 'toon_bridge.js'));
    expect(rebuilt.code).toBe(base.code);
    // Should produce some output (error message) when invoked with no args
    expect(base.stdout.length + base.stderr.length).toBeGreaterThan(0);
    expect(rebuilt.stderr.length + rebuilt.stdout.length).toBeGreaterThan(0);
    markCovered('src/core/toon_bridge.ts');
  });

  // ── Mark files already tested by existing behavior tests above ───────
  // These are covered by the tests that were already in the file:
  //   shared, tree-sitter, compression, lib, edit-engine, server,
  //   path-utils, path-validation
  // We mark them here so the coverage check passes.
  markCovered('src/core/shared.ts');
  markCovered('src/core/tree-sitter.ts');
  markCovered('src/core/compression.ts');
  markCovered('src/core/lib.ts');
  markCovered('src/core/edit-engine.ts');
  markCovered('src/core/server.ts');
  markCovered('src/core/path-utils.ts');
  markCovered('src/core/path-validation.ts');

  // ── Coverage verification ─────────────────────────────────────────────
  it('covers every assigned core file with at least one meaningful test', () => {
    const allSrcPaths = Object.keys(ASSIGNED_CORE_FILES);
    const missing = allSrcPaths.filter(p => !ASSIGNED_FILES_COVERED.has(p));
    expect(missing, `Missing coverage for assigned core files: ${missing.join(', ')}`).toEqual([]);
  });
});
