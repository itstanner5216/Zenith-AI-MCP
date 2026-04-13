import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { minimatch } from "minimatch";
import { DEFAULT_EXCLUDES } from '../shared.js';
import { isSupported, getFileSymbolSummary, getFileSymbols } from '../tree-sitter.js';

export function register(server, ctx) {
    server.registerTool("directory_tree", {
        title: "Directory Tree",
        description: "Recursive tree view as indented text. Directories end with '/', files may include symbol metadata.",
        inputSchema: {
            path: z.string(),
            excludePatterns: z.array(z.string()).optional().default([]),
            showSymbols: z.boolean().optional().default(false).describe("Add symbol summary string to each supported file (e.g. '3 functions, 1 class')."),
            showSymbolNames: z.boolean().optional().default(false).describe("Add full list of definition names to each supported file. Implies showSymbols. More detailed but larger output.")
        },
        annotations: { readOnlyHint: true }
    }, async (args) => {
        const rootPath = args.path;
        const showSymbols = args.showSymbols || args.showSymbolNames || false;
        const showSymbolNames = args.showSymbolNames || false;
        let totalEntries = 0;
        const MAX_ENTRIES = 500;

        async function buildTree(currentPath, excludePatterns = []) {
            if (totalEntries >= MAX_ENTRIES) return [];
            const validPath = await ctx.validatePath(currentPath);
            const entries = await fs.readdir(validPath, { withFileTypes: true });
            const result = [];

            const fileEntries = [];
            const dirEntries = [];

            for (const entry of entries) {
                const relativePath = path.relative(rootPath, path.join(currentPath, entry.name));
                const shouldExclude = excludePatterns.some(pattern => {
                    if (pattern.includes('*')) return minimatch(relativePath, pattern, { dot: true });
                    return minimatch(relativePath, pattern, { dot: true }) ||
                        minimatch(relativePath, `**/${pattern}`, { dot: true }) ||
                        minimatch(relativePath, `**/${pattern}/**`, { dot: true });
                });
                const shouldExcludeByDefault = DEFAULT_EXCLUDES.some(p =>
                    entry.name === p ||
                    minimatch(relativePath, p, { dot: true }) ||
                    minimatch(relativePath, `**/${p}`, { dot: true })
                );
                if (shouldExclude || shouldExcludeByDefault) continue;

                if (entry.isDirectory()) {
                    dirEntries.push(entry);
                } else {
                    fileEntries.push(entry);
                }
            }

            let symbolResults = null;
            if (showSymbols && fileEntries.length > 0) {
                const promises = fileEntries.map(async (entry) => {
                    const fullPath = path.join(currentPath, entry.name);
                    if (!isSupported(fullPath)) return [entry.name, null, null];
                    try {
                        if (showSymbolNames) {
                            const symbols = await getFileSymbols(fullPath, { kindFilter: 'def' });
                            if (!symbols || symbols.length === 0) return [entry.name, null, null];
                            const names = symbols.slice(0, 50).map(s => `${s.name} (${s.type})`);
                            const summary = await getFileSymbolSummary(fullPath);
                            return [entry.name, summary, names];
                        } else {
                            const summary = await getFileSymbolSummary(fullPath);
                            return [entry.name, summary, null];
                        }
                    } catch {
                        return [entry.name, null, null];
                    }
                });
                const results = await Promise.all(promises);
                symbolResults = new Map(results.map(([name, summary, names]) => [name, { summary, names }]));
            }

            for (const entry of dirEntries) {
                if (totalEntries >= MAX_ENTRIES) break;
                const entryData = {
                    name: entry.name,
                    children: await buildTree(path.join(currentPath, entry.name), excludePatterns)
                };
                result.push(entryData);
                totalEntries++;
            }

            for (const entry of fileEntries) {
                if (totalEntries >= MAX_ENTRIES) break;
                const entryData = { name: entry.name };

                if (symbolResults) {
                    const info = symbolResults.get(entry.name);
                    if (info && info.summary) {
                        entryData.symbols = info.summary;
                    }
                    if (info && info.names) {
                        entryData.symbolNames = info.names;
                    }
                }

                result.push(entryData);
                totalEntries++;
            }

            return result;
        }

        const treeData = await buildTree(rootPath, args.excludePatterns);

        function escapeControlChars(str) {
            return str.replace(/[\x00-\x1F\x7F]/g, (char) => {
                const code = char.charCodeAt(0);
                if (code === 0x09) return '\\t';
                if (code === 0x0A) return '\\n';
                if (code === 0x0D) return '\\r';
                return `\\x${code.toString(16).padStart(2, '0')}`;
            });
        }

        function formatIndent(entries, depth = 0) {
            const lines = [];
            const indent = '  '.repeat(depth);
            for (const entry of entries) {
                if (entry.children) {
                    lines.push(`${indent}${escapeControlChars(entry.name)}/`);
                    lines.push(...formatIndent(entry.children, depth + 1));
                } else {
                    let suffix = '';
                    if (entry.symbols) suffix += `  (${escapeControlChars(entry.symbols)})`;
                    if (entry.symbolNames) {
                        const sanitizedNames = entry.symbolNames.map(escapeControlChars);
                        suffix += `  [${sanitizedNames.join(', ')}]`;
                    }
                    lines.push(`${indent}${escapeControlChars(entry.name)}${suffix}`);
                }
            }
            return lines;
        }

        const textLines = formatIndent(treeData);
        const text = textLines.join('\n') + (totalEntries >= MAX_ENTRIES ? '\n## truncated ##' : '');
        return {
            content: [{ type: "text", text }],
        };
    });
}
