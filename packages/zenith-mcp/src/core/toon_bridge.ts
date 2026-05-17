import { getCompressionStructure, getLangForFile } from './tree-sitter.js';
import { compressSourceStructured, compressString } from 'zenith-toon';
import type { StructureBlock } from 'zenith-toon';

/**
 * Compress source text using tree-sitter structure + toon codec.
 * Falls back to unstructured compression when tree-sitter can't parse.
 */
export async function compressToon(
    content: string,
    budget: number,
    filePath?: string,
): Promise<string> {
    if (content.length <= budget) return content;

    let structure: StructureBlock[] | null = null;
    const langName = filePath ? getLangForFile(filePath) : null;

    if (langName) {
        try {
            const defs = await getCompressionStructure(content, langName);
            if (defs && defs.length > 0) {
                structure = defs.map((d) => ({
                    name: d.name,
                    kind: d.type,
                    type: d.type,
                    startLine: d.startLine,
                    endLine: d.endLine,
                    exported: d.exported ?? false,
                    anchors: d.anchors ?? [],
                }));
            }
        } catch {
            // tree-sitter unavailable or parse failed — fall through to unstructured
        }
    }

    return structure
        ? compressSourceStructured(content, budget, structure)
        : compressString(content, budget);
}
