import { createHash } from "node:crypto";
export function mergeEvidence(roots) {
    const merged = {};
    for (const root of roots) {
        for (const [tok, weight] of Object.entries(root.tokens)) {
            merged[tok] = (merged[tok] ?? 0) + weight;
        }
    }
    const confidence = roots.length > 0 ? roots.reduce((s, r) => s + r.confidence, 0) / roots.length : 0.0;
    const canonical = JSON.stringify(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
    const workspaceHash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
    return {
        roots,
        workspaceConfidence: confidence,
        mergedTokens: merged,
        workspaceHash,
    };
}
export function fingerprintEvidence(foundFiles) {
    const canonical = JSON.stringify([...foundFiles].sort());
    return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}
//# sourceMappingURL=evidence.js.map