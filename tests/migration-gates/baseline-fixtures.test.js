import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { BASELINE_ROOT, DIST_ROOT } from './parity-helpers.js';

describe('MIGRATION GATE: frozen dist baseline fixtures', () => {
  it('compares rebuilt dist against a separate frozen baseline, never dist against itself', () => {
    expect(fs.existsSync(BASELINE_ROOT)).toBe(true);
    expect(fs.existsSync(DIST_ROOT)).toBe(true);
    expect(path.resolve(BASELINE_ROOT)).not.toBe(path.resolve(DIST_ROOT));
    expect(fs.existsSync(path.join(BASELINE_ROOT, 'core', 'server.js'))).toBe(true);
    expect(fs.existsSync(path.join(BASELINE_ROOT, 'tools', 'write_file.js'))).toBe(true);
  });
});
