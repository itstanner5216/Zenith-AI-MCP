import { describe, it, expect, afterAll } from 'vitest';
import { importPair, exportedKeys, expectSameResult, withTempDir } from './parity-helpers.js';

const ASSIGNED_FILES = [
  'src/retrieval/ranking/bmx-index.ts',
  'src/retrieval/ranking/ranker.ts',
  'src/retrieval/ranking/fusion.ts',
  'src/retrieval/ranking/index.ts',
];

const COVERED = new Set();
const cover = (file) => COVERED.add(file);

function makeToolKey(toolKey, props = 0) {
  const inputSchema = props > 0
    ? {
        type: 'object',
        properties: Object.fromEntries(Array.from({ length: props }, (_, i) => [`p${i}`, { type: 'string' }])),
      }
    : undefined;
  return {
    toolKey,
    toolMapping: {
      tool: {
        name: toolKey,
        inputSchema,
      },
    },
    score: 0,
    tier: 'full',
  };
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('ranking migration parity', () => {
  it('bmx-index export surface and core behavior match baseline', async () => {
    cover('src/retrieval/ranking/bmx-index.ts');
    const { baseline, rebuilt } = await importPair('retrieval', 'ranking', 'bmx-index.js');
    expect(exportedKeys(rebuilt)).toEqual(exportedKeys(baseline));

    const base = new baseline.BMXIndex({ alphaOverride: 1.2, betaOverride: 0.02, normalizeScores: false });
    const reb = new rebuilt.BMXIndex({ alphaOverride: 1.2, betaOverride: 0.02, normalizeScores: false });

    const chunks = [
      { chunk_id: 'c1', text: 'alpha beta gamma' },
      { chunk_id: 'c2', text: 'beta beta delta' },
      { chunk_id: 'c3', text: 'epsilon zeta' },
    ];

    base.buildIndex(normalize(chunks));
    reb.buildIndex(normalize(chunks));
    expect(reb.getIndexStats()).toEqual(base.getIndexStats());

    const searchBase = base.search('beta', 5, false);
    const searchReb = reb.search('beta', 5, false);
    expect(searchReb).toEqual(searchBase);
    expect(searchReb.length).toBeGreaterThan(0);
    expect(searchReb[0][0]).toBe('c2');

    const stats = reb.getIndexStats();
    expect(stats).toMatchObject({
      totalDocuments: 3,
      uniqueTerms: expect.any(Number),
      avgDocLength: expect.any(Number),
      isBuilt: true,
      alpha: expect.any(Number),
      beta: expect.any(Number),
      alphaOverride: 1.2,
      betaOverride: 0.02,
      normalizeScores: false,
      avgEntropy: expect.any(Number),
    });

    expect(base.updateIndex('c4', 'beta theta')).toBe(reb.updateIndex('c4', 'beta theta'));
    expect(reb.search('beta', 10, false)).toEqual(base.search('beta', 10, false));
    expect(base.removeFromIndex('c1')).toBe(reb.removeFromIndex('c1'));
    expect(reb.search('alpha', 10, false)).toEqual(base.search('alpha', 10, false));
  });

  it('bmx-index field index search parity matches baseline using temp dir helper context', async () => {
    cover('src/retrieval/ranking/bmx-index.ts');
    await withTempDir('ranking-bmx-', async () => {
      const { baseline, rebuilt } = await importPair('retrieval', 'ranking', 'bmx-index.js');
      const docs = [
        {
          toolKey: 't1',
          toolName: 'file_search',
          namespace: 'filesystem',
          retrievalAliases: 'search files find',
          description: 'search across files',
          parameterNames: 'query path',
        },
        {
          toolKey: 't2',
          toolName: 'file_write',
          namespace: 'filesystem',
          retrievalAliases: 'write save',
          description: 'write a file',
          parameterNames: 'path content',
        },
      ];
      const base = new baseline.BMXIndex();
      const reb = new rebuilt.BMXIndex();
      base.buildFieldIndex(normalize(docs));
      reb.buildFieldIndex(normalize(docs));
      expect(reb.searchFields('search files', 5)).toEqual(base.searchFields('search files', 5));
    });
  });

  it('fusion export surface, blending, shape, and sort behavior match baseline', async () => {
    cover('src/retrieval/ranking/fusion.ts');
    const { baseline, rebuilt } = await importPair('retrieval', 'ranking', 'fusion.js');
    expect(exportedKeys(rebuilt)).toEqual(exportedKeys(baseline));

    expect(rebuilt.weightedRrf([], [], 0.5)).toEqual(baseline.weightedRrf([], [], 0.5));

    const envRanked = [
      { toolKey: 'b', toolMapping: { tool: { name: 'b' } }, score: 0, tier: 'full' },
      { toolKey: 'a', toolMapping: { tool: { name: 'a' } }, score: 0, tier: 'full' },
    ];
    const convRanked = [
      { toolKey: 'c', toolMapping: { tool: { name: 'c' } }, score: 0, tier: 'full' },
      { toolKey: 'a', toolMapping: { tool: { name: 'a' } }, score: 0, tier: 'full' },
    ];
    const [baseRes, rebRes] = await expectSameResult(
      baseline.weightedRrf,
      rebuilt.weightedRrf,
      normalize(envRanked),
      normalize(convRanked),
      0.6,
    );
    expect(rebRes).toEqual(baseRes);
    expect(rebRes[0]).toMatchObject({ toolKey: 'a', toolMapping: expect.any(Object), score: expect.any(Number), tier: 'full' });
    for (let i = 1; i < rebRes.length; i++) {
      expect(rebRes[i - 1].score).toBeGreaterThanOrEqual(rebRes[i].score);
    }

    const tieA = { toolKey: 'a', toolMapping: { tool: { name: 'a' } }, score: 0.1, tier: 'full' };
    const tieB = { toolKey: 'b', toolMapping: { tool: { name: 'b' } }, score: 0.1, tier: 'full' };
    const tieRes = reb.weightedRrf([tieB, tieA], [], 1);
    expect(tieRes.map((t) => t.toolKey)).toEqual(['a', 'b']);
  });

  it('computeAlpha parity matches baseline across scenarios', async () => {
    cover('src/retrieval/ranking/fusion.ts');
    const { baseline, rebuilt } = await importPair('retrieval', 'ranking', 'fusion.js');
    const scenarios = [
      [0, 0.9, 0.9, false, false],
      [5, 0.4, 0.9, false, false],
      [2, 0.9, 0.8, false, true],
      [3, 0.9, 0.4, true, false],
      [1, 0.2, 0.2, true, true],
    ];
    for (const args of scenarios) {
      expect(rebuilt.computeAlpha(...args)).toBeCloseTo(baseline.computeAlpha(...args));
    }
  });

  it('ranker export surface and ranking parity match baseline', async () => {
    cover('src/retrieval/ranking/ranker.ts');
    const { baseline, rebuilt } = await importPair('retrieval', 'ranking', 'ranker.js');
    expect(exportedKeys(rebuilt)).toEqual(exportedKeys(baseline));

    const base = new baseline.RelevanceRanker();
    const reb = new rebuilt.RelevanceRanker();
    const tools = [
      makeToolKey('z', 1),
      makeToolKey('a', 3),
      makeToolKey('b', 1),
    ];
    tools[0].score = 0.9;
    tools[1].score = 0.5;
    tools[2].score = 0.5;

    expect(reb.rank(normalize(tools))).toEqual(base.rank(normalize(tools)));
    const tied = reb.rank([
      { toolKey: 'b', toolMapping: { tool: { inputSchema: { type: 'object', properties: { x: {}, y: {} } } } }, score: 1, tier: 'full' },
      { toolKey: 'a', toolMapping: { tool: { inputSchema: { type: 'object', properties: { x: {} } } } }, score: 1, tier: 'full' },
      { toolKey: 'c', toolMapping: { tool: { inputSchema: { type: 'object' } } }, score: 0.8, tier: 'full' },
    ]);
    expect(tied.map((t) => t.toolKey)).toEqual(['b', 'a', 'c']);
  });

  it('ranking index re-exports match baseline', async () => {
    cover('src/retrieval/ranking/index.ts');
    const { baseline, rebuilt } = await importPair('retrieval', 'ranking', 'index.js');
    expect(exportedKeys(rebuilt)).toEqual(exportedKeys(baseline));
    expect(rebuilt.BMXIndex).toBeDefined();
    expect(rebuilt.RRF_K).toBe(baseline.RRF_K);
    expect(rebuilt.computeAlpha).toBe(baseline.computeAlpha);
    expect(rebuilt.weightedRrf).toBe(baseline.weightedRrf);
    expect(rebuilt.RelevanceRanker).toBe(baseline.RelevanceRanker);
  });
});

afterAll(() => {
  const missing = ASSIGNED_FILES.filter((f) => !COVERED.has(f));
  expect(missing).toEqual([]);
});
