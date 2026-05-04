import type { RankingEvent } from "../models.js";
export interface MetricSnapshot {
    eventCount: number;
    describeRate: number;
    tier56Rate: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    avgActiveK: number;
    avgRouterEnumSize: number;
    rescoreRate30m: number;
    rescoreRate10m: number;
}
export declare class RollingMetrics {
    private readonly _windowMs;
    private _events;
    private _rescoreTimes;
    constructor(windowSeconds?: number);
    record(event: RankingEvent): void;
    recordRescore(): void;
    private _evict;
    private _evictRescore;
    snapshot(group?: string): MetricSnapshot;
}
export declare const ALERT_DESCRIBE_RATE = 0.1;
export declare const ALERT_TIER56_RATE = 0.05;
export declare const ALERT_P95_MS = 75;
export declare const ALERT_RESCORE_RATE = 0.2;
export declare class AlertChecker {
    private readonly _describeRate;
    private readonly _tier56Rate;
    private readonly _p95Ms;
    private readonly _rescoreThreshold;
    constructor(describeRate?: number, tier56Rate?: number, p95Ms?: number, rescoreThreshold?: number);
    check(snapshot: MetricSnapshot): string[];
}
