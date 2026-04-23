import { z } from "zod";
import fs from "fs/promises";
import path from 'path';
import { randomBytes } from 'crypto';
import { normalizeLineEndings, createMinimalDiff } from '../core/lib.js';
import { getLangForFile, findSymbol } from '../core/tree-sitter.js';
import { getStashEntry, consumeAttempt, clearStash, listStash } from '../core/stash.js';
import { getProjectContext } from '../core/project-context.js';
import { findMatch, applyEditList, syntaxWarn } from '../core/edit-engine.js';
import {
    findRepoRoot, getDb, indexFile,
    getVersionHistory, getVersionText,
    snapshotSymbol, getSessionId,
} from '../core/symbol-index.js';

export function register(server, ctx) {
    server.registerTool("stashRestore", {
        title: "Stash Restore",
        description: "Retry failed edits/writes, restore previous versions, or browse cached entries.",
        inputSchema: z.discriminatedUnion("mode", [
            z.object({
                mode: z.literal("apply").describe("Retry a stashed failed edit or write."),
                stashId: z.number().describe("Stash entry ID."),
                corrections: z.array(z.object({
                    index: z.number().describe("1-based edit index to disambiguate."),
                    startLine: z.number().optional().describe("Exact line for ambiguous block edits."),
                    nearLine: z.number().optional().describe("Approximate line for ambiguous symbol edits."),
                })).optional().describe("Disambiguation for failed edits."),
                newPath: z.string().optional().describe("Redirect a failed write to a different path."),
                dryRun: z.boolean().optional().default(false).describe("Preview without writing."),
            }),
            z.object({
                mode: z.literal("restore").describe("Restore a symbol to a previous version, or clear a stash entry."),
                stashId: z.number().optional().describe("Stash ID to clear."),
                symbol: z.string().optional().describe("Symbol name to restore."),
                version: z.number().optional().describe("Version number from history."),
                file: z.string().optional().describe("File containing the symbol."),
                dryRun: z.boolean().optional().default(false).describe("Preview without writing."),
            }),
            z.object({
                mode: z.literal("list").describe("Show all stash entries."),
                type: z.enum(['edit', 'write']).optional().describe("Filter by entry type."),
            }),
            z.object({
                mode: z.literal("read").describe("View contents of a stash entry."),
                stashId: z.number().describe("Stash entry ID."),
            }),
            z.object({
                mode: z.literal("init").describe("Register a non-git directory as a project root."),
                projectRoot: z.string().describe("Directory to register."),
                projectName: z.string().optional().describe("Optional project name."),
            }),
            z.object({
                mode: z.literal("history").describe("List version snapshots for a symbol."),
                symbol: z.string().describe("Symbol name. Dot-qualified for methods."),
                file: z.string().optional().describe("Restrict to one file."),
            }),
        ]),
        annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true }
    }, async (args) => {

        const pc = getProjectContext(ctx);

        // =================================================================
        // INIT — register a project root (no git needed)
        // =================================================================
        if (args.mode === 'init') {
            if (!args.projectRoot) throw new Error('projectRoot required.');
            pc.initProject(args.projectRoot, args.projectName);
            return { content: [{ type: 'text', text: `Registered.` }] };
        }

        // =================================================================
        // LIST
        // =================================================================
        if (args.mode === 'list') {
            const { entries, isGlobal } = listStash(ctx, args.file);
            let filtered = entries;
            if (args.type) {
                filtered = entries.filter(e => e.type === args.type);
            }
            if (!filtered.length) {
                const msg = isGlobal ? 'Empty. (global)' : 'Empty.';
                return { content: [{ type: 'text', text: msg }] };
            }
            const lines = filtered.map(e =>
                `#${e.id} [${e.type}] ${e.filePath} (attempt ${e.attempts}/2)`
            );
            if (isGlobal) lines.unshift('(global stash — no project detected)');
            return { content: [{ type: 'text', text: lines.join('\n') }] };
        }

        // =================================================================
        // READ
        // =================================================================
        if (args.mode === 'read') {
            if (!args.stashId) throw new Error('stashId required.');
            const entry = getStashEntry(ctx, args.stashId, args.file);
            if (!entry) throw new Error(`Stash #${args.stashId} not found.`);

            if (entry.type === 'edit') {
                const edits = entry.payload.edits;
                const failed = entry.payload.failedIndices;
                const lines = edits.map((e, i) => {
                    const status = failed.includes(i) ? 'FAILED' : 'ok';
                    const mode = e.symbol ? `symbol:${e.symbol}` : e.block_start ? `block:${e.block_start}...${e.block_end}` : `content`;
                    return `#${i + 1} [${status}] ${mode}`;
                });
                return { content: [{ type: 'text', text: `[edit] ${entry.filePath}\n${lines.join('\n')}` }] };
            }

            if (entry.type === 'write') {
                const p = entry.payload;
                const preview = p.content.length > 500 ? p.content.slice(0, 500) + '...' : p.content;
                return { content: [{ type: 'text', text: `[write] ${entry.filePath}\n${preview}` }] };
            }
        }

        // =================================================================
        // HISTORY — list version snapshots for a symbol
        // =================================================================
        if (args.mode === 'history') {
            const filePath = args.file || ctx.getAllowedDirectories()[0];
            const absPath = await ctx.validatePath(filePath);
            const repoRoot = findRepoRoot(absPath) || path.dirname(absPath);
            const db = getDb(repoRoot);
            const sessionId = ctx.sessionId || getSessionId();
            const relPath = args.file ? path.relative(repoRoot, absPath) : null;
            const rows = getVersionHistory(db, args.symbol, sessionId, relPath);
            if (!rows.length) {
                return { content: [{ type: 'text', text: 'Empty.' }] };
            }
            const lines = rows.map((r, i) => `v${i} ${r.file_path} ${new Date(r.created_at).toISOString()}`);
            return { content: [{ type: 'text', text: lines.join('\n') }] };
        }

        // =================================================================
        // RESTORE — rollback a stash entry or restore a symbol version
        // =================================================================
        if (args.mode === 'restore') {
            // Symbol version restore
            if (args.symbol) {
                const filePath = args.file;
                if (!filePath) throw new Error('file required for symbol restore.');
                const absPath = await ctx.validatePath(filePath);
                const repoRoot = findRepoRoot(absPath) || path.dirname(absPath);
                const db = getDb(repoRoot);

                if (args.version !== undefined) {
                    const relPath = path.relative(repoRoot, absPath);
                    const history = getVersionHistory(db, args.symbol, ctx.sessionId || getSessionId(), relPath);
                    const versionEntry = history?.[args.version];
                    if (!versionEntry) throw new Error(`${args.symbol}: version ${args.version} not found.`);
                    const text = getVersionText(db, versionEntry.id);
                    if (!text) throw new Error(`${args.symbol}: version ${args.version} text not found.`);

                    const content = normalizeLineEndings(await fs.readFile(absPath, 'utf-8'));
                    const langName = getLangForFile(absPath);
                    if (!langName) throw new Error(`${args.symbol}: unsupported language.`);

                    const matches = await findSymbol(content, langName, args.symbol, { kindFilter: 'def' });
                    if (!matches?.length) throw new Error(`${args.symbol}: not found in file.`);
                    const sym = matches[0];
                    const lines = content.split('\n');
                    lines.splice(sym.line - 1, sym.endLine - (sym.line - 1), ...text.split('\n'));
                    const newContent = lines.join('\n');

                    if (!args.dryRun) {
                        try {
                            const sessionId = ctx.sessionId || getSessionId();
                            const relPath = path.relative(repoRoot, absPath);
                            const curLines = content.split('\n');
                            const curText = curLines.slice(sym.line - 1, sym.endLine).join('\n');
                            snapshotSymbol(db, args.symbol, relPath, curText, sessionId, sym.line);
                        } catch { /* best-effort */ }
                        const tempPath = `${absPath}.${randomBytes(16).toString('hex')}.tmp`;
                        await fs.writeFile(tempPath, newContent, 'utf-8');
                        await fs.rename(tempPath, absPath);
                        await indexFile(db, repoRoot, absPath);
                    }
                    return { content: [{ type: 'text', text: `${args.symbol}: restored to v${args.version}.` }] };
                } else {
                    const relPath = path.relative(repoRoot, absPath);
                    const rows = getVersionHistory(db, args.symbol, ctx.sessionId || getSessionId(), relPath);
                    if (!rows.length) {
                        return { content: [{ type: 'text', text: 'Empty.' }] };
                    }
                    const lines = rows.map((r, i) => `v${i} ${new Date(r.created_at).toISOString()}`);
                    return { content: [{ type: 'text', text: lines.join('\n') }] };
                }
            }

            // Stash entry rollback
            if (!args.stashId) throw new Error('stashId or symbol required for restore.');
            const entry = getStashEntry(ctx, args.stashId, args.file);
            if (!entry) throw new Error(`Stash #${args.stashId} not found.`);
            clearStash(ctx, args.stashId, args.file);
            return { content: [{ type: 'text', text: `Cleared.` }] };
        }

        // =================================================================
        // APPLY — retry a cached edit or write
        // =================================================================
        if (args.mode === 'apply') {
            if (!args.stashId) throw new Error('stashId required.');

            const entry = getStashEntry(ctx, args.stashId, args.newPath || args.file);
            if (!entry) throw new Error(`Stash #${args.stashId} not found or expired.`);

            if (!args.dryRun) {
                const canRetry = consumeAttempt(ctx, args.stashId, entry.filePath);
                if (!canRetry) throw new Error(`Stash #${args.stashId}: max retries (2) exceeded. Stash removed.`);
            }

            // --- Edit apply ---
            if (entry.type === 'edit') {
                const validPath = await ctx.validatePath(entry.filePath);
                const originalContent = normalizeLineEndings(await fs.readFile(validPath, 'utf-8'));
                const edits = entry.payload.edits;
                const failedIndices = entry.payload.failedIndices;
                const corrections = args.corrections || [];

                const disambiguations = new Map();
                for (const c of corrections) {
                    disambiguations.set(c.index - 1, { startLine: c.startLine, nearLine: c.nearLine });
                }
                const { workingContent, errors, pendingSnapshots } = await applyEditList(originalContent, edits, {
                    filePath: validPath,
                    isBatch: edits.length > 1,
                    disambiguations,
                });

                if (errors.length > 0) {
                    const failMsg = errors.map(e => e.msg).join('\n');
                    throw new Error(`${errors.length} failed.\n${failMsg}`);
                }

                if (args.dryRun) {
                    const patch = createMinimalDiff(originalContent, workingContent, validPath);
                    return { content: [{ type: 'text', text: patch }] };
                }

                const tempPath = `${validPath}.${randomBytes(16).toString('hex')}.tmp`;
                try {
                    await fs.writeFile(tempPath, workingContent, 'utf-8');
                    await fs.rename(tempPath, validPath);
                    clearStash(ctx, args.stashId, entry.filePath);
                } catch (error) {
                    try { await fs.unlink(tempPath); } catch {}
                    throw error;
                }

                if (!args.dryRun && pendingSnapshots && pendingSnapshots.length > 0) {
                    try {
                        const repoRoot = findRepoRoot(validPath) || path.dirname(validPath);
                        const db = getDb(repoRoot);
                        const sessionId = ctx.sessionId || getSessionId();
                        const relPath = path.relative(repoRoot, validPath);
                        for (const snap of pendingSnapshots) {
                            snapshotSymbol(db, snap.symbol, relPath, snap.originalText, sessionId, snap.line);
                        }
                    } catch { /* best-effort */ }
                }

                const warning = await syntaxWarn(validPath, workingContent);
                return { content: [{ type: 'text', text: `Applied.${warning}` }] };
            }

            // --- Write apply ---
            if (entry.type === 'write') {
                const targetPath = args.newPath || entry.filePath;
                const validPath = await ctx.validatePath(targetPath);
                const content = entry.payload.content;
                const parentDir = path.dirname(validPath);
                try { await fs.mkdir(parentDir, { recursive: true }); } catch (err) {
                    if (err.code !== 'EEXIST') throw new Error(`Cannot create directory: ${err.message}`);
                }

                if (args.dryRun) {
                    return { content: [{ type: 'text', text: `${Buffer.byteLength(content, 'utf-8')} bytes` }] };
                }

                const tempPath = `${validPath}.${randomBytes(16).toString('hex')}.tmp`;
                try {
                    if (entry.payload.mode === 'append') {
                        let finalContent = content;
                        let existed = false;
                        try { await fs.stat(validPath); existed = true; } catch {}
                        if (existed) {
                            const existing = await fs.readFile(validPath, 'utf-8');
                            const existingLines = existing.split('\n');
                            const incomingLines = content.split('\n');
                            const tailLines = existingLines.slice(-500);
                            let overlap = 0;
                            if (tailLines.length && incomingLines.length) {
                                const trim = s => s.trimEnd();
                                const first = trim(incomingLines[0]);
                                for (let i = 0; i < tailLines.length; i++) {
                                    if (trim(tailLines[i]) !== first) continue;
                                    const overlapLen = Math.min(tailLines.length - i, incomingLines.length);
                                    let matched = true;
                                    for (let j = 0; j < overlapLen; j++) {
                                        if (trim(tailLines[i + j]) !== trim(incomingLines[j])) { matched = false; break; }
                                    }
                                    if (matched) { overlap = overlapLen; break; }
                                }
                            }
                            const appendChunk = overlap > 0 ? incomingLines.slice(overlap).join('\n') : content;
                            const separator = existing.endsWith('\n') ? '' : '\n';
                            finalContent = existing + separator + appendChunk;
                        }
                        await fs.writeFile(tempPath, finalContent, 'utf-8');
                        await fs.rename(tempPath, validPath);
                    } else {
                        await fs.writeFile(tempPath, content, 'utf-8');
                        await fs.rename(tempPath, validPath);
                    }
                } catch (error) {
                    try { await fs.unlink(tempPath); } catch {}
                    throw new Error(`Write retry failed: ${error.message}`);
                }

                clearStash(ctx, args.stashId, entry.filePath);
                return { content: [{ type: 'text', text: `Applied.` }] };
            }

            throw new Error(`Unknown stash type: ${entry.type}`);
        }

        throw new Error('Invalid mode.');
    });
}
