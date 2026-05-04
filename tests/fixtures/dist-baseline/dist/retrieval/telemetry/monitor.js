import { performance } from "node:perf_hooks";
export class RootMonitor {
    _scanner;
    _rootUris;
    _threshold;
    _minDebounceMs;
    _now;
    _pollScheduleIdx = 0;
    _pollSchedule = [5000, 10000, 20000, 30000];
    _lastPollTime = 0.0;
    _lastTriggerTime = 0.0;
    _cumulativeSignificance = 0.0;
    _idlePollCount = 0;
    constructor(options = {}) {
        this._scanner = options.scanner;
        this._rootUris = [...(options.rootUris ?? [])];
        this._threshold = options.significanceThreshold ?? 0.7;
        this._minDebounceMs = options.minDebounceMs ?? 10_000;
        this._now = options.now ?? (() => performance.now());
    }
    get pollIntervalMs() {
        return this._pollSchedule[Math.min(this._pollScheduleIdx, this._pollSchedule.length - 1)];
    }
    shouldPoll() {
        return (this._now() - this._lastPollTime) >= this.pollIntervalMs;
    }
    get rootUris() {
        return [...this._rootUris];
    }
    setRootUris(uris) {
        this._rootUris = [...uris];
    }
    async poll(rootUris) {
        this._lastPollTime = this._now();
        let significance;
        if (this._scanner === undefined) {
            significance = 0.0;
        }
        else {
            const activeUris = rootUris ?? this._rootUris;
            if (activeUris.length === 0) {
                console.warn("RootMonitor.poll() skipped: no root URIs configured");
                significance = 0.0;
            }
            else {
                try {
                    const evidence = await this._scanner.scanRoots(activeUris);
                    significance = this._estimateSignificance(evidence);
                }
                catch (exc) {
                    console.warn(`Scanner failed during poll: ${exc}`);
                    significance = 0.0;
                }
            }
        }
        this.recordChange(significance);
        if (significance < this._threshold * 0.3) {
            this._idlePollCount++;
            if (this._idlePollCount >= 2) {
                this._pollScheduleIdx = Math.min(this._pollScheduleIdx + 1, this._pollSchedule.length - 1);
                this._idlePollCount = 0;
            }
        }
        else {
            this._pollScheduleIdx = 0;
            this._idlePollCount = 0;
        }
        return significance;
    }
    recordChange(significance) {
        this._cumulativeSignificance += Math.max(0.0, significance);
    }
    checkForChanges() {
        if (this._cumulativeSignificance < this._threshold) {
            return false;
        }
        const now = this._now();
        if ((now - this._lastTriggerTime) < this._minDebounceMs) {
            return false;
        }
        this._lastTriggerTime = now;
        return true;
    }
    acknowledge() {
        this._cumulativeSignificance = 0.0;
        this._lastTriggerTime = this._now();
        this._pollScheduleIdx = 0;
        this._idlePollCount = 0;
    }
    reset() {
        this._pollScheduleIdx = 0;
        this._lastPollTime = 0.0;
        this._lastTriggerTime = 0.0;
        this._cumulativeSignificance = 0.0;
        this._idlePollCount = 0;
    }
    _estimateSignificance(evidence) {
        if (evidence === null || evidence === undefined)
            return 0.0;
        return evidence.workspaceConfidence;
    }
}
//# sourceMappingURL=monitor.js.map