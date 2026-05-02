import { describe, it, expect, afterAll } from 'vitest';
import { importPair, exportedKeys, withTempDir, normalizeText } from './parity-helpers.js';
import fs from 'fs/promises';
import path from 'path';

const ASSIGNED_FILES = [
  'src/config/zenith-mcp/admin-cli.ts',
];

const COVERED = new Set();
const cover = (file) => COVERED.add(file);

describe('MIGRATION GATE: admin CLI entrypoint parity', () => {
  it('baseline and rebuilt admin-cli.js export the same keys and entrypoint surface', async () => {
    const basePath = path.join(process.cwd(), 'tests', 'fixtures', 'dist-baseline', 'dist', 'config', 'zenith-mcp', 'admin-cli.js');
    const rebuiltPath = path.join(process.cwd(), 'dist', 'config', 'zenith-mcp', 'admin-cli.js');

    const baselineText = await fs.readFile(basePath, 'utf8');
    const rebuiltText = await fs.readFile(rebuiltPath, 'utf8');
    expect(rebuiltText).toBeTruthy();
    expect(baselineText).toBeTruthy();

    const { baseline, rebuilt } = await importPair('config', 'zenith-mcp', 'admin-cli.js');
    cover('src/config/zenith-mcp/admin-cli.ts');

    expect(exportedKeys(rebuilt)).toEqual(exportedKeys(baseline));
    expect(rebuiltText).toBe(normalizeText(baselineText, []));

    for (const key of ['cmdList', 'cmdStatus', 'cmdInstall', 'cmdScan', 'runConfigAdminCli']) {
      expect(exportedKeys(rebuilt)).toContain(key);
      expect(exportedKeys(baseline)).toContain(key);
    }
  });

  it('entrypoint main behavior returns a numeric exit code and prints usage for empty argv', async () => {
    const { baseline, rebuilt } = await importPair('config', 'zenith-mcp', 'admin-cli.js');
    const [baseResult, rebuiltResult] = await Promise.all([
      baseline.runConfigAdminCli([]),
      rebuilt.runConfigAdminCli([]),
    ]);

    expect(typeof baseResult).toBe('number');
    expect(typeof rebuiltResult).toBe('number');
    expect(rebuiltResult).toBe(baseResult);
    expect(baseResult).toBe(1);
  });

  it('entrypoint main behavior handles unknown commands with matching exit code shape', async () => {
    const { baseline, rebuilt } = await importPair('config', 'zenith-mcp', 'admin-cli.js');
    const [baseResult, rebuiltResult] = await Promise.all([
      baseline.runConfigAdminCli(['nope']),
      rebuilt.runConfigAdminCli(['nope']),
    ]);

    expect(rebuiltResult).toBe(baseResult);
    expect(rebuiltResult).toBe(1);
  });

  it('rebuild and baseline admin-cli text stay aligned after normalization', async () => {
    const basePath = path.join(process.cwd(), 'tests', 'fixtures', 'dist-baseline', 'dist', 'config', 'zenith-mcp', 'admin-cli.js');
    const rebuiltPath = path.join(process.cwd(), 'dist', 'config', 'zenith-mcp', 'admin-cli.js');
    const baselineText = await fs.readFile(basePath, 'utf8');
    const rebuiltText = await fs.readFile(rebuiltPath, 'utf8');

    expect(normalizeText(rebuiltText)).toBe(normalizeText(baselineText));
  });

  afterAll(() => {
    const missing = ASSIGNED_FILES.filter((f) => !COVERED.has(f));
    expect(missing).toEqual([]);
  });
});
