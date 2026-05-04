const MAX_SUMMARY_CHARS = 80;
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;
function truncateDescription(desc) {
    if (!desc || desc.length <= MAX_SUMMARY_CHARS)
        return desc;
    // Try first sentence
    const parts = desc.split(SENTENCE_BOUNDARY, 2);
    if (parts.length > 1 && parts[0].length <= MAX_SUMMARY_CHARS) {
        return parts[0];
    }
    // Fall back to char limit
    return desc.slice(0, MAX_SUMMARY_CHARS).trimEnd() + "…";
}
function stripDescriptions(schema) {
    if (!isObject(schema))
        return schema;
    const result = {};
    for (const [key, value] of Object.entries(schema)) {
        if (key === "description")
            continue;
        if (key === "properties" && isObject(value)) {
            result[key] = Object.fromEntries(Object.entries(value).map(([propName, propVal]) => [
                propName,
                stripDescriptions(propVal),
            ]));
        }
        else if (key === "items" && isObject(value)) {
            result[key] = stripDescriptions(value);
        }
        else if (isObject(value)) {
            result[key] = stripDescriptions(value);
        }
        else {
            result[key] = value;
        }
    }
    return result;
}
function isObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
export class TieredAssembler {
    assemble(tools, config, routingToolSchema) {
        const result = [];
        if (tools.length === 0 && !routingToolSchema) {
            return result;
        }
        for (let i = 0; i < tools.length; i++) {
            const scored = tools[i];
            const original = scored.toolMapping.tool;
            if (i < config.fullDescriptionCount) {
                scored.tier = "full";
                result.push({
                    name: original.name,
                    description: original.description ?? "",
                    inputSchema: structuredClone(original.inputSchema ?? {}),
                });
            }
            else {
                scored.tier = "summary";
                result.push({
                    name: original.name,
                    description: truncateDescription(original.description ?? ""),
                    inputSchema: stripDescriptions(structuredClone(original.inputSchema ?? {})),
                });
            }
        }
        if (routingToolSchema) {
            result.push(routingToolSchema);
        }
        return result;
    }
}
//# sourceMappingURL=assembler.js.map