export interface ReplayMetrics {
    totalEvents: number;
    sessionCount: number;
    avgActiveK: number;
    describeRate: number;
    tier56Rate: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    avgAlpha: number;
    avgRouterEnumSize: number;
    canaryEvents: number;
    controlEvents: number;
    recallAt15: number;
    canaryRecall: number;
    controlRecall: number;
    canaryDescribeRate: number;
    controlDescribeRate: number;
}
export interface CutoverGate {
    name: string;
    passed: boolean;
    threshold: number;
    actual: number;
    message: string;
}
interface RawEvent {
    sessionId?: string;
    scorerLatencyMs?: number;
    activeK?: number;
    routerDescribes?: string[];
    fallbackTier?: number;
    routerEnumSize?: number;
    alpha?: number;
    group?: string;
    directToolCalls?: string[];
    routerProxies?: string[];
    activeToolIds?: string[];
    type?: string;
}
export declare function evaluateReplay(logPath: string): Promise<ReplayMetrics>;
export declare function checkCutoverGates(metrics: ReplayMetrics, events?: RawEvent[]): CutoverGate[];
export declare function evaluateReplayWithGates(logPath: string): Promise<{
    metrics: ReplayMetrics;
    gates: CutoverGate[];
}>;
export declare function formatReport(metrics: ReplayMetrics, gates: CutoverGate[]): string;
export {};
