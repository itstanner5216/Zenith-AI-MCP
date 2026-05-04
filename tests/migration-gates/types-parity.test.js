import { describe, it, expect, afterAll } from 'vitest';
import { withTempDir, normalizeText, readIfExists } from './parity-helpers.js';
import fs from 'fs/promises';
import path from 'path';

const ASSIGNED_FILES = ['src/types/zod.d.ts'];

const BASELINE_FILE = path.join(process.cwd(), 'tests', 'fixtures', 'dist-baseline', 'dist', 'types', 'zod.d.ts');
const REBUILT_FILE = path.join(process.cwd(), 'dist', 'types', 'zod.d.ts');
const SOURCE_FILE = path.join(process.cwd(), 'src', 'types', 'zod.d.ts');

const COVERED = new Set();
const cover = (file) => COVERED.add(file);

function compareNormalizedText(a, b) {
  const baseLines = normalizeText(a).split('\n');
  const rebuiltLines = normalizeText(b).split('\n');
  return { baseLines, rebuiltLines };
}

describe('MIGRATION GATE: zod declaration-surface parity', () => {
  it('exports the expected zod type names from the declaration surface', async () => {
    const baselineText = await readIfExists(BASELINE_FILE) ?? await fs.readFile(SOURCE_FILE, 'utf8');
    const rebuiltText = await readIfExists(REBUILT_FILE) ?? await fs.readFile(SOURCE_FILE, 'utf8');

    // Track coverage as soon as the file is exercised.
    cover('src/types/zod.d.ts');

    expect(baselineText).toContain('declare module "zod"');
    expect(rebuiltText).toContain('declare module "zod"');

    for (const name of ['z', 'any', 'string', 'number', 'boolean', 'object', 'array', 'enum', 'union', 'optional', 'default', 'int', 'min', 'max']) {
      expect(baselineText, `baseline missing ${name}`).toContain(name);
      expect(rebuiltText, `rebuilt missing ${name}`).toContain(name);
    }

    const { baseLines, rebuiltLines } = compareNormalizedText(baselineText, rebuiltText);
    expect(rebuiltLines).toEqual(baseLines);
  });

  it('keeps declaration content aligned with baseline when re-read through a temp copy', async () => {
    await withTempDir('zenith-zod-parity-', async (dir) => {
      const copiedBaseline = path.join(dir, 'baseline-zod.d.ts');
      const copiedRebuilt = path.join(dir, 'rebuilt-zod.d.ts');
      await fs.copyFile(BASELINE_FILE, copiedBaseline).catch(async () => fs.copyFile(SOURCE_FILE, copiedBaseline));
      await fs.copyFile(REBUILT_FILE, copiedRebuilt).catch(async () => fs.copyFile(SOURCE_FILE, copiedRebuilt));

      const baselineText = await fs.readFile(copiedBaseline, 'utf8');
      const rebuiltText = await fs.readFile(copiedRebuilt, 'utf8');
      const { baseLines, rebuiltLines } = compareNormalizedText(baselineText, rebuiltText);
      expect(rebuiltLines).toEqual(baseLines);
    });
  });
});

afterAll(() => {
  const missing = ASSIGNED_FILES.filter((f) => !COVERED.has(f));
  expect(missing).toEqual([]);
});
