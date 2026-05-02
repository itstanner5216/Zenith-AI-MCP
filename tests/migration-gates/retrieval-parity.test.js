import { describe, it, expect, afterAll } from 'vitest';
import { importPair, exportedKeys, expectSameResult, withTempDir } from './parity-helpers.js';

const ASSIGNED_FILES = [
  'src/retrieval/models.ts',
  'src/retrieval/base.ts',
  'src/retrieval/session.ts',
  'src/retrieval/catalog.ts',
  'src/retrieval/assembler.ts',
  'src/retrieval/routing-tool.ts',
  'src/retrieval/pipeline.ts',
  'src/retrieval/zenith-tool-registry.ts',
  'src/retrieval/zenith-integration.ts',
  'src/retrieval/static-categories.ts',
  'src/retrieval/index.ts',
];

const COVERED = new Set();
const cover = (file) => COVERED.add(file);

function cloneableTool(name = 'sample_tool') {
  return {
    name,
    description: 'Tool desc with enough detail to test summary truncation. This should be preserved or truncated consistently.',
    inputSchema: {
      type: 'object',
      properties: {
        alpha: { type: 'string', description: 'alpha property description' },
        beta: { type: 'number', description: 'beta property description' },
      },
      required: ['alpha'],
    },
  };
}

function makeMapping(serverName, tool) {
  return { serverName, tool, handler: () => 'handled' };
}

function normalizeJson(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('retrieval migration parity', () => {
  it('models export surface and default/factory behavior match', async () => {
    cover('src/retrieval/models.ts');
    const { baseline, rebuilt } = await importPair('retrieval', 'models.js');
    expect(exportedKeys(rebuilt)).toEqual(exportedKeys(baseline));

    expect(rebuilt.defaultRetrievalConfig()).toEqual(baseline.defaultRetrievalConfig());
    expect(rebuilt.defaultRetrievalConfig({ enabled: true, topK: 7, anchorTools: ['a'], rolloutStage: 'ga' }))
      .toEqual(baseline.defaultRetrievalConfig({ enabled: true, topK: 7, anchorTools: ['a'], rolloutStage: 'ga' }));

    expect(rebuilt.createRetrievalContext('sid-1')).toEqual(baseline.createRetrievalContext('sid-1'));
    expect(rebuilt.createRetrievalContext('sid-2', { query: 'hello', queryMode: 'nl', toolCallHistory: ['t1'] }))
      .toEqual(baseline.createRetrievalContext('sid-2', { query: 'hello', queryMode: 'nl', toolCallHistory: ['t1'] }));
  });

  it('base export surface matches and passthrough retriever preserves candidate order', async () => {
    cover('src/retrieval/base.ts');
    const { baseline, rebuilt } = await importPair('retrieval', 'base.js');
    expect(exportedKeys(rebuilt)).toEqual(exportedKeys(baseline));

    const ctx = { sessionId: 's', query: '', toolCallHistory: [], queryMode: 'env' };
    const candidates = [
      { serverName: 'x', tool: cloneableTool('a') },
      { serverName: 'y', tool: cloneableTool('b') },
    ];
    const [a, b] = await expectSameResult(
      async (c, cand) => new baseline.PassthroughRetriever().retrieve(c, cand),
      async (c, cand) => new rebuilt.PassthroughRetriever().retrieve(c, cand),
      ctx,
      candidates,
    );
    expect(b).toEqual(a);
  });

  it('session state manager manages copies, promote/demote, and cleanup identically', async () => {
    cover('src/retrieval/session.ts');
    const { baseline, rebuilt } = await importPair('retrieval', 'session.js');
    expect(exportedKeys(rebuilt)).toEqual(exportedKeys(baseline));

    const cfgA = baseline.defaultRetrievalConfig({ anchorTools: ['anchor-a', 'anchor-b'] });
    const cfgB = rebuilt.defaultRetrievalConfig({ anchorTools: ['anchor-a', 'anchor-b'] });
    const sA = new baseline.SessionStateManager(cfgA);
    const sB = new rebuilt.SessionStateManager(cfgB);

    const copyA = sA.getOrCreateSession('sid');
    const copyB = sB.getOrCreateSession('sid');
    expect([...copyB]).toEqual([...copyA]);
    copyA.add('mutated');
    expect([...sA.getActiveTools('sid')]).toEqual([...sB.getActiveTools('sid')]);

    expect(sA.addTools('sid', ['anchor-a', 'x', 'y'])).toEqual(sB.addTools('sid', ['anchor-a', 'x', 'y']));
    expect([...sA.getActiveTools('sid')]).toEqual([...sB.getActiveTools('sid')]);
    expect(sA.promote('sid', ['y', 'z'])).toEqual(sB.promote('sid', ['y', 'z']));
    expect([...sA.getActiveTools('sid')]).toEqual([...sB.getActiveTools('sid')]);
    expect(sA.demote('sid', ['anchor-a', 'x', 'z'], new Set(['z']), 2)).toEqual(sB.demote('sid', ['anchor-a', 'x', 'z'], new Set(['z']), 2));
    expect([...sA.getActiveTools('sid')]).toEqual([...sB.getActiveTools('sid')]);
    sA.cleanupSession('sid');
    sB.cleanupSession('sid');
    expect([...sA.getActiveTools('sid')]).toEqual([...sB.getActiveTools('sid')]);
  });

  it('catalog buildSnapshot has stable hash and monotonically increases version', async () => {
    cover('src/retrieval/catalog.ts');
    const { baseline, rebuilt } = await importPair('retrieval', 'catalog.js');
    expect(exportedKeys(rebuilt)).toEqual(exportedKeys(baseline));

    const registry = {
      'alpha__one': makeMapping('alpha', cloneableTool('one')),
      'beta__two': makeMapping('beta', cloneableTool('two')),
    };
    const base1 = baseline.buildSnapshot(registry);
    const rebuilt1 = rebuilt.buildSnapshot(registry);
    const base2 = baseline.buildSnapshot(registry);
    const rebuilt2 = rebuilt.buildSnapshot(registry);
    expect(normalizeJson(rebuilt1)).toEqual(normalizeJson(base1));
    expect(rebuilt2.schemaHash).toBe(rebuilt1.schemaHash);
    expect(Number(rebuilt2.version)).toBeGreaterThan(Number(rebuilt1.version));
    expect(rebuilt1.docs.map((d) => d.toolKey)).toEqual(['alpha__one', 'beta__two']);
  });

  it('assembler tiering and routing-tool schema shape match', async () => {
    cover('src/retrieval/assembler.ts');
    cover('src/retrieval/routing-tool.ts');
    const { baseline: ab, rebuilt: ar } = await importPair('retrieval', 'assembler.js');
    const { baseline: rb, rebuilt: rr } = await importPair('retrieval', 'routing-tool.js');
    expect(exportedKeys(ar)).toEqual(exportedKeys(ab));
    expect(exportedKeys(rr)).toEqual(exportedKeys(rb));

    const toolA = cloneableTool('tool-a');
    const toolB = cloneableTool('tool-b');
    const scoredBase = [
      { toolKey: 'a', toolMapping: makeMapping('ns', toolA), score: 1, tier: 'summary' },
      { toolKey: 'b', toolMapping: makeMapping('ns', toolB), score: 0.5, tier: 'summary' },
    ];
    const scoredRebuilt = [
      { toolKey: 'a', toolMapping: makeMapping('ns', cloneableTool('tool-a')), score: 1, tier: 'summary' },
      { toolKey: 'b', toolMapping: makeMapping('ns', cloneableTool('tool-b')), score: 0.5, tier: 'summary' },
    ];
    const configBase = baseline.defaultRetrievalConfig({ fullDescriptionCount: 1 });
    const configRebuilt = rebuilt.defaultRetrievalConfig({ fullDescriptionCount: 1 });
    const baseTools = new baseline.TieredAssembler().assemble(scoredBase, configBase, rb.buildRoutingToolSchema(['a']));
    const rebuiltTools = new rebuilt.TieredAssembler().assemble(scoredRebuilt, configRebuilt, rr.buildRoutingToolSchema(['a']));
    expect(normalizeJson(rebuiltTools)).toEqual(normalizeJson(baseTools));
    expect(rr.ROUTING_TOOL_NAME).toBe(rb.ROUTING_TOOL_NAME);
    expect(rr.ROUTING_TOOL_KEY).toBe(rb.ROUTING_TOOL_KEY);
    const schema = rr.buildRoutingToolSchema(['ns__tool1', 'ns__tool2']);
    expect(schema.name).toBe('request_tool');
    expect(schema.description).toContain('Access tools not in your active set');
    expect(schema.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        name: { type: 'string', enum: ['ns__tool1', 'ns__tool2'] },
        describe: { type: 'boolean', default: false },
        arguments: { type: 'object', default: {} },
      },
      required: ['name'],
    });
  });

  it('pipeline tokenization and static categories export surfaces match', async () => {
    cover('src/retrieval/pipeline.ts');
    cover('src/retrieval/static-categories.ts');
    const { baseline, rebuilt } = await importPair('retrieval', 'pipeline.js');
    const { baseline: sb, rebuilt: sr } = await importPair('retrieval', 'static-categories.js');
    expect(exportedKeys(rebuilt)).toEqual(exportedKeys(baseline));
    expect(exportedKeys(sr)).toEqual(exportedKeys(sb));

    const cases = [
      'List-files_and-fetch 123 the FILES',
      'Create a new tool for lookup lookup',
      'run_execute and modify data',
      '',
    ];
    for (const input of cases) {
      expect(rebuilt.extractConversationTerms(input)).toBe(baseline.extractConversationTerms(input));
    }
    expect(rebuilt.extractConversationTerms('List files')).toContain('list files');
    expect(rebuilt.extractConversationTerms('create')).toContain('add');
    expect(rebuilt.STATIC_CATEGORIES).toEqual(baseline.STATIC_CATEGORIES);
    expect(rebuilt.TIER6_NAMESPACE_PRIORITY).toEqual(baseline.TIER6_NAMESPACE_PRIORITY);
  });

  it('zenith tool registry register/unregister/get/list/asRecord/asLiveRecord/hash parity holds', async () => {
    cover('src/retrieval/zenith-tool-registry.ts');
    const { baseline, rebuilt } = await importPair('retrieval', 'zenith-tool-registry.js');
    expect(exportedKeys(rebuilt)).toEqual(exportedKeys(baseline));

    const tool1 = cloneableTool('alpha');
    const tool2 = cloneableTool('beta');
    const base = new baseline.ZenithToolRegistry();
    const reb = new rebuilt.ZenithToolRegistry();

    expect(base.register(normalizeJson(tool1), 'h1')).toEqual(reb.register(normalizeJson(tool1), 'h1'));
    expect(base.register(normalizeJson(tool2), 'h2')).toEqual(reb.register(normalizeJson(tool2), 'h2'));
    expect(base.hash()).toBe(reb.hash());
    expect(base.get('zenith__alpha')).toEqual(reb.get('zenith__alpha'));
    expect(base.list()).toEqual(reb.list());
    expect(base.asRecord()).toEqual(reb.asRecord());
    expect(Object.keys(base.asLiveRecord()).sort()).toEqual(Object.keys(reb.asLiveRecord()).sort());
    expect(base.unregister('alpha')).toBe(reb.unregister('alpha'));
    expect(base.get('zenith__alpha')).toEqual(reb.get('zenith__alpha'));
  });

  it('zenith integration exports and factory behavior match without comparing rebuilt to rebuilt', async () => {
    cover('src/retrieval/zenith-integration.ts');
    const { baseline, rebuilt } = await importPair('retrieval', 'zenith-integration.js');
    expect(exportedKeys(rebuilt)).toEqual(exportedKeys(baseline));

    const registryBase = new baseline.ZenithToolRegistry();
    const registryRebuilt = new rebuilt.ZenithToolRegistry();
    registryBase.register(cloneableTool('sample_tool'), 'handler');
    registryRebuilt.register(cloneableTool('sample_tool'), 'handler');

    const configBase = baseline.defaultRetrievalConfig();
    const configRebuilt = rebuilt.defaultRetrievalConfig();
    expect(baseline.createRetrievalPipelineForZenith({ registry: registryBase, config: configBase })).toBeTruthy();
    expect(rebuilt.createRetrievalPipelineForZenith({ registry: registryRebuilt, config: configRebuilt })).toBeTruthy();
    expect(
      Object.keys(baseline.createRetrievalAwareToolRegistrar({ registerTool() { return {}; } }, registryBase)).sort(),
    ).toEqual(Object.keys(rebuilt.createRetrievalAwareToolRegistrar({ registerTool() { return {}; } }, registryRebuilt)).sort());
  });

  it('side-effectful session-root bridging is parity-safe in temp dirs', async () => {
    cover('src/retrieval/zenith-integration.ts');
    await withTempDir('retrieval-migration-', async () => {
      const { baseline, rebuilt } = await importPair('retrieval', 'zenith-integration.js');
      const callsBase = [];
      const callsRebuilt = [];
      const pipelineBase = { setSessionRoots: async (...args) => callsBase.push(args) };
      const pipelineRebuilt = { setSessionRoots: async (...args) => callsRebuilt.push(args) };
      await baseline.setSessionRootsFromMcpRoots(pipelineBase, 'sid', [{ uri: 'file:///a' }, { uri: 'file:///b' }]);
      await rebuilt.setSessionRootsFromMcpRoots(pipelineRebuilt, 'sid', [{ uri: 'file:///a' }, { uri: 'file:///b' }]);
      expect(callsRebuilt).toEqual(callsBase);
    });
  });

  it('retrieval index re-exports match baseline', async () => {
    cover('src/retrieval/index.ts');
    const { baseline, rebuilt } = await importPair('retrieval', 'index.js');
    expect(exportedKeys(rebuilt)).toEqual(exportedKeys(baseline));

    // Verify key re-exports match
    expect(rebuilt.createRetrievalContext).toBe(baseline.createRetrievalContext);
    expect(rebuilt.defaultRetrievalConfig).toBe(baseline.defaultRetrievalConfig);
    expect(rebuilt.SessionStateManager).toBe(baseline.SessionStateManager);
    expect(rebuilt.buildSnapshot).toBe(baseline.buildSnapshot);
    expect(rebuilt.TieredAssembler).toBe(baseline.TieredAssembler);
    expect(rebuilt.PassthroughRetriever).toBe(baseline.PassthroughRetriever);
    expect(rebuilt.RRF_K).toBe(baseline.RRF_K);
    expect(rebuilt.RetrievalPipeline).toBe(baseline.RetrievalPipeline);
    expect(rebuilt.extractConversationTerms).toBe(baseline.extractConversationTerms);
    expect(rebuilt.ZenithToolRegistry).toBe(baseline.ZenithToolRegistry);
    expect(rebuilt.createRetrievalPipelineForZenith).toBe(baseline.createRetrievalPipelineForZenith);
    expect(rebuilt.STATIC_CATEGORIES).toEqual(baseline.STATIC_CATEGORIES);
  });
});

afterAll(() => {
  const missing = ASSIGNED_FILES.filter((f) => !COVERED.has(f));
  expect(missing).toEqual([]);
});
