const SCORE_TOLERANCE = 0.05;
function getSpecificity(scored) {
    const schema = scored.toolMapping.tool.inputSchema;
    if (typeof schema === "object" && schema !== null) {
        const props = schema["properties"];
        if (typeof props === "object" && props !== null) {
            return Object.keys(props).length;
        }
    }
    return 0;
}
export class RelevanceRanker {
    rank(tools) {
        if (tools.length === 0)
            return [];
        const byScore = [...tools].sort((a, b) => {
            if (b.score > a.score)
                return 1;
            if (b.score < a.score)
                return -1;
            return a.toolKey.localeCompare(b.toolKey);
        });
        const ranked = [];
        let tiedGroup = [];
        let groupScore = null;
        for (const tool of byScore) {
            if (groupScore === null || Math.abs(groupScore - tool.score) < SCORE_TOLERANCE) {
                tiedGroup.push(tool);
                if (groupScore === null)
                    groupScore = tool.score;
                continue;
            }
            tiedGroup.sort((a, b) => {
                const sa = getSpecificity(a);
                const sb = getSpecificity(b);
                if (sb !== sa)
                    return sb - sa;
                return a.toolKey.localeCompare(b.toolKey);
            });
            ranked.push(...tiedGroup);
            tiedGroup = [tool];
            groupScore = tool.score;
        }
        tiedGroup.sort((a, b) => {
            const sa = getSpecificity(a);
            const sb = getSpecificity(b);
            if (sb !== sa)
                return sb - sa;
            return a.toolKey.localeCompare(b.toolKey);
        });
        ranked.push(...tiedGroup);
        return ranked;
    }
}
//# sourceMappingURL=ranker.js.map