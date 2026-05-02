// ─── Factory helpers ────────────────────────────────────────────────────────
export function defaultRetrievalConfig(overrides) {
    return {
        enabled: false,
        topK: 15,
        fullDescriptionCount: 3,
        anchorTools: [],
        shadowMode: false,
        scorer: "bmxf",
        maxK: 20,
        enableRoutingTool: true,
        enableTelemetry: true,
        telemetryPollInterval: 30,
        canaryPercentage: 0.0,
        rolloutStage: "shadow",
        ...overrides,
    };
}
export function createRetrievalContext(sessionId, overrides) {
    return {
        sessionId,
        query: "",
        toolCallHistory: [],
        serverHint: undefined,
        queryMode: "env",
        ...overrides,
    };
}
//# sourceMappingURL=models.js.map