import { z } from "zod";
import fs from "fs/promises";
import path from 'path';
import { randomBytes } from 'crypto';
import { normalizeLineEndings, createMinimalDiff } from '../core/lib.js';
import { getLangForFile, findSymbol, checkSyntaxErrors, getSymbols, getDefinitions, isSupported } from '../core/tree-sitter.js';
import { findRepoRoot, getDb, indexDirectory, indexFile, ensureIndexFresh, impactQuery, snapshotSymbol, getVersionHistory, getVersionText, restoreVersion, getSessionId, pruneOldSessions } from '../core/symbol-index.js';
import { CHAR_BUDGET } from '../core/shared.js';

// Validate a repo-relative path cannot escape the repo root before resolving.
function resolveRepoPath(repoRoot, relPath) {
    const normalRoot = path.resolve(repoRoot); // nosemgrep
    const resolved = path.resolve(normalRoot, relPath); // nosemgrep
    if (!resolved.startsWith(normalRoot + path.sep) && resolved !== normalRoot) {
        throw new Error('Path out of repository bounds.');
    }
    return resolved;
}

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
    return entry.edits[index]?.newText; // nosemgrep
}

function clearPendingBatch(filePath) {
    _pendingRetries.delete(filePath);
}

// ---------------------------------------------------------------------------
// Batch session state
// ---------------------------------------------------------------------------

const _batchSession = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;

async function getOrCreateSession(filePath, ctx, clientSessionId) {
    const repoRoot = findRepoRoot(filePath);
    if (!repoRoot) throw new Error('Not a git repository.');


    const sessionId = getSessionId(clientSessionId);
    const existing = _batchSession.get(sessionId);
    if (existing && existing.repoRoot === repoRoot &&
        (Date.now() - existing.timestamp) < SESSION_TTL_MS) {
        existing.timestamp = Date.now();
        return existing;
    }
    const db = getDb(repoRoot);
    pruneOldSessions(db, sessionId);
    // Await on fresh DB so index is populated before first impact query.
    // On subsequent calls, update incrementally in background.
    const fileCount = db.prepare('SELECT COUNT(*) AS n FROM files').get().n;
    if (fileCount === 0) {
        await indexDirectory(db, repoRoot, repoRoot, { maxFiles: 5000 });
    } else {
        indexDirectory(db, repoRoot, repoRoot, { maxFiles: 5000 }).catch(() => {});
    }
    const session = {
        stage: 0,
        repoRoot,
        db,
        impactResults: [],
        loadedGroups: [],
        editPayloadCache: new Map(),
        retryCount: new Map(),
        timestamp: Date.now(),
        clientSessionId,
    };
    _batchSession.set(sessionId, session);
    return session;
}

// ---------------------------------------------------------------------------
// Edit payload parser — locates headers by pattern, takes everything between
// them as the function body.
// ---------------------------------------------------------------------------

function parseEditPayload(edit) {
    // Accept both canonical plain format and backward-compatible bracketed format:
    //   symbolName 1,2 rel/path.ts     (canonical — plain indices)
    //   symbolName [1,2] rel/path.ts   (bracketed — emitted by loadDiff display)
    // Group 1 = symbolName, group 2 = bracketed indices, group 3 = plain indices
    const headerRe = /^(\S+)\s+(?:\[([\d,]+)\]|(\d[\d,]*)(?:\s|$))/;
    const lines = edit.split('\n');
    const groups = [];
    let current = null;

    for (const line of lines) {
        const m = line.match(headerRe);
        if (m) {
            if (current) {
                current.body = trimBodyLines(current.bodyLines);
                groups.push(current);
            }
            const indicesStr = m[2] ?? m[3];
            current = {
                symbolName: m[1],
                indices: indicesStr ? indicesStr.split(',').map(n => parseInt(n, 10)) : [],
                bodyLines: [],
            };
        } else if (current) {
            current.bodyLines.push(line);
        }
    }
    if (current) {
        current.body = trimBodyLines(current.bodyLines);
        groups.push(current);
    }
    return groups;
}

function trimBodyLines(lines) {
    let start = 0;
    let end = lines.length - 1;
    while (start <= end && lines[start].trim() === '') start++;
    while (end >= start && lines[end].trim() === '') end--;
    return lines.slice(start, end + 1).join('\n');
}

// ---------------------------------------------------------------------------
// Shared diff loading (Load branch and Symbols skip-ahead branch)
// ---------------------------------------------------------------------------

async function loadDiff(session, targetedEntries, excludeLines, range) {
    const contextLines = typeof range === 'number' && range >= 0 ? range : 5;
    const { db, repoRoot } = session;

    // Freshness check on targeted files
    const uniqueFiles = [...new Set(
        targetedEntries.filter(e => e.filePath).map(e => resolveRepoPath(repoRoot, e.filePath))
    )];
    if (uniqueFiles.length > 0) {
        await ensureIndexFresh(db, repoRoot, uniqueFiles);
    }

    // Build occurrence groups keyed by symbol name
    const groupMap = new Map();


    for (const entry of targetedEntries) {
        if (!entry.filePath) continue;
        const absFilePath = resolveRepoPath(repoRoot, entry.filePath);

        let source;
        try {
            source = normalizeLineEndings(await fs.readFile(absFilePath, 'utf-8')); // nosemgrep
        } catch {
            continue;
        }

        const langName = getLangForFile(absFilePath);
        if (!langName) continue;

        const syms = await findSymbol(source, langName, entry.name, { kindFilter: 'def' });
        if (!syms || syms.length === 0) continue;

        for (const sym of syms) {
            if (excludeLines && excludeLines.includes(sym.line)) continue;

            const lines = source.split('\n');
            const ctxStart = Math.max(0, sym.line - 1 - contextLines);
            const ctxEnd = Math.min(lines.length, sym.endLine + contextLines);
            const body = lines.slice(ctxStart, ctxEnd).join('\n');

            if (!groupMap.has(entry.name)) {
                groupMap.set(entry.name, { symbolName: entry.name, occurrences: [] });
            }
            groupMap.get(entry.name).occurrences.push({
                index: groupMap.get(entry.name).occurrences.length + 1,
                absFilePath,
                relFilePath: entry.filePath,
                startLine: sym.line,
                endLine: sym.endLine,
                body,
                warning: null,
            });
        }
    }

    // Outlier detection within each group
    for (const [, group] of groupMap) {
        if (group.occurrences.length < 2) continue;
        const occs = group.occurrences;
        const refFirst = occs[0].body.split('\n')[0];
        const refLen = occs[0].body.split('\n').length;
        const refParams = (refFirst.match(/,/g) || []).length + 1;

        for (let i = 1; i < occs.length; i++) {
            const first = occs[i].body.split('\n')[0]; // nosemgrep
            const len = occs[i].body.split('\n').length; // nosemgrep
            const params = (first.match(/,/g) || []).length + 1;
            let warning = null;
            if (Math.abs(params - refParams) / Math.max(refParams, 1) > 0.3) {
                warning = 'signature differs';
            } else if (Math.abs(len - refLen) / Math.max(refLen, 1) > 0.3) {
                warning = 'body diverges';
            }
            occs[i].warning = warning; // nosemgrep
        }
    }

    // Bonus 4: scope summary line
    const fileSummary = new Map();
    for (const [, group] of groupMap) {
        for (const occ of group.occurrences) {
            fileSummary.set(occ.relFilePath, (fileSummary.get(occ.relFilePath) || 0) + 1);
        }
    }
    const summaryLine = [...fileSummary.entries()].map(([f, n]) => `${n} in ${f}`).join(', ');

    // Assemble diff document with budget enforcement
    const outputParts = [];
    let charCount = summaryLine.length + 1;
    let loadedCount = 0;
    let truncated = false;
    let totalCount = 0;

    for (const [, group] of groupMap) totalCount += group.occurrences.length;

    // Track only occurrences actually emitted within the char budget.
    const emittedGroupMap = new Map();

    outer: for (const [, group] of groupMap) {
        for (const occ of group.occurrences) {
            const header = `${group.symbolName} [${occ.index}] ${occ.relFilePath}${occ.warning ? ` \u26a0 ${occ.warning}` : ''}`;
            const block = `${header}\n\n${occ.body}\n`;

            if (charCount + block.length > CHAR_BUDGET) {
                truncated = true;
                break outer;
            }

            outputParts.push(block);
            charCount += block.length;
            loadedCount++;

            if (!emittedGroupMap.has(group.symbolName)) {
                emittedGroupMap.set(group.symbolName, { symbolName: group.symbolName, occurrences: [] });
            }
            emittedGroupMap.get(group.symbolName).occurrences.push(occ);
        }
    }

    // Persist emitted occurrences. Append to existing if continuing from truncation.
    const newGroups = [...emittedGroupMap.values()];
    if (session.stage === 2 && session.loadedGroups) {
        for (const ng of newGroups) {
            const existing = session.loadedGroups.find(g => g.symbolName === ng.symbolName);
            if (existing) {
                existing.occurrences.push(...ng.occurrences);
            } else {
                session.loadedGroups.push(ng);
            }
        }
    } else {
        session.loadedGroups = newGroups;
    }
    session.stage = 2;

    // Store deferred entries for pagination
    if (truncated) {
        const deferred = [];
        let pastEmitted = false;
        for (const [, group] of groupMap) {
            for (const occ of group.occurrences) {
                if (!emittedGroupMap.has(group.symbolName) ||
                    !emittedGroupMap.get(group.symbolName).occurrences.includes(occ)) {
                    deferred.push({ name: group.symbolName, filePath: occ.filePath });
                }
            }
        }
        session.deferredEntries = deferred;
    } else {
        session.deferredEntries = null;
    }

    const parts = [];
    if (summaryLine) parts.push(summaryLine);
    parts.push(...outputParts);
    if (truncated) parts.push(`${loadedCount} of ${totalCount} loaded. Send load again for remaining.`);

    return { content: [{ type: 'text', text: parts.join('\n') }] };
}

// ---------------------------------------------------------------------------
// Existing content-match helpers
// ---------------------------------------------------------------------------

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
            if (contentLines[i + j].trim() !== strippedOld[j]) { // nosemgrep
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
        origIdx += origLines[i].length + 1; // nosemgrep
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
        if (lines[i].trim().includes(firstOldLine) || // nosemgrep
            (lines[i].trim().length > 5 && firstOldLine.includes(lines[i].trim()))) { // nosemgrep
            return `${tag}oldText not found. Near line ${i + 1}.`;
        }
    }

    for (const oldLine of oldLines) {
        const trimmed = oldLine.trim();
        if (!trimmed) continue;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(trimmed)) { // nosemgrep
                return `${tag}oldText not found. Near line ${i + 1}.`;
            }
        }
    }

    return `${tag}oldText not found.`;
}

export function register(server, ctx) {
    server.registerTool("edit_file", {
        title: "Edit File",
        description: "Edit a text file. Three modes: content match (oldText), line range (startLine/endLine + verify), or symbol. Partial failures apply successful edits and cache failures for retry. Batch mode enables multi-step impact analysis and bulk edits across a repo.",
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
            })).optional(),
            batch: z.object({
                query: z.string().optional(),
                symbols: z.array(z.string()).optional(),
                load: z.array(z.union([z.number(), z.string()])).optional(),
                range: z.number().optional(),
                excludeLines: z.array(z.number()).optional(),
                dryRun: z.boolean().optional().default(false),
                restore: z.object({
                    symbols: z.array(z.string()),
                    version: z.number().optional(),
                    file: z.string().optional(),
                }).optional(),
                reapply: z.object({
                    symbols: z.array(z.string()),
                }).optional(),
            }).optional(),
            dryRun: z.boolean().default(false).describe("Preview diff without writing."),
        },
        annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true }
    }, async (args) => {
        const validPath = await ctx.validatePath(args.path);

        if (args.batch && args.edits) throw new Error('batch mode is exclusive.');
        if (!args.batch && !args.edits) throw new Error('No edits or batch provided.');

        // ====================================================================
        // BATCH MODE
        // ====================================================================
        if (args.batch) {
            const b = args.batch;
            // Derive a session-scoped ID: in HTTP mode, ctx carries a unique
            // session identity from the transport; in stdio mode, fall back to pid:cwd.
            const clientSessionId = ctx._sessionId || null;
            const sessionId = getSessionId(clientSessionId);

            // ---- 1. Restore ----
            if (b.restore) {
                const session = _batchSession.get(sessionId);
                if (!session || session.stage < 3) throw new Error('No completed edit session to restore.');
                const { db, repoRoot } = session;

                for (const raw of b.restore.symbols) {
                    let symbolName = raw;
                    let restoreFile = b.restore.file || null;
                    const atIdx = raw.lastIndexOf('@');
                    if (atIdx > 0) {
                        symbolName = raw.slice(0, atIdx);
                        restoreFile = restoreFile || raw.slice(atIdx + 1);
                    }
                    const history = getVersionHistory(db, symbolName, sessionId, restoreFile);
                    if (!history || history.length === 0) throw new Error(`No version history for "${symbolName}".`);

                    // If no file specified and history spans multiple files, require disambiguation.
                    if (!restoreFile) {
                        const files = [...new Set(history.map(h => h.file_path))];
                        if (files.length > 1) {
                            throw new Error(`"${symbolName}" edited in multiple files: ${files.join(', ')}. Specify restore.file.`);
                        }
                    }

                    const versionId = b.restore.version !== undefined
                        ? b.restore.version
                        : history[0].id;

                    // Validate version ownership: symbol name + session must match.
                    const versionMeta = db.prepare('SELECT symbol_name, session_id, file_path, line, original_text FROM versions WHERE id = ?').get(versionId);
                    if (!versionMeta) throw new Error(`Version ${versionId} not found.`);
                    if (versionMeta.symbol_name !== symbolName) {
                        throw new Error(`Version ${versionId} belongs to "${versionMeta.symbol_name}", not "${symbolName}".`);
                    }
                    if (versionMeta.session_id !== sessionId) {
                        throw new Error('Version belongs to a different session.');
                    }
                    const restoredText = versionMeta.original_text;

                    const filePath = versionMeta.file_path;
                    const absFilePath = resolveRepoPath(repoRoot, filePath);
                    const rawSource = await fs.readFile(absFilePath, 'utf-8'); // nosemgrep
                    const source = normalizeLineEndings(rawSource);
                    const langName = getLangForFile(absFilePath);
                    const syms = await findSymbol(source, langName, symbolName, {
                        kindFilter: 'def',
                        nearLine: versionMeta.line ?? undefined,
                    });
                    if (!syms || syms.length === 0) throw new Error(`Symbol "${symbolName}" not found.`);
                    // Use versioned line to disambiguate when multiple defs exist in the same file.
                    const sym = syms.length === 1 ? syms[0]
                        : (versionMeta.line ? syms.find(s => s.line === versionMeta.line) : null) || syms[0];

                    const lines = source.split('\n');
                    const currentBody = lines.slice(sym.line - 1, sym.endLine).join('\n');
                    snapshotSymbol(db, symbolName, filePath, currentBody, sessionId, sym.line);

                    const normalizedRestored = normalizeLineEndings(restoredText);
                    const newLines = normalizedRestored.split('\n');
                    lines.splice(sym.line - 1, sym.endLine - (sym.line - 1), ...newLines);
                    const newContent = lines.join('\n');

                    const tempPath = `${absFilePath}.${randomBytes(16).toString('hex')}.tmp`;
                    try {
                        await fs.writeFile(tempPath, newContent, 'utf-8'); // nosemgrep
                        await fs.rename(tempPath, absFilePath); // nosemgrep
                    } catch (err) {
                        try { await fs.unlink(tempPath); } catch { /* ignore */ } // nosemgrep
                        throw err;
                    }

                    await indexFile(db, repoRoot, absFilePath);
                }

                return { content: [{ type: 'text', text: 'Restored.' }] };
            }

            // ---- 2. Reapply ----
            if (b.reapply) {
                const session = _batchSession.get(sessionId);
                if (!session || session.stage < 3) throw new Error('No completed edit session to reapply.');
                const { db, repoRoot } = session;

                if (session.editPayloadCache.size === 0) throw new Error('No cached edit.');

                // If multiple cached patterns and target symbol isn't one of them, ambiguous.
                const singleCached = session.editPayloadCache.size === 1
                    ? session.editPayloadCache.values().next().value
                    : null;

                for (let ri = 0; ri < b.reapply.symbols.length; ri++) {
                    const raw = b.reapply.symbols[ri]; // nosemgrep
                    let symbolName = raw;
                    let fileScope = null;
                    const atIdx = raw.lastIndexOf('@');
                    if (atIdx > 0) {
                        symbolName = raw.slice(0, atIdx);
                        fileScope = raw.slice(atIdx + 1);
                    }

                    let defQuery = 'SELECT file_path, line, end_line FROM symbols WHERE name = ? AND kind = ?';
                    const defParams = [symbolName, 'def'];
                    if (fileScope) {
                        defQuery += ' AND file_path LIKE ?';
                        defParams.push('%' + fileScope);
                    }
                    const defRows = db.prepare(defQuery).all(...defParams);
                    if (defRows.length === 0) throw new Error(`Symbol "${symbolName}" not found in index.`);
                    if (defRows.length > 1) {
                        const candidates = defRows.map((r, j) => `${String.fromCharCode(97 + j)}) ${r.file_path}:${r.line}`);
                        return { content: [{ type: 'text', text: `Multiple definitions for "${symbolName}":\n${candidates.join('\n')}\nNarrow with symbolName@filePath.` }] };
                    }
                    const defRow = defRows[0];

                    const cachedBody = session.editPayloadCache.get(symbolName) || singleCached;
                    if (!cachedBody) throw new Error(`Multiple cached edits — reapply "${symbolName}" is ambiguous.`);

                    const absFilePath = resolveRepoPath(repoRoot, defRow.file_path);
                    const source = normalizeLineEndings(await fs.readFile(absFilePath, 'utf-8')); // nosemgrep
                    const langName = getLangForFile(absFilePath);

                    const syms = await findSymbol(source, langName, symbolName, {
                        kindFilter: 'def',
                        nearLine: defRow.line,
                    });
                    if (!syms || syms.length === 0) throw new Error(`Symbol "${symbolName}" not found.`);
                    if (syms.length > 1) {
                        const locs = syms.map((s, j) => `${String.fromCharCode(97 + j)}) line ${s.line}`);
                        return { content: [{ type: 'text', text: `Multiple "${symbolName}" in file:\n${locs.join('\n')}\nNarrow with symbolName@filePath.` }] };
                    }
                    const sym = syms[0];

                    const normalizedNew = normalizeLineEndings(cachedBody);
                    const lines = source.split('\n');
                    const testLines = [...lines];
                    testLines.splice(sym.line - 1, sym.endLine - (sym.line - 1), ...normalizedNew.split('\n'));
                    const testContent = testLines.join('\n');

                    if (langName) {
                        const syntaxErrors = await checkSyntaxErrors(testContent, langName);
                        if (syntaxErrors && syntaxErrors.length > 0) {
                            throw new Error(`${symbolName}: parse error line ${syntaxErrors[0].line}`);
                        }
                    }

                    const currentBody = lines.slice(sym.line - 1, sym.endLine).join('\n');
                    snapshotSymbol(db, symbolName, defRow.file_path, currentBody, sessionId, sym.line);

                    const tempPath = `${absFilePath}.${randomBytes(16).toString('hex')}.tmp`;
                    try {
                        await fs.writeFile(tempPath, testContent, 'utf-8'); // nosemgrep
                        await fs.rename(tempPath, absFilePath); // nosemgrep
                    } catch (err) {
                        try { await fs.unlink(tempPath); } catch { /* ignore */ } // nosemgrep
                        throw err;
                    }

                    await indexFile(db, repoRoot, absFilePath);
                }

                return { content: [{ type: 'text', text: 'Reapplied.' }] };
            }

            // ---- 3. Apply ----
            if (b.edit !== undefined) {
                const session = _batchSession.get(sessionId);
                if (!session || session.stage !== 2) throw new Error('Load diff first.');
                const { db, repoRoot } = session;

                const groups = parseEditPayload(b.edit);
                if (groups.length === 0) {
                    return { content: [{ type: 'text', text: 'PARSE_ERROR: No valid edit headers found in payload.' }] };
                }
                const emptyIndexGroups = groups.filter(g => g.indices.length === 0).map(g => g.symbolName);
                if (emptyIndexGroups.length > 0) {
                    return { content: [{ type: 'text', text: `PARSE_ERROR: No target indices for: ${emptyIndexGroups.join(', ')}` }] };
                }
                let appliedCount = 0;
                const failedGroups = [];
                const fileContents = new Map(); // absPath → current (possibly already-modified) content

                for (const group of groups) {
                    const { symbolName, indices, body } = group;

                    const loadedGroup = session.loadedGroups.find(g => g.symbolName === symbolName);
                    if (!loadedGroup) {
                        failedGroups.push(`${symbolName}: not in loaded diff`);
                        continue;
                    }

                    const targetOccs = loadedGroup.occurrences.filter(occ => indices.includes(occ.index));
                    if (targetOccs.length === 0) {
                        const deferred = session.deferredStartIndex;
                        const hasDeferred = deferred && indices.some(i => i >= deferred);
                        if (hasDeferred) {
                            failedGroups.push(`${symbolName}: indices [${indices.join(',')}] not loaded — load deferred occurrences from index ${deferred} first`);
                        } else {
                            failedGroups.push(`${symbolName}: no matching occurrences`);
                        }
                        continue;
                    }

                    // Group occurrences by file
                    const byFile = new Map();
                    for (const occ of targetOccs) {
                        if (!byFile.has(occ.absFilePath)) byFile.set(occ.absFilePath, []);
                        byFile.get(occ.absFilePath).push(occ);
                    }

                    let groupHasSyntaxError = false;
                    const fileEdits = [];

                    for (const [absFilePath, occs] of byFile) {
                        let source = fileContents.get(absFilePath);
                        if (!source) {
                            source = normalizeLineEndings(await fs.readFile(absFilePath, 'utf-8')); // nosemgrep
                            fileContents.set(absFilePath, source);
                        }

                        const langName = getLangForFile(absFilePath);
                        const normalizedBody = normalizeLineEndings(body);
                        const newBodyLines = normalizedBody.split('\n');

                        // Re-resolve symbol positions against current file content
                        // to account for line shifts from earlier groups.
                        const freshOccs = [];
                        for (const occ of occs) {
                            const syms = await findSymbol(source, langName, symbolName, {
                                kindFilter: 'def',
                                nearLine: occ.startLine,
                            });
                            if (syms && syms.length > 0) {
                                // Pick the closest match to the original line.
                                const best = syms.reduce((a, b) =>
                                    Math.abs(a.line - occ.startLine) <= Math.abs(b.line - occ.startLine) ? a : b);
                                freshOccs.push({ startLine: best.line, endLine: best.endLine });
                            } else {
                                freshOccs.push(occ); // fallback to original
                            }
                        }

                        // Process bottom-up to preserve earlier line numbers
                        const sortedOccs = [...freshOccs].sort((a, b) => b.startLine - a.startLine);

                        let testLines = source.split('\n');
                        for (const occ of sortedOccs) {
                            testLines.splice(occ.startLine - 1, occ.endLine - (occ.startLine - 1), ...newBodyLines);
                        }
                        const testContent = testLines.join('\n');

                        if (langName) {
                            const syntaxErrors = await checkSyntaxErrors(testContent, langName);
                            if (syntaxErrors && syntaxErrors.length > 0) {
                                failedGroups.push(`${symbolName}: parse error line ${syntaxErrors[0].line}`);
                                groupHasSyntaxError = true;
                                break;
                            }
                        }

                        fileEdits.push({ absFilePath, testContent, freshOccs, origSource: source });
                    }

                    if (groupHasSyntaxError) {
                        const retries = session.retryCount.get(symbolName) || 0;
                        if (retries >= 1) {
                            // Replace the last "parse error" entry with the final message
                            failedGroups[failedGroups.length - 1] = `${symbolName}: Review and edit this symbol directly.`; // nosemgrep
                        } else {
                            session.retryCount.set(symbolName, retries + 1);
                        }
                        continue;
                    }

                    if (!b.dryRun) {
                        for (const { absFilePath, testContent, freshOccs, origSource } of fileEdits) {
                            const relPath = path.relative(repoRoot, absFilePath);
                            const origLines = origSource.split('\n');
                            for (const occ of freshOccs) {
                                const currentBody = origLines.slice(occ.startLine - 1, occ.endLine).join('\n'); // nosemgrep
                                snapshotSymbol(db, symbolName, relPath, currentBody, sessionId, occ.startLine);
                            }

                            const tempPath = `${absFilePath}.${randomBytes(16).toString('hex')}.tmp`;
                            try {
                                await fs.writeFile(tempPath, testContent, 'utf-8'); // nosemgrep
                                await fs.rename(tempPath, absFilePath); // nosemgrep
                            } catch (err) {
                                try { await fs.unlink(tempPath); } catch { /* ignore */ } // nosemgrep
                                throw err;
                            }

                            await indexFile(db, repoRoot, absFilePath);
                            fileContents.set(absFilePath, testContent);
                        }

                        session.editPayloadCache.set(symbolName, body);
                    }

                    appliedCount++;
                }

                if (b.dryRun) {
                    const fileCount = new Set(
                        groups.flatMap(g => {
                            const lg = session.loadedGroups.find(l => l.symbolName === g.symbolName);
                            return lg ? lg.occurrences.map(o => o.absFilePath) : [];
                        })
                    ).size;
                    const cautionCount = groups.reduce((n, g) => {
                        const lg = session.loadedGroups.find(l => l.symbolName === g.symbolName);
                        return n + (lg ? lg.occurrences.filter(o => o.warning).length : 0);
                    }, 0);
                    const cautionSuffix = cautionCount > 0 ? `, ${cautionCount} caution` : '';
                    return { content: [{ type: 'text', text: `Dry: ${groups.length} edits, ${fileCount} files, ${failedGroups.length} errors${cautionSuffix}` }] };
                }

                if (failedGroups.length === 0) {
                    session.stage = 3;
                    return { content: [{ type: 'text', text: 'Applied. restore/reapply available.' }] };
                }

                if (appliedCount > 0) session.stage = 3;
                return { content: [{ type: 'text', text: `${appliedCount} applied. Failures:\n${failedGroups.join('\n')}` }] };
            }

            // ---- 4. Load ----
            if (b.load) {
                const session = _batchSession.get(sessionId);
                if (!session) throw new Error('Run a query first.');
                if (session.stage === 2 && session.deferredEntries) {
                    const result = await loadDiff(session, session.deferredEntries, b.excludeLines, b.range);
                    session.deferredEntries = null;
                    return result;
                }
                if (session.stage !== 1) throw new Error('Run a query first.');

                const targeted = b.load.map(sel => {
                    if (typeof sel === 'number') {
                        const entry = session.impactResults[sel - 1];
                        if (!entry) throw new Error(`Index ${sel} out of range.`);
                        return entry;
                    }
                    const entry = session.impactResults.find(r => r.name === sel);
                    if (!entry) throw new Error(`Symbol "${sel}" not in impact results.`);
                    return entry;
                });

                return loadDiff(session, targeted, b.excludeLines, b.range);
            }

            // ---- 5. Query ----
            if (b.query) {
                const session = await getOrCreateSession(validPath, ctx, clientSessionId);
                const { db, repoRoot } = session;

                // Ensure the source file is fresh before impact analysis.
                await ensureIndexFresh(db, repoRoot, [validPath]);

                let queryName = b.query;
                let queryFile = null;
                const atIdx = b.query.lastIndexOf('@');
                if (atIdx > 0) {
                    queryName = b.query.slice(0, atIdx);
                    queryFile = b.query.slice(atIdx + 1);
                }

                const result = impactQuery(db, queryName, queryFile ? { file: queryFile } : {});

                if (result.disambiguate) {
                    const lines = result.definitions.map((p, i) =>
                        `${String.fromCharCode(97 + i)}) ${p}`
                    );
                    return { content: [{ type: 'text', text: `Multiple definitions for "${queryName}":\n${lines.join('\n')}\nNarrow with symbolName@filePath.` }] };
                }

                session.impactResults = result.results;
                session.stage = 1;

                const listLines = result.results.map((r, i) =>
                    `${i + 1}) ${r.name}[${r.refCount ?? r.callCount ?? 0}x] (${r.filePath || ''})`
                );
                listLines.push(`total ${result.total}`);
                listLines.push('load?');

                return { content: [{ type: 'text', text: listLines.join('\n') }] };
            }

            // ---- 6. Symbols (skip-ahead) ----
            if (b.symbols) {
                const session = await getOrCreateSession(validPath, ctx, clientSessionId);
                const { db, repoRoot } = session;

                // Freshen index before symbol resolution.
                await ensureIndexFresh(db, repoRoot, [validPath]);

                const targeted = [];
                for (let i = 0; i < b.symbols.length; i++) {
                    const raw = b.symbols[i]; // nosemgrep
                    let symbolName = raw;
                    let fileScope = null;
                    const atIdx = raw.lastIndexOf('@');
                    if (atIdx > 0) {
                        symbolName = raw.slice(0, atIdx);
                        fileScope = raw.slice(atIdx + 1);
                    }

                    let sql = 'SELECT name, file_path, line FROM symbols WHERE name = ? AND kind = ?';
                    const params = [symbolName, 'def'];
                    if (fileScope) {
                        sql += ' AND file_path LIKE ?';
                        params.push('%' + fileScope);
                    }
                    sql += ' LIMIT 10';
                    const rows = db.prepare(sql).all(...params);

                    if (rows.length === 0) {
                        return { content: [{ type: 'text', text: `Symbol "${symbolName}" not found in index.` }] };
                    }
                    if (rows.length > 1) {
                        const paths = rows.map((r, j) => `${String.fromCharCode(97 + j)}) ${r.file_path}:${r.line}`);
                        return { content: [{ type: 'text', text: `Multiple definitions for "${symbolName}":\n${paths.join('\n')}\nNarrow with symbolName@filePath.` }] };
                    }

                    targeted.push({ name: symbolName, filePath: rows[0].file_path, refCount: 1 });
                }

                return loadDiff(session, targeted, b.excludeLines, b.range);
            }

            throw new Error('No batch action provided.');
        }

        // ====================================================================
        // STANDARD EDIT MODE
        // ====================================================================

        const originalContent = normalizeLineEndings(await fs.readFile(validPath, 'utf-8')); // nosemgrep
        let workingContent = originalContent;

        if (!args.edits || args.edits.length === 0) {
            throw new Error('No edits provided. Supply an edits array.');
        }

        let successCount = 0;
        const errors = [];
        const isBatch = args.edits.length > 1;

        for (let i = 0; i < args.edits.length; i++) {
            const edit = args.edits[i]; // nosemgrep
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

                const actualEnd = lines[end - 1].trim(); // nosemgrep
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
                    await fs.writeFile(tempPath, workingContent, 'utf-8'); // nosemgrep
                    await fs.rename(tempPath, validPath); // nosemgrep
                } catch (error) {
                    try { await fs.unlink(tempPath); } catch { /* ignore */ } // nosemgrep
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
                await fs.writeFile(tempPath, workingContent, 'utf-8'); // nosemgrep
                await fs.rename(tempPath, validPath); // nosemgrep
            } catch (error) {
                try { await fs.unlink(tempPath); } catch { /* ignore */ } // nosemgrep
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
                        syntaxWarning = `\n\u26a0 Parse errors at lines ${locations}`;
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
