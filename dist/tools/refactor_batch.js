import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { randomBytes } from 'crypto';
import { getProjectContext } from '../core/project-context.js';
import {
    getDb, indexDirectory, ensureIndexFresh,
    impactQuery, getSessionId, findRepoRoot, snapshotSymbol,
} from '../core/symbol-index.js';
import {
    getLangForFile, findSymbol, getSymbolStructure, checkSyntaxErrors,
} from '../core/tree-sitter.js';
import { applyEditList, syntaxWarn } from '../core/edit-engine.js';

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

const MAX_CHARS = Number(process.env.REFACTOR_MAX_CHARS) || 30000;
const DEFAULT_CONTEXT = 5;
const MAX_CONTEXT_LINES = Math.min(30, Number(process.env.REFACTOR_MAX_CONTEXT) || 30);

// ---------------------------------------------------------------------------
// Module-level caches (per-process, keyed by `${repoRoot}::${sessionId}`)
// ---------------------------------------------------------------------------

const _loadCache = new Map();
// Reserved for Task 2.1 (apply/reapply) — declared now so Wave 2 only extends.
const _payloadCache = new Map();
// Keyed by `${repoRoot}::${sessionId}::${symbolName}`. Locks a group after 1 failed retry.
const _retryState = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== typeof b) return false;
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
        return true;
    }
    if (typeof a === 'object') {
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.length !== kb.length) return false;
        for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
        return true;
    }
    return false;
}

function findModal(items) {
    // items: array of structures (may contain null). Returns the non-null structure
    // that occurs most often by deep equality. Null if all entries are null.
    const buckets = [];
    for (const s of items) {
        if (s === null || s === undefined) continue;
        let hit = null;
        for (const b of buckets) {
            if (deepEqual(b.sample, s)) { hit = b; break; }
        }
        if (hit) hit.count++;
        else buckets.push({ sample: s, count: 1 });
    }
    if (!buckets.length) return null;
    buckets.sort((a, b) => b.count - a.count);
    return buckets[0].sample;
}

function firstDiffReason(modal, s) {
    if (!modal || !s) return null;
    if (!deepEqual(modal.params, s.params)) return 'param shape differs';
    if (!deepEqual(modal.returnKind, s.returnKind)) return 'return type differs';
    if (!deepEqual(modal.parentKind, s.parentKind)) return 'parent scope differs';
    if (!deepEqual(modal.decorators, s.decorators)) return 'decorators differ';
    if (!deepEqual(modal.modifiers, s.modifiers)) return 'modifiers differ';
    return null;
}

// Parses:
//   validateCard 1,2,3 ack:3
//   function validateCard(card) { ... }
//
//   chargeStripe 1,2
//   function chargeStripe(card, amount) { ... }
//
// Returns: [{symbol, indices: number[], ack: number[], body: string}, ...]
function parsePayload(payload) {
    const groups = [];
    const blocks = payload.split(/\n(?=[A-Za-z_$][\w$.]*\s+\d)/);
    for (const block of blocks) {
        const nl = block.indexOf('\n');
        if (nl === -1) continue;
        const header = block.slice(0, nl).trim();
        const body = block.slice(nl + 1).replace(/\n+$/, '');
        const m = header.match(/^([A-Za-z_$][\w$.]*)\s+([\d,\s]+?)(?:\s+ack:([\d,\s]+))?$/);
        if (!m) continue;
        const symbol = m[1];
        const indices = m[2].split(',').map(s => Number(s.trim())).filter(Number.isFinite);
        const ack = m[3] ? m[3].split(',').map(s => Number(s.trim())).filter(Number.isFinite) : [];
        groups.push({ symbol, indices, ack, body });
    }
    return groups;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function register(server, ctx) {
    server.registerTool("refactor_batch", {
        title: "Refactor Batch",
        description: "Apply one edit pattern across multiple similar symbols, with rollback.",
        inputSchema: z.object({
            mode: z.enum(["query", "load", "apply", "reapply"]).describe("Mode."),
            target: z.string().optional().describe("Symbol name."),
            fileScope: z.string().optional().describe("File path."),
            direction: z.enum(["forward", "reverse"]).default("forward").describe("forward=callers, reverse=callees."),
            depth: z.number().int().min(1).max(5).default(1).describe("Transitive depth."),
            selection: z.array(z.union([
                z.number().int().min(1),
                z.object({ symbol: z.string(), file: z.string().optional() }),
            ])).optional().describe("Indices or {symbol,file}."),
            contextLines: z.number().int().min(0).max(MAX_CONTEXT_LINES).default(DEFAULT_CONTEXT).describe("Context lines."),
            loadMore: z.boolean().default(false).describe("Continue truncated load."),
            payload: z.string().optional().describe("Diff with symbol headers."),
            dryRun: z.boolean().default(false).describe("Validate without writing."),
            symbolGroup: z.string().optional().describe("Prior symbol name."),
            newTargets: z.array(z.union([
                z.string(),
                z.object({ symbol: z.string(), file: z.string().optional() }),
            ])).optional().describe("Names or {symbol,file}."),
        }),
        annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true }
    }, async (args) => {
        const pc = getProjectContext(ctx);

        // =================================================================
        // QUERY
        // =================================================================
        if (args.mode === 'query') {
            const repoRoot = pc.getRoot(args.fileScope);
            if (!repoRoot) throw new Error("No project root.");

            const db = getDb(repoRoot);
            const count = db.prepare('SELECT COUNT(*) AS n FROM files').get().n;
            if (count === 0) {
                await indexDirectory(db, repoRoot, repoRoot, { maxFiles: 5000 });
            } else {
                // Fire-and-forget freshness refresh; don't block the query.
                (async () => {
                    try {
                        const rows = db.prepare('SELECT path FROM files').all();
                        const abs = rows.map(r => path.join(repoRoot, r.path));
                        await ensureIndexFresh(db, repoRoot, abs);
                    } catch { /* best-effort */ }
                })();
            }

            let relScope;
            if (args.fileScope) {
                const absScope = await ctx.validatePath(args.fileScope);
                relScope = path.relative(repoRoot, absScope);
            }

            const result = impactQuery(db, args.target, {
                file: relScope,
                depth: args.depth,
                direction: args.direction,
            });

            if (result.disambiguate) {
                return { content: [{ type: 'text', text: 'Multiple definitions:\n' + result.definitions.join('\n') }] };
            }

            const sessionId = ctx.sessionId || getSessionId();
            const cacheKey = `${repoRoot}::${sessionId}`;
            _loadCache.set(cacheKey, {
                results: result.results,
                remaining: [],
                contextLines: null,
            });

            if (!result.results.length) {
                return { content: [{ type: 'text', text: 'No references.' }] };
            }

            const lines = result.results.map((r, i) => {
                const idx = i + 1;
                if (args.direction === 'forward') {
                    return `${idx}) ${r.name}[${r.refCount}x] (${r.filePath})`;
                }
                return `${idx}) ${r.name}[${r.callCount}x]`;
            });
            lines.push(`${result.results.length} total`);
            return { content: [{ type: 'text', text: lines.join('\n') }] };
        }

        // =================================================================
        // LOAD
        // =================================================================
        if (args.mode === 'load') {
            const repoRoot = pc.getRoot();
            if (!repoRoot) throw new Error("No project root.");
            const db = getDb(repoRoot);
            const sessionId = ctx.sessionId || getSessionId();
            const cacheKey = `${repoRoot}::${sessionId}`;
            const cached = _loadCache.get(cacheKey);

            let workList;
            let contextLines;

            if (args.loadMore) {
                if (!cached || !cached.remaining.length) {
                    return { content: [{ type: 'text', text: 'Nothing to continue.' }] };
                }
                workList = cached.remaining.slice();
                contextLines = cached.contextLines ?? DEFAULT_CONTEXT;
            } else {
                contextLines = args.contextLines ?? DEFAULT_CONTEXT;
                workList = [];
                for (const entry of args.selection) {
                    if (typeof entry === 'number') {
                        if (!cached || !cached.results || !cached.results.length) {
                            return { content: [{ type: 'text', text: 'Run query first.' }] };
                        }
                        const r = cached.results[entry - 1];
                        if (!r) continue;
                        // Reverse results only have `name` — no file. Skip those gracefully.
                        if (!r.filePath) continue;
                        workList.push({ symbol: r.name, filePath: r.filePath });
                    } else {
                        let filePath = entry.file;
                        if (filePath && path.isAbsolute(filePath)) {
                            filePath = path.relative(repoRoot, filePath);
                        }
                        workList.push({ symbol: entry.symbol, filePath });
                    }
                }
            }

            // -----------------------------------------------------------------
            // Walk the workList, gather symbol occurrences grouped by symbol name.
            // -----------------------------------------------------------------
            const occurrences = []; // { symbol, relFile, absPath, source, sourceLines, line, endLine }

            for (let i = 0; i < workList.length; i++) {
                const { symbol, filePath } = workList[i];
                if (!filePath) continue;
                const absPath = path.join(repoRoot, filePath);

                let validPath;
                try { validPath = await ctx.validatePath(absPath); } catch { continue; }

                let source;
                try { source = await fs.readFile(validPath, 'utf-8'); } catch { continue; }

                const langName = getLangForFile(validPath);
                if (!langName) continue;

                const matches = await findSymbol(source, langName, symbol, { kindFilter: 'def' });
                if (!matches || !matches.length) continue;

                const sourceLines = source.split('\n');
                for (const m of matches) {
                    occurrences.push({
                        symbol,
                        relFile: filePath,
                        absPath: validPath,
                        source,
                        sourceLines,
                        line: m.line,
                        endLine: m.endLine,
                        workIndex: i,
                    });
                }
            }

            // -----------------------------------------------------------------
            // Outlier flagging: modal structure per symbol-name group.
            // -----------------------------------------------------------------
            const flagByOccurrence = new Map();
            const bySymbol = new Map();
            for (const occ of occurrences) {
                if (!bySymbol.has(occ.symbol)) bySymbol.set(occ.symbol, []);
                bySymbol.get(occ.symbol).push(occ);
            }
            for (const [, group] of bySymbol) {
                if (group.length < 2) continue;
                const structs = [];
                for (const occ of group) {
                    let s = null;
                    try {
                        const langName = getLangForFile(occ.absPath);
                        if (langName) s = await getSymbolStructure(occ.source, langName, occ.line, occ.endLine);
                    } catch { s = null; }
                    structs.push(s);
                }
                const modal = findModal(structs);
                if (!modal) continue;
                for (let i = 0; i < group.length; i++) {
                    const s = structs[i];
                    if (!s) continue;
                    if (deepEqual(s, modal)) continue;
                    const reason = firstDiffReason(modal, s);
                    if (reason) flagByOccurrence.set(group[i], reason);
                }
            }

            // -----------------------------------------------------------------
            // Emit blocks, honour MAX_CHARS without splitting a symbol.
            // -----------------------------------------------------------------
            const blocks = [];
            const fileCounts = new Map();
            let totalChars = 0;
            let cutAt = occurrences.length;
            const startIndex = args.loadMore ? (cached?.occurrences?.length || 0) : 0;

            for (let i = 0; i < occurrences.length; i++) {
                const occ = occurrences[i];
                const startIdx = Math.max(0, occ.line - 1 - contextLines);
                const endIdx = Math.min(occ.sourceLines.length, occ.endLine + contextLines);
                const bodyLines = occ.sourceLines.slice(startIdx, endIdx);
                const body = bodyLines.join('\n');

                const flag = flagByOccurrence.get(occ);
                const globalIndex = startIndex + i + 1;
                const header = flag
                    ? `${occ.symbol} [${globalIndex}] ${occ.relFile} ⚠ ${flag}`
                    : `${occ.symbol} [${globalIndex}] ${occ.relFile}`;
                const block = `${header}\n${body}\n`;

                if (totalChars > 0 && (totalChars + block.length) > MAX_CHARS) {
                    cutAt = i;
                    break;
                }
                blocks.push(block);
                totalChars += block.length;
                fileCounts.set(occ.relFile, (fileCounts.get(occ.relFile) || 0) + 1);
            }

            // Remaining entries (not yet loaded) — carry forward unique workIndices after cutAt.
            const loadedWorkIndices = new Set(occurrences.slice(0, cutAt).map(o => o.workIndex));
            const remaining = [];
            for (let i = 0; i < workList.length; i++) {
                if (!loadedWorkIndices.has(i)) remaining.push(workList[i]);
            }

            const emittedOccurrences = occurrences.slice(0, cutAt).map((o, i) => ({
                index: startIndex + i + 1,
                symbol: o.symbol,
                absPath: o.absPath,
                relFile: o.relFile,
                line: o.line,
                endLine: o.endLine,
                flag: flagByOccurrence.get(o) || null,
            }));
            const priorOccurrences = (args.loadMore && Array.isArray(cached?.occurrences))
                ? cached.occurrences
                : [];

            _loadCache.set(cacheKey, {
                results: cached?.results || [],
                remaining,
                contextLines,
                occurrences: priorOccurrences.concat(emittedOccurrences),
            });

            if (!blocks.length) {
                return { content: [{ type: 'text', text: 'No symbols loaded.' }] };
            }

            const header = [...fileCounts.entries()]
                .map(([f, n]) => `${n} in ${f}`)
                .join(', ');
            let out = header + '\n' + blocks.join('\n');

            if (remaining.length > 0) {
                out += `\n[truncated] ${remaining.length} remaining. Call load with loadMore=true.`;
            }

            return { content: [{ type: 'text', text: out }] };
        }

        // =================================================================
        // APPLY
        // =================================================================
        if (args.mode === 'apply') {
            const repoRoot = pc.getRoot();
            if (!repoRoot) throw new Error("No project root.");
            const db = getDb(repoRoot);
            const sessionId = ctx.sessionId || getSessionId();
            const cacheKey = `${repoRoot}::${sessionId}`;
            const cached = _loadCache.get(cacheKey);

            const groups = parsePayload(args.payload);
            if (!groups.length) {
                return { content: [{ type: 'text', text: 'No diff loaded. Call load first.' }] };
            }

            // Source of truth: `occurrences` cached by the previous `load` call.
            if (!cached || !Array.isArray(cached.occurrences) || cached.occurrences.length === 0) {
                return { content: [{ type: 'text', text: 'No diff loaded. Call load first.' }] };
            }

            // Build symbolName -> [occurrence] map, preserving the indices load printed.
            const loadedSymbols = new Map();
            for (const occ of cached.occurrences) {
                if (!loadedSymbols.has(occ.symbol)) loadedSymbols.set(occ.symbol, []);
                loadedSymbols.get(occ.symbol).push(occ);
            }

            // Flag set: every cached occurrence with a `flag` is an outlier.
            const flaggedIndices = new Set();
            for (const occ of cached.occurrences) {
                if (occ.flag) flaggedIndices.add(occ.index);
            }

            // Gate: every payload group symbol must exist in the loaded set.
            for (const g of groups) {
                if (!loadedSymbols.has(g.symbol)) {
                    return { content: [{ type: 'text', text: `Unknown symbol: ${g.symbol}. Load it first.` }] };
                }
            }

            // Gate: outlier ack. Each flagged occurrence in a group must be in its ack list.
            const unackFlagged = [];
            for (const g of groups) {
                const acks = new Set(g.ack);
                for (const idx of g.indices) {
                    if (flaggedIndices.has(idx) && !acks.has(idx)) unackFlagged.push(idx);
                }
            }
            if (unackFlagged.length) {
                return { content: [{ type: 'text', text: `Flagged outliers require ack: ${unackFlagged.join(',')}` }] };
            }

            // Gate: char budget.
            let totalBudget = 0;
            for (const g of groups) totalBudget += g.body.length * g.indices.length;
            if (totalBudget > MAX_CHARS) {
                return { content: [{ type: 'text', text: 'Over char budget. Split the apply into smaller groups.' }] };
            }

            // Gate: syntax.
            for (const g of groups) {
                const occList = loadedSymbols.get(g.symbol);
                const firstOcc = occList.find(o => g.indices.includes(o.index)) || occList[0];
                if (!firstOcc) continue;
                const langName = getLangForFile(firstOcc.absPath);
                if (!langName) continue;
                try {
                    const errs = await checkSyntaxErrors(g.body, langName);
                    if (errs && errs.length) {
                        return { content: [{ type: 'text', text: `Syntax error in ${g.symbol}: line ${errs[0].line}:${errs[0].column}` }] };
                    }
                } catch { /* best-effort */ }
            }

            // Build per-file edit bundles.
            // fileBundles: Map<absPath, { edits: [...], disambiguations: Map, occMeta: [{group, occ}] }>
            const fileBundles = new Map();
            for (const g of groups) {
                const occList = loadedSymbols.get(g.symbol);
                const selected = occList.filter(o => g.indices.includes(o.index));
                for (const occ of selected) {
                    if (!fileBundles.has(occ.absPath)) {
                        fileBundles.set(occ.absPath, { edits: [], disambiguations: new Map(), occMeta: [], relFile: occ.relFile });
                    }
                    const bundle = fileBundles.get(occ.absPath);
                    const editIdx = bundle.edits.length;
                    bundle.edits.push({ mode: 'symbol', symbol: g.symbol, newText: g.body });
                    // Always set a disambiguation anchor so batches with multiple symbols work.
                    bundle.disambiguations.set(editIdx, { nearLine: occ.line });
                    bundle.occMeta.push({ group: g, occ });
                }
            }

            const failedGroupMessages = new Map(); // symbolName -> message
            let successfulGroupNames = new Set();
            let successfulFileCount = 0;
            let warningSuffix = '';

            for (const [absPath, bundle] of fileBundles) {
                let content;
                try { content = await fs.readFile(absPath, 'utf-8'); }
                catch (err) {
                    // Mark every group in this file as failed.
                    for (const { group } of bundle.occMeta) {
                        if (!failedGroupMessages.has(group.symbol)) {
                            const retryKey = `${repoRoot}::${sessionId}::${group.symbol}`;
                            const count = (_retryState.get(retryKey) || 0) + 1;
                            _retryState.set(retryKey, count);
                            if (count >= 2) {
                                failedGroupMessages.set(group.symbol, `Group ${group.symbol} locked. Use edit_file directly.`);
                            } else {
                                failedGroupMessages.set(group.symbol, `Group ${group.symbol} failed: ${err.message}. Retry once or use edit_file directly.`);
                            }
                        }
                    }
                    continue;
                }

                const result = await applyEditList(content, bundle.edits, {
                    filePath: absPath,
                    isBatch: bundle.edits.length > 1,
                    disambiguations: bundle.disambiguations,
                });

                if (result.errors && result.errors.length) {
                    // Determine which groups failed by mapping error indices to occMeta.
                    const failedEditIdx = new Set(result.errors.map(e => e.i));
                    const failedSymbolsInFile = new Set();
                    let firstErrMsgBySymbol = new Map();
                    for (let i = 0; i < bundle.occMeta.length; i++) {
                        if (failedEditIdx.has(i)) {
                            const sym = bundle.occMeta[i].group.symbol;
                            failedSymbolsInFile.add(sym);
                            if (!firstErrMsgBySymbol.has(sym)) {
                                const errRec = result.errors.find(e => e.i === i);
                                firstErrMsgBySymbol.set(sym, errRec?.msg || 'edit failed');
                            }
                        }
                    }
                    // Even a single failure in the bundle means we must not write this file
                    // (applyEditList returned a partially-applied workingContent, but we treat
                    // per-file as atomic: any failure => skip the write for this file).
                    for (const sym of failedSymbolsInFile) {
                        if (failedGroupMessages.has(sym)) continue;
                        const retryKey = `${repoRoot}::${sessionId}::${sym}`;
                        const count = (_retryState.get(retryKey) || 0) + 1;
                        _retryState.set(retryKey, count);
                        const errMsg = firstErrMsgBySymbol.get(sym) || 'edit failed';
                        if (count >= 2) {
                            failedGroupMessages.set(sym, `Group ${sym} locked. Use edit_file directly.`);
                        } else {
                            failedGroupMessages.set(sym, `Group ${sym} failed: ${errMsg}. Retry once or use edit_file directly.`);
                        }
                    }
                    // Skip write for this file. Successful groups in OTHER files are still written.
                    continue;
                }

                if (args.dryRun) {
                    successfulFileCount++;
                    for (const { group } of bundle.occMeta) successfulGroupNames.add(group.symbol);
                    continue;
                }

                // Atomic write.
                const tempPath = `${absPath}.${randomBytes(16).toString('hex')}.tmp`;
                try {
                    await fs.writeFile(tempPath, result.workingContent, 'utf-8');
                    await fs.rename(tempPath, absPath);
                } catch (err) {
                    try { await fs.unlink(tempPath); } catch {}
                    for (const { group } of bundle.occMeta) {
                        if (failedGroupMessages.has(group.symbol)) continue;
                        const retryKey = `${repoRoot}::${sessionId}::${group.symbol}`;
                        const count = (_retryState.get(retryKey) || 0) + 1;
                        _retryState.set(retryKey, count);
                        if (count >= 2) {
                            failedGroupMessages.set(group.symbol, `Group ${group.symbol} locked. Use edit_file directly.`);
                        } else {
                            failedGroupMessages.set(group.symbol, `Group ${group.symbol} failed: ${err.message}. Retry once or use edit_file directly.`);
                        }
                    }
                    continue;
                }

                successfulFileCount++;
                for (const { group } of bundle.occMeta) successfulGroupNames.add(group.symbol);

                // Snapshot commits (best-effort).
                try {
                    const relPath = path.relative(repoRoot, absPath);
                    for (const snap of (result.pendingSnapshots || [])) {
                        snapshotSymbol(db, snap.symbol, relPath, snap.originalText, sessionId, snap.line);
                    }
                } catch { /* best-effort */ }

                // Re-index (best-effort).
                try { await ensureIndexFresh(db, repoRoot, [absPath]); } catch { /* best-effort */ }

                // Syntax warning suffix.
                try {
                    const warn = await syntaxWarn(absPath, result.workingContent);
                    if (warn) warningSuffix += warn;
                } catch { /* best-effort */ }
            }

            // Populate payload cache for successful groups (for reapply). Never on dry-run.
            if (!args.dryRun) {
                for (const g of groups) {
                    if (successfulGroupNames.has(g.symbol) && !failedGroupMessages.has(g.symbol)) {
                        _payloadCache.set(`${repoRoot}::${sessionId}::${g.symbol}`, { body: g.body, ack: g.ack });
                    }
                }
            }

            if (failedGroupMessages.size) {
                const lines = [...failedGroupMessages.values()];
                if (successfulGroupNames.size) {
                    const okCount = [...successfulGroupNames].filter(s => !failedGroupMessages.has(s)).length;
                    if (okCount) lines.unshift(`Applied ${okCount} symbols across ${successfulFileCount} files.`);
                }
                return { content: [{ type: 'text', text: lines.join('\n') + warningSuffix }] };
            }

            if (args.dryRun) {
                return { content: [{ type: 'text', text: `Dry run: ${successfulGroupNames.size} symbols across ${successfulFileCount} files.` }] };
            }

            return { content: [{ type: 'text', text: `Applied ${successfulGroupNames.size} symbols across ${successfulFileCount} files.${warningSuffix}` }] };
        }

        // =================================================================
        // REAPPLY
        // =================================================================
        if (args.mode === 'reapply') {
            const repoRoot = pc.getRoot();
            if (!repoRoot) throw new Error("No project root.");
            const db = getDb(repoRoot);
            const sessionId = ctx.sessionId || getSessionId();

            const payloadKey = `${repoRoot}::${sessionId}::${args.symbolGroup}`;
            const cachedPayload = _payloadCache.get(payloadKey);
            if (!cachedPayload) {
                return { content: [{ type: 'text', text: `No cached payload for ${args.symbolGroup}.` }] };
            }

            // Resolve new targets to occurrences.
            const targets = []; // { absPath, relFile, source, line, endLine }
            const skipped = [];
            for (const entry of args.newTargets) {
                let symName, file;
                if (typeof entry === 'string') { symName = entry; file = undefined; }
                else { symName = entry.symbol; file = entry.file; }

                // Candidate files: explicit file hint, else look up def occurrences from the symbol index.
                let candidateFiles;
                if (file) {
                    candidateFiles = [file];
                } else {
                    const rows = db.prepare(
                        "SELECT DISTINCT file_path FROM symbols WHERE name = ? AND kind = 'def'"
                    ).all(symName);
                    if (!rows.length) { skipped.push(symName); continue; }
                    candidateFiles = rows.map(r => r.file_path);
                }

                let addedAny = false;
                for (const cf of candidateFiles) {
                    const absPath = path.isAbsolute(cf) ? cf : path.join(repoRoot, cf);
                    let validPath;
                    try { validPath = await ctx.validatePath(absPath); } catch { continue; }
                    let source;
                    try { source = await fs.readFile(validPath, 'utf-8'); } catch { continue; }
                    const langName = getLangForFile(validPath);
                    if (!langName) continue;
                    const matches = await findSymbol(source, langName, symName, { kindFilter: 'def' });
                    if (!matches || !matches.length) continue;
                    for (const m of matches) {
                        targets.push({
                            symbol: symName,
                            absPath: validPath,
                            relFile: path.relative(repoRoot, validPath),
                            source,
                            line: m.line,
                            endLine: m.endLine,
                        });
                        addedAny = true;
                    }
                }
                if (!addedAny) skipped.push(symName);
            }

            if (!targets.length) {
                const suffix = skipped.length ? ` (skipped ${skipped.length})` : '';
                return { content: [{ type: 'text', text: `Reapplied 0 targets.${suffix}` }] };
            }

            // Outlier flagging across new targets themselves.
            const structs = [];
            for (const t of targets) {
                let s = null;
                try {
                    const langName = getLangForFile(t.absPath);
                    if (langName) s = await getSymbolStructure(t.source, langName, t.line, t.endLine);
                } catch { s = null; }
                structs.push(s);
            }
            if (targets.length >= 2) {
                const modal = findModal(structs);
                if (modal) {
                    const flagged = [];
                    for (let i = 0; i < targets.length; i++) {
                        const s = structs[i];
                        if (!s) continue;
                        if (!deepEqual(s, modal)) flagged.push(i + 1);
                    }
                    if (flagged.length) {
                        return { content: [{ type: 'text', text: `Flagged outliers require ack: ${flagged.join(',')}` }] };
                    }
                }
            }

            // Syntax gate on the cached body (language of first target).
            try {
                const langName = getLangForFile(targets[0].absPath);
                if (langName) {
                    const errs = await checkSyntaxErrors(cachedPayload.body, langName);
                    if (errs && errs.length) {
                        return { content: [{ type: 'text', text: `Syntax error in ${args.symbolGroup}: line ${errs[0].line}:${errs[0].column}` }] };
                    }
                }
            } catch { /* best-effort */ }

            // Char budget.
            if (cachedPayload.body.length * targets.length > MAX_CHARS) {
                return { content: [{ type: 'text', text: 'Over char budget. Split the apply into smaller groups.' }] };
            }

            // Build per-file bundles.
            const fileBundles = new Map();
            for (const t of targets) {
                if (!fileBundles.has(t.absPath)) {
                    fileBundles.set(t.absPath, { edits: [], disambiguations: new Map(), occMeta: [] });
                }
                const bundle = fileBundles.get(t.absPath);
                const editIdx = bundle.edits.length;
                bundle.edits.push({ mode: 'symbol', symbol: t.symbol, newText: cachedPayload.body });
                bundle.disambiguations.set(editIdx, { nearLine: t.line });
                bundle.occMeta.push(t);
            }

            let reappliedCount = 0;
            let warningSuffix = '';

            for (const [absPath, bundle] of fileBundles) {
                let content;
                try { content = await fs.readFile(absPath, 'utf-8'); } catch { continue; }
                const result = await applyEditList(content, bundle.edits, {
                    filePath: absPath,
                    isBatch: bundle.edits.length > 1,
                    disambiguations: bundle.disambiguations,
                });
                if (result.errors && result.errors.length) continue;

                if (args.dryRun) {
                    reappliedCount += bundle.occMeta.length;
                    continue;
                }

                const tempPath = `${absPath}.${randomBytes(16).toString('hex')}.tmp`;
                try {
                    await fs.writeFile(tempPath, result.workingContent, 'utf-8');
                    await fs.rename(tempPath, absPath);
                } catch {
                    try { await fs.unlink(tempPath); } catch {}
                    continue;
                }
                reappliedCount += bundle.occMeta.length;

                try {
                    const relPath = path.relative(repoRoot, absPath);
                    for (const snap of (result.pendingSnapshots || [])) {
                        snapshotSymbol(db, snap.symbol, relPath, snap.originalText, sessionId, snap.line);
                    }
                } catch { /* best-effort */ }
                try { await ensureIndexFresh(db, repoRoot, [absPath]); } catch { /* best-effort */ }
                try {
                    const warn = await syntaxWarn(absPath, result.workingContent);
                    if (warn) warningSuffix += warn;
                } catch { /* best-effort */ }
            }

            const skippedSuffix = skipped.length ? ` (skipped ${skipped.length})` : '';
            if (args.dryRun) {
                return { content: [{ type: 'text', text: `Dry run: ${reappliedCount} targets.${skippedSuffix}` }] };
            }
            return { content: [{ type: 'text', text: `Reapplied ${reappliedCount} targets.${skippedSuffix}${warningSuffix}` }] };
        }

        throw new Error('Invalid mode.');
    });
}
