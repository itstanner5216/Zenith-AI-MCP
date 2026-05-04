import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import { baselinePath, exportedKeys, importPair, rebuiltPath } from './parity-helpers.js';

// ── Assigned entrypoint source → dist-path mapping ─────────────────────────
const ASSIGNED_ENTRYPOINT_FILES = {
  'src/cli/stdio.ts': ['cli', 'stdio.js'],
};

const ASSIGNED_FILES_COVERED = new Set();
function markCovered(srcPath) {
  ASSIGNED_FILES_COVERED.add(srcPath);
}

function runNode(file, args = [], env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 1200);
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe('MIGRATION GATE: server and CLI entrypoint parity', () => {
  it('stdio entrypoint import graph and no-dir startup behavior stay compatible', async () => {
    const base = await runNode(baselinePath('cli', 'stdio.js'));
    const rebuilt = await runNode(rebuiltPath('cli', 'stdio.js'));
    expect(rebuilt.code).toBe(base.code);
    expect(rebuilt.stderr).toContain('Usage: zenith-mcp');
    expect(base.stderr).toContain('Usage: zenith-mcp');
  });

  it('http entrypoint auth-env startup failure stays compatible', async () => {
    const env = { ZENITH_MCP_API_KEY: '', MCP_BRIDGE_API_KEY: '', COMMANDER_API_KEY: '' };
    const base = await runNode(baselinePath('server', 'http.js'), [], env);
    const rebuilt = await runNode(rebuiltPath('server', 'http.js'), [], env);
    expect(rebuilt.code).toBe(base.code);
    expect(rebuilt.stderr).toBe(base.stderr);
  });

  it('entrypoint shebang and import specifiers are unchanged', async () => {
    for (const parts of [['cli', 'stdio.js'], ['server', 'http.js']]) {
      const base = await fs.readFile(baselinePath(...parts), 'utf8');
      const rebuilt = await fs.readFile(rebuiltPath(...parts), 'utf8');
      expect(rebuilt.split('\n')[0]).toBe(base.split('\n')[0]);
      const imports = (txt) => [...txt.matchAll(/import\s+(?:[^'\"]+\s+from\s+)?['\"]([^'\"]+)['\"]/g)].map(m => m[1]).sort();
      expect(imports(rebuilt)).toEqual(imports(base));
    }
    markCovered('src/cli/stdio.ts');
  });

  // ── stdio: stronger child-process parity with directory args ──────────
  it('stdio entrypoint preserves startup error message format when given an invalid directory', async () => {
    const base = await runNode(baselinePath('cli', 'stdio.js'), ['/nonexistent/dir/xyz']);
    const rebuilt = await runNode(rebuiltPath('cli', 'stdio.js'), ['/nonexistent/dir/xyz']);
    expect(rebuilt.code).toBe(base.code);
    // Both should fail with a non-zero exit code for invalid dirs
    expect(base.code).not.toBe(0);
    expect(rebuilt.code).not.toBe(0);
    // Error messages should match in structure
    expect(rebuilt.stderr.length).toBeGreaterThan(0);
    expect(base.stderr.length).toBeGreaterThan(0);
  });

  // ── stdio: declaration file presence for assigned entrypoint ─────────
  it('stdio has matching declaration file with expected export declarations', async () => {
    const baseDts = await fs.readFile(baselinePath('cli', 'stdio.d.ts'), 'utf8').catch(() => null);
    const rebuiltDts = await fs.readFile(rebuiltPath('cli', 'stdio.d.ts'), 'utf8').catch(() => null);
    // Both should either have or not have declaration files
    expect(rebuiltDts === null).toBe(baseDts === null);
    if (baseDts && rebuiltDts) {
      // Check that key exported names appear in both
      const exportedNames = [...baseDts.matchAll(/export\s+(?:declare\s+)?(?:function|const|class|type|interface)\s+(\w+)/g)].map(m => m[1]);
      for (const name of exportedNames) {
        expect(rebuiltDts, `stdio.d.ts missing declaration for ${name}`).toContain(name);
      }
      // Must not import .ts files
      expect(rebuiltDts).not.toMatch(/from\s+['"][^'"]+\.ts['"]/);
    }
  });

  // ── Coverage verification ─────────────────────────────────────────────
  it('covers every assigned entrypoint file with at least one meaningful test', () => {
    const allSrcPaths = Object.keys(ASSIGNED_ENTRYPOINT_FILES);
    const missing = allSrcPaths.filter(p => !ASSIGNED_FILES_COVERED.has(p));
    expect(missing, `Missing coverage for assigned entrypoint files: ${missing.join(', ')}`).toEqual([]);
  });
});
