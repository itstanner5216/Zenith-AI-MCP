import type { TelemetryScanner } from "./scanner.js";
export interface RootMonitorOptions {
    scanner?: TelemetryScanner;
    significanceThreshold?: number;
    minDebounceMs?: number;
    rootUris?: string[];
    now?: () => number;
}
export declare class RootMonitor {
    private readonly _scanner?;
    private _rootUris;
    private readonly _threshold;
    private readonly _minDebounceMs;
    private readonly _now;
    private _pollScheduleIdx;
    private readonly _pollSchedule;
    private _lastPollTime;
    private _lastTriggerTime;
    private _cumulativeSignificance;
    private _idlePollCount;
    constructor(options?: RootMonitorOptions);
    get pollIntervalMs(): number;
    shouldPoll(): boolean;
    get rootUris(): string[];
    setRootUris(uris: string[]): void;
    poll(rootUris?: string[]): Promise<number>;
    recordChange(significance: number): void;
    checkForChanges(): boolean;
    acknowledge(): void;
    reset(): void;
    private _estimateSignificance;
}
