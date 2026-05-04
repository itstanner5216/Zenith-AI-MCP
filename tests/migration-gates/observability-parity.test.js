import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { importPair, exportedKeys, expectSameResult, withTempDir } from './parity-helpers.js';

const ASSIGNED_FILES = [
  'src/retrieval/observability/replay.ts',
  'src/retrieval/observability/logger.ts',
  'src/retrieval/observability/index.ts',
  'src/retrieval/observability/metrics.ts',
];

const COVERED = new Set();
const cover = (file) => COVERED.add(file);

function makeRankingEvent(overrides = {}) {
  return {
    type: 'ranking-event',
    sessionId: 'session-1',
    group: 'control',
    scorerLatencyMs: 12,
    activeK: 5,
    routerEnumSize: 3,
    fallbackTier: 1,
    routerDescribes: [],
    activeToolIds: ['tool-a'],
    directToolCalls: ['tool-a'],
    routerProxies: [],
    alpha: 0.5,
    ...overrides,
  };
}

async function readJsonLines(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return content.trim().split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
}

describe('observability migration parity', () => {
  it('replay/logger/metrics/index export surfaces match baseline', async () => {
    const loggerPair = await importPair('retrieval', 'observability', 'logger.js');
    const metricsPair = await importPair('retrieval', 'observability', 'metrics.js');
    const replayPair = await importPair('retrieval', 'observability', 'replay.js');
    const indexPair = await importPair('retrieval', 'observability', 'index.js');

    cover('src/retrieval/observability/logger.ts');
    cover('src/retrieval/observability/metrics.ts');
    cover('src/retrieval/observability/replay.ts');
    cover('src/retrieval/observability/index.ts');

    expect(exportedKeys(loggerPair.rebuilt)).toEqual(exportedKeys(loggerPair.baseline));
    expect(exportedKeys(metricsPair.rebuilt)).toEqual(exportedKeys(metricsPair.baseline));
    expect(exportedKeys(replayPair.rebuilt)).toEqual(exportedKeys(replayPair.baseline));
    expect(exportedKeys(indexPair.rebuilt)).toEqual(exportedKeys(indexPair.baseline));
  });

  it('NullRetrievalLogger is a no-op and matches baseline behavior', async () => {
    const { baseline, rebuilt } = await importPair('retrieval', 'observability', 'logger.js');
    const baselineLogger = new baseline.NullRetrievalLogger();
    const rebuiltLogger = new rebuilt.NullRetrievalLogger();
    expect(exportedKeys(rebuilt)).toEqual(exportedKeys(baseline));

    const args = [
      ['log', [{ type: 'ranking-event', sessionId: 's1' }]],
      ['logRetrieval', [{ group: 'canary' }, [{ id: 'x' }], 42]],
      ['logRetrievalMiss', ['tool-a', { sessionId: 's2' }]],
      ['logToolSequence', ['sid', 'tool-a', 'tool-b']],
      ['logAlert', ['ALERT_NAME', 'message', { detail: true }]],
    ];
    for (const [name, callArgs] of args) {
      const [a, b] = await expectSameResult(baselineLogger[name].bind(baselineLogger), rebuiltLogger[name].bind(rebuiltLogger), ...callArgs);
      expect(b).toEqual(a);
      expect(b.ok).toBe(true);
    }
  });

  it('FileRetrievalLogger writes matching JSON lines to a temp file', async () => {
    const { baseline, rebuilt } = await importPair('retrieval', 'observability', 'logger.js');
    const originalNow = Date.now;
    Date.now = () => 1_700_000_000_000;
    try {
      await withTempDir('observability-logger-', async (dir) => {
        const basePath = path.join(dir, 'baseline.log');
        const rebuiltPath = path.join(dir, 'rebuilt.log');
        const baseLogger = new baseline.FileRetrievalLogger(basePath);
        const rebuiltLogger = new rebuilt.FileRetrievalLogger(rebuiltPath);

        await baseLogger.log(makeRankingEvent({ group: 'control', scorerLatencyMs: 15 }));
        await baseLogger.logAlert('high_latency', 'Latency exceeded', { p95: 81.5 });
        await rebuiltLogger.log(makeRankingEvent({ group: 'control', scorerLatencyMs: 15 }));
        await rebuiltLogger.logAlert('high_latency', 'Latency exceeded', { p95: 81.5 });

        const baseExists = await fs.stat(basePath).then(() => true, () => false);
        const rebuiltExists = await fs.stat(rebuiltPath).then(() => true, () => false);
        expect(baseExists).toBe(true);
        expect(rebuiltExists).toBe(true);

        const baseLines = await readJsonLines(basePath);
        const rebuiltLines = await readJsonLines(rebuiltPath);
        expect(rebuiltLines).toEqual(baseLines);
        expect(baseLines).toHaveLength(2);
        expect(baseLines[0]).toMatchObject({ type: 'ranking-event', sessionId: 'session-1', group: 'control' });
        expect(baseLines[1]).toMatchObject({ type: 'alert', alertName: 'high_latency', message: 'Latency exceeded', details: { p95: 81.5 }, timestamp: 1700000000 });
      });
    } finally {
      Date.now = originalNow;
    }
  });

  it('RollingMetrics.record and snapshot match baseline outputs', async () => {
    const { baseline, rebuilt } = await importPair('retrieval', 'observability', 'metrics.js');
    const baseMetrics = new baseline.RollingMetrics(1800);
    const rebuiltMetrics = new rebuilt.RollingMetrics(1800);

    const events = [
      makeRankingEvent({ group: 'control', scorerLatencyMs: 10, activeK: 4, routerEnumSize: 2, routerDescribes: [] }),
      makeRankingEvent({ group: 'control', scorerLatencyMs: 20, activeK: 6, routerEnumSize: 4, routerDescribes: ['desc'] }),
      makeRankingEvent({ group: 'canary', scorerLatencyMs: 30, activeK: 8, routerEnumSize: 6, routerDescribes: ['desc'], fallbackTier: 5 }),
    ];
    for (const ev of events) {
      baseMetrics.record(ev);
      rebuiltMetrics.record(ev);
    }
    baseMetrics.recordRescore();
    rebuiltMetrics.recordRescore();

    const baseSnapshot = baseMetrics.snapshot();
    const rebuiltSnapshot = rebuiltMetrics.snapshot();
    expect(rebuiltSnapshot).toEqual(baseSnapshot);
    expect(rebuiltSnapshot).toMatchObject({
      eventCount: 3,
      describeRate: 2 / 3,
      tier56Rate: 1 / 3,
      avgActiveK: 6,
      avgRouterEnumSize: 4,
    });
    expect(Array.isArray(rebuiltSnapshot)).toBe(false);
  });

  it('AlertChecker.check matches baseline alert generation across representative snapshots', async () => {
    const { baseline, rebuilt } = await importPair('retrieval', 'observability', 'metrics.js');
    const baseChecker = new baseline.AlertChecker();
    const rebuiltChecker = new rebuilt.AlertChecker();

    const snapshots = [
      { eventCount: 0, describeRate: 0, tier56Rate: 0, p95LatencyMs: 0, rescoreRate10m: 0 },
      { eventCount: 25, describeRate: 0.2, tier56Rate: 0.01, p95LatencyMs: 20, rescoreRate10m: 0 },
      { eventCount: 25, describeRate: 0.05, tier56Rate: 0.2, p95LatencyMs: 20, rescoreRate10m: 0 },
      { eventCount: 25, describeRate: 0.05, tier56Rate: 0.01, p95LatencyMs: 100, rescoreRate10m: 0 },
    ];

    for (const snapshot of snapshots) {
      const [a, b] = await expectSameResult(baseChecker.check.bind(baseChecker), rebuiltChecker.check.bind(rebuiltChecker), snapshot);
      expect(b).toEqual(a);
    }

    expect(rebuiltChecker.check({ eventCount: 0, describeRate: 0, tier56Rate: 0, p95LatencyMs: 0, rescoreRate10m: 0 })).toEqual([]);
    expect(rebuiltChecker.check({ eventCount: 25, describeRate: 0.2, tier56Rate: 0.01, p95LatencyMs: 20, rescoreRate10m: 0 }).join(' ')).toContain('HIGH_DESCRIBE_RATE');
    expect(rebuiltChecker.check({ eventCount: 25, describeRate: 0.05, tier56Rate: 0.2, p95LatencyMs: 20, rescoreRate10m: 0 }).join(' ')).toContain('HIGH_TIER56_RATE');
    expect(rebuiltChecker.check({ eventCount: 25, describeRate: 0.05, tier56Rate: 0.01, p95LatencyMs: 100, rescoreRate10m: 0 }).join(' ')).toContain('HIGH_P95_LATENCY');
  });

  it('replay functions evaluate logs, gates, combined output, and report formatting parity', async () => {
    const { baseline, rebuilt } = await importPair('retrieval', 'observability', 'replay.js');
    await withTempDir('observability-replay-', async (dir) => {
      const logPath = path.join(dir, 'replay.log');
      const events = [
        makeRankingEvent({ sessionId: 'canary-1', group: 'canary', scorerLatencyMs: 25, activeK: 5, routerEnumSize: 2, routerDescribes: ['desc'], fallbackTier: 1 }),
        makeRankingEvent({ sessionId: 'control-1', group: 'control', scorerLatencyMs: 45, activeK: 7, routerEnumSize: 4, routerDescribes: [], fallbackTier: 5 }),
        makeRankingEvent({ sessionId: 'control-2', group: 'control', scorerLatencyMs: 55, activeK: 9, routerEnumSize: 6, routerDescribes: ['desc'], fallbackTier: 5 }),
      ];
      await fs.writeFile(logPath, `${events.map((ev) => JSON.stringify(ev)).join('\n')}\n`, 'utf8');

      const [metricsA, metricsB] = await expectSameResult(baseline.evaluateReplay, rebuilt.evaluateReplay, logPath);
      expect(metricsB).toEqual(metricsA);
      expect(metricsB).toMatchObject({
        totalEvents: 3,
        sessionCount: 3,
        describeRate: 2 / 3,
        tier56Rate: 2 / 3,
        avgActiveK: 7,
        avgRouterEnumSize: 4,
      });

      const baseMetrics = await baseline.evaluateReplay(logPath);
      const rebuiltMetrics = await rebuilt.evaluateReplay(logPath);
      const baseGates = baseline.checkCutoverGates(baseMetrics, events);
      const rebuiltGates = rebuilt.checkCutoverGates(rebuiltMetrics, events);
      expect(rebuiltGates).toEqual(baseGates);
      expect(rebuiltGates).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'p95_latency', passed: expect.any(Boolean) }),
        expect.objectContaining({ name: 'tier56_rate', passed: expect.any(Boolean) }),
        expect.objectContaining({ name: 'recall_at_15', passed: expect.any(Boolean) }),
        expect.objectContaining({ name: 'describe_rate_drop', passed: expect.any(Boolean) }),
      ]));

      const [comboA, comboB] = await expectSameResult(baseline.evaluateReplayWithGates, rebuilt.evaluateReplayWithGates, logPath);
      expect(comboB).toEqual(comboA);
      expect(comboB).toMatchObject({ metrics: rebuiltMetrics, gates: rebuiltGates });

      const reportA = baseline.formatReport(rebuiltMetrics, rebuiltGates);
      const reportB = rebuilt.formatReport(rebuiltMetrics, rebuiltGates);
      expect(reportB).toEqual(reportA);
      expect(reportB).toContain('BMXF Rollout Replay Report');
      expect(reportB).toContain('Cutover Gates');
      expect(reportB).toContain('Overall:');
    });
  });

  it('observability index re-exports are identical to direct module exports', async () => {
    const directLogger = await importPair('retrieval', 'observability', 'logger.js');
    const directMetrics = await importPair('retrieval', 'observability', 'metrics.js');
    const directReplay = await importPair('retrieval', 'observability', 'replay.js');
    const indexPair = await importPair('retrieval', 'observability', 'index.js');

    const directExports = {
      ...directLogger.rebuilt,
      ...directMetrics.rebuilt,
      ...directReplay.rebuilt,
    };
    expect(exportedKeys(indexPair.rebuilt)).toEqual(exportedKeys(directExports));
    expect(indexPair.rebuilt.NullRetrievalLogger).toBe(directLogger.rebuilt.NullRetrievalLogger);
    expect(indexPair.rebuilt.FileRetrievalLogger).toBe(directLogger.rebuilt.FileRetrievalLogger);
    expect(indexPair.rebuilt.RollingMetrics).toBe(directMetrics.rebuilt.RollingMetrics);
    expect(indexPair.rebuilt.AlertChecker).toBe(directMetrics.rebuilt.AlertChecker);
    expect(indexPair.rebuilt.evaluateReplay).toBe(directReplay.rebuilt.evaluateReplay);
  });
});

afterAll(() => {
  const missing = ASSIGNED_FILES.filter((f) => !COVERED.has(f));
  expect(missing).toEqual([]);
});
