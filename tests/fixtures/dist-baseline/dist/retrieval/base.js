export class ToolRetriever {
}
export class PassthroughRetriever extends ToolRetriever {
    async retrieve(_context, candidates) {
        return candidates.map((m, i) => ({
            toolKey: `passthrough_${i}`,
            toolMapping: m,
            score: 1.0,
            tier: "full",
        }));
    }
}
//# sourceMappingURL=base.js.map