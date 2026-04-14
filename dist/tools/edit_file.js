import { z } from "zod";
import fs from "fs/promises";
import path from 'path';
import { randomBytes } from 'crypto';
import { normalizeLineEndings, createMinimalDiff } from '../core/lib.js';
import { getLangForFile, findSymbol, checkSyntaxErrors } from '../core/tree-sitter.js';

// Cache for failed edits — allows retry without resending newText.
const _pendingRetries = new Map();
const RETRY_TTL_MS = 120 * 1000;

function cachePendingBatch(filePath, edits) {
    _pendingRetries.set(filePath, { edits, timestamp: Date.now() });
}

function getCachedNewText(filePath, index) {
    const entry = _pendingRetries.get(filePath);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > RETRY_TTL_MS) {
        _pendingRetries.delete(filePath);
        return undefined;
    }
    return entry.edits[index]?.newText;
}

function clearPendingBatch(filePath) {
    _pendingRetries.delete(filePath);
}


function findMatch(content, oldText, nearLine) {
    const normalizedOld = normalizeLineEndings(oldText);

    // Strategy 1: Exact match
    const exactIdx = findOccurrence(content, normalizedOld, nearLine);
    if (exactIdx !== -1) {
        return { index: exactIdx, matchedText: normalizedOld, strategy: 'exact' };
    }

    // Strategy 2: Trimmed trailing whitespace match
    const contentLinesTrimmed = content.split('\n').map(l => l.trimEnd());
    const oldLinesTrimmed = normalizedOld.split('\n').map(l => l.trimEnd());
    const trimmedContent = contentLinesTrimmed.join('\n');
    const trimmedOld = oldLinesTrimmed.join('\n');
    const trimIdx = findOccurrence(trimmedContent, trimmedOld, nearLine);
    if (trimIdx !== -1) {
        const origIdx = mapTrimmedIndex(content, trimmedContent, trimIdx, trimmedOld.length);
        if (origIdx !== -1) {
            const endPos = findOriginalEnd(content, origIdx, oldLinesTrimmed.length);
            return { index: origIdx, matchedText: content.slice(origIdx, endPos), strategy: 'trim-trailing' };
        }
    }

    // Strategy 3: Indentation-stripped match
    const oldLines = normalizedOld.split('\n');
    const contentLines = content.split('\n');
    const strippedOld = oldLines.map(l => l.trim());

    const searchStart = nearLine ? Math.max(0, nearLine - 50) : 0;
    const searchEnd = nearLine ? Math.min(contentLines.length, nearLine + 50) : contentLines.length;

    for (let i = searchStart; i <= searchEnd - strippedOld.length; i++) {
        let isMatch = true;
        for (let j = 0; j < strippedOld.length; j++) {
            if (contentLines[i + j].trim() !== strippedOld[j]) {
                isMatch = false;
                break;
            }
        }
        if (isMatch) {
            const matchedLines = contentLines.slice(i, i + strippedOld.length);
            const beforeLines = contentLines.slice(0, i);
            const idx = beforeLines.join('\n').length + (beforeLines.length > 0 ? 1 : 0);
            return { index: idx, matchedText: matchedLines.join('\n'), strategy: 'indent-stripped' };
        }
    }

    return null;
}

function findOccurrence(haystack, needle, nearLine) {
    if (!nearLine) {
        return haystack.indexOf(needle);
    }

    const occurrences = [];
    let pos = 0;
    while (true) {
        const idx = haystack.indexOf(needle, pos);
        if (idx === -1) break;
        occurrences.push(idx);
        pos = idx + 1;
    }

    if (occurrences.length === 0) return -1;
    if (occurrences.length === 1) return occurrences[0];

    let best = occurrences[0];
    let bestDist = Infinity;
    for (const idx of occurrences) {
        const lineNum = haystack.slice(0, idx).split('\n').length;
        const dist = Math.abs(lineNum - nearLine);
        if (dist < bestDist) {
            bestDist = dist;
            best = idx;
        }
    }
    return best;
}

function mapTrimmedIndex(original, trimmed, trimmedIdx, trimmedLen) {
    const trimmedBefore = trimmed.slice(0, trimmedIdx);
    const lineNum = trimmedBefore.split('\n').length - 1;
    const normalizedOrig = normalizeLineEndings(original);
    const origLines = normalizedOrig.split('\n');
    let origIdx = 0;
    for (let i = 0; i < lineNum; i++) {
        origIdx += origLines[i].length + 1;
    }
    return origIdx;
}

function findOriginalEnd(content, startIdx, numLines) {
    let pos = startIdx;
    for (let i = 0; i < numLines; i++) {
        const nextNewline = content.indexOf('\n', pos);
        if (nextNewline === -1) return content.length;
        pos = nextNewline + 1;
    }
    return pos - 1;
}

function generateDiagnostic(content, oldText, editIndex, isBatch) {
    const tag = isBatch ? `Edit #${editIndex + 1}: ` : '';
    const oldLines = normalizeLineEndings(oldText).split('\n');
    const firstOldLine = oldLines[0].trim();
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().includes(firstOldLine) ||
            (lines[i].trim().length > 5 && firstOldLine.includes(lines[i].trim()))) {
            return `${tag}oldText not found. Near line ${i + 1}.`;
        }
    }

    for (const oldLine of oldLines) {
        const trimmed = oldLine.trim();
        if (!trimmed) continue;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(trimmed)) {
                return `${tag}oldText not found. Near line ${i + 1}.`;
            }
        }
    }

    return `${tag}oldText not found.`;
}

export function register(server, ctx) {
    server.registerTool("edit_file", {
        title: "Edit File",
        description: "Edit a text file. Three modes: content match (oldText), line range (startLine/endLine + verify), or symbol. Partial failures apply successful edits and cache failures for retry.",
        inputSchema: {
            path: z.string(),
            edits: z.array(z.object({
                newText: z.string().optional().describe("Replacement text. Omit on retry."),
                oldText: z.string().optional().describe("Text to find and replace."),
                startLine: z.number().optional().describe("First line of range to replace."),
                endLine: z.number().optional().describe("Last line of range (inclusive)."),
                verifyStart: z.string().optional().describe("Trimmed content of startLine. Required for range mode."),
                verifyEnd: z.string().optional().describe("Trimmed content of endLine. Required for range mode."),
                symbol: z.string().optional().describe("Symbol name to replace. Dot-qualified for methods."),
                nearLine: z.number().optional().describe("Disambiguate multiple matches."),
            })),
            dryRun: z.boolean().default(false).describe("Preview diff without writing."),
        },
        annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true }
    }, async (args) => {
        const validPath = await ctx.validatePath(args.path);

        const originalContent = normalizeLineEndings(await fs.readFile(validPath, 'utf-8'));
        let workingContent = originalContent;

        if (!args.edits || args.edits.length === 0) {
            throw new Error('No edits provided. Supply an edits array.');
        }

        let successCount = 0;
        const errors = [];
        const isBatch = args.edits.length > 1;

        for (let i = 0; i < args.edits.length; i++) {
            const edit = args.edits[i];
            const tag = isBatch ? `Edit #${i + 1}: ` : '';

            let resolvedNewText = edit.newText;
            if (resolvedNewText === undefined) {
                const cached = getCachedNewText(validPath, i);
                if (cached !== undefined) {
                    resolvedNewText = cached;
                }
            }

            // ---- RANGE-BASED EDIT MODE ----
            if (typeof edit.startLine === 'number' && typeof edit.endLine === 'number') {
                const lines = workingContent.split('\n');
                const start = edit.startLine - 1;
                const end = edit.endLine;

                if (resolvedNewText === undefined) {
                    errors.push(`${tag}newText required.`);
                    continue;
                }

                if (start < 0 || end > lines.length || start >= end) {
                    errors.push(`${tag}Invalid range.`);
                    continue;
                }

                if (!edit.verifyStart) {
                    cachePendingBatch(validPath, args.edits);
                    errors.push(`${tag}verifyStart is required.`);
                    continue;
                }

                const actualStart = lines[start].trim();
                const expectedStart = edit.verifyStart.trim();

                if (actualStart === '' && expectedStart === '') {
                    cachePendingBatch(validPath, args.edits);
                    errors.push(`${tag}startLine ${edit.startLine} is empty.`);
                    continue;
                }

                if (actualStart !== expectedStart) {
                    cachePendingBatch(validPath, args.edits);
                    errors.push(`${tag}verifyStart mismatch at line ${edit.startLine}.`);
                    continue;
                }

                if (!edit.verifyEnd) {
                    cachePendingBatch(validPath, args.edits);
                    errors.push(`${tag}verifyEnd is required.`);
                    continue;
                }

                const actualEnd = lines[end - 1].trim();
                const expectedEnd = edit.verifyEnd.trim();

                if (actualEnd === '') {
                    cachePendingBatch(validPath, args.edits);
                    errors.push(`${tag}endLine ${edit.endLine} is empty.`);
                    continue;
                }

                if (actualEnd !== expectedEnd) {
                    cachePendingBatch(validPath, args.edits);
                    errors.push(`${tag}verifyEnd mismatch at line ${edit.endLine}.`);
                    continue;
                }

                const normalizedNew = normalizeLineEndings(resolvedNewText);
                const newLines = normalizedNew.split('\n');
                lines.splice(start, end - start, ...newLines);
                workingContent = lines.join('\n');

                clearPendingBatch(validPath);
                successCount++;
                continue;
            }

            // ---- SYMBOL-BASED EDIT MODE ----
            if (edit.symbol) {
                if (edit.oldText || edit.startLine !== undefined) {
                    errors.push(`${tag}symbol mode is exclusive — don't combine with oldText or startLine.`);
                    continue;
                }

                if (resolvedNewText === undefined) {
                    errors.push(`${tag}newText required.`);
                    continue;
                }

                const langName = getLangForFile(validPath);
                if (!langName) {
                    errors.push(`${tag}Unsupported file type.`);
                    continue;
                }

                const symbolMatches = await findSymbol(workingContent, langName, edit.symbol, {
                    kindFilter: 'def',
                    nearLine: edit.nearLine,
                });

                if (!symbolMatches || symbolMatches.length === 0) {
                    errors.push(`${tag}Symbol not found.`);
                    continue;
                }

                if (symbolMatches.length > 1 && !edit.nearLine) {
                    errors.push(`${tag}Multiple matches. Use nearLine.`);
                    continue;
                }

                const sym = symbolMatches[0];
                const lines = workingContent.split('\n');
                const start = sym.line - 1;
                const end = sym.endLine;
                const normalizedNew = normalizeLineEndings(resolvedNewText);
                const newLines = normalizedNew.split('\n');
                lines.splice(start, end - start, ...newLines);
                workingContent = lines.join('\n');

                successCount++;
                continue;
            }

            // ---- CONTENT-BASED EDIT MODE (original) ----
            if (!edit.oldText) {
                errors.push(`${tag}Provide oldText, startLine/endLine, or symbol.`);
                continue;
            }

            const match = findMatch(workingContent, edit.oldText, edit.nearLine);

            if (!match) {
                errors.push(generateDiagnostic(workingContent, edit.oldText, i, isBatch));
                continue;
            }

            if (resolvedNewText === undefined) {
                errors.push(`${tag}newText required.`);
                continue;
            }

            const normalizedNew = normalizeLineEndings(resolvedNewText);

            if (match.strategy === 'indent-stripped') {
                const matchedLines = match.matchedText.split('\n');
                const newLines = normalizedNew.split('\n');
                const originalIndent = matchedLines[0].match(/^\s*/)?.[0] || '';
                const oldIndent = normalizeLineEndings(edit.oldText).split('\n')[0].match(/^\s*/)?.[0] || '';

                const reindentedNew = newLines.map((line, j) => {
                    if (j === 0) return originalIndent + line.trimStart();
                    const lineIndent = line.match(/^\s*/)?.[0] || '';
                    const relIndent = lineIndent.length - (oldIndent?.length || 0);
                    return originalIndent + ' '.repeat(Math.max(0, relIndent)) + line.trimStart();
                }).join('\n');

                workingContent = workingContent.slice(0, match.index) +
                    reindentedNew +
                    workingContent.slice(match.index + match.matchedText.length);
            } else {
                workingContent = workingContent.slice(0, match.index) +
                    normalizedNew +
                    workingContent.slice(match.index + match.matchedText.length);
            }

            successCount++;
        }

        // Phase 2: Handle failures
        if (errors.length > 0) {
            cachePendingBatch(validPath, args.edits);

            if (successCount === 0) {
                throw new Error(
                    `${errors.length} edit(s) failed:\n${errors.join('\n')}`
                );
            }

            if (!args.dryRun) {
                const tempPath = `${validPath}.${randomBytes(16).toString('hex')}.tmp`;
                try {
                    await fs.writeFile(tempPath, workingContent, 'utf-8');
                    await fs.rename(tempPath, validPath);
                } catch (error) {
                    try { await fs.unlink(tempPath); } catch { /* ignore */ }
                    throw error;
                }
            }

            return {
                content: [{ type: "text", text: `${successCount} applied, ${errors.length} failed:\n${errors.join('\n')}` }],
            };
        }

        // Phase 3: All succeeded — write file
        if (!args.dryRun) {
            const tempPath = `${validPath}.${randomBytes(16).toString('hex')}.tmp`;
            try {
                await fs.writeFile(tempPath, workingContent, 'utf-8');
                await fs.rename(tempPath, validPath);
            } catch (error) {
                try { await fs.unlink(tempPath); } catch { /* ignore */ }
                throw error;
            }
            clearPendingBatch(validPath);
        }

        if (args.dryRun) {
            const patch = createMinimalDiff(originalContent, workingContent, validPath);
            return {
                content: [{ type: "text", text: JSON.stringify({ dryRun: true, diff: patch }) }],
            };
        }

        // Post-edit AST error detection
        let syntaxWarning = '';
        try {
            const ext = path.extname(validPath).toLowerCase();
            const lossyAliases = ['.scss', '.mdx', '.jsonc'];
            const isLossyAlias = lossyAliases.includes(ext);

            if (!isLossyAlias) {
                const langName = getLangForFile(validPath);
                if (langName) {
                    const syntaxErrors = await checkSyntaxErrors(workingContent, langName);
                    if (syntaxErrors && syntaxErrors.length > 0) {
                        const locations = syntaxErrors.map(e => `${e.line}:${e.column}`).join(', ');
                        syntaxWarning = `\n⚠ Parse errors at lines ${locations}`;
                    }
                }
            }
        } catch {
            // Syntax check is best-effort
        }

        return {
            content: [{ type: "text", text: `Applied.${syntaxWarning}` }],
        };
    });
}
