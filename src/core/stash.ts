import { getProjectContext } from './project-context.js';

const MAX_ATTEMPTS = 2;

function getDb(ctx: any, filePath: string) {
    const pc = getProjectContext(ctx);
    return pc.getStashDb(filePath);
}

export function stashEntry(ctx: any, type: string, filePath: string, payload: any) {
    const { db } = getDb(ctx, filePath);
    const result = db.prepare(
        'INSERT INTO stash (type, file_path, payload, attempts, created_at) VALUES (?, ?, ?, 0, ?)' 
    ).run(type, filePath, JSON.stringify(payload), Date.now());
    return result.lastInsertRowid;
}

export function getStashEntry(ctx: any, id: number, filePath: string) {
    const { db } = getDb(ctx, filePath);
    const row = db.prepare('SELECT * FROM stash WHERE id = ?').get(id);
    if (!row) return null;
    return {
        id: row.id,
        type: row.type,
        filePath: row.file_path,
        payload: JSON.parse(row.payload),
        attempts: row.attempts,
        createdAt: row.created_at,
    };
}

export function consumeAttempt(ctx: any, id: number, filePath: string) {
    const { db } = getDb(ctx, filePath);
    const row = db.prepare('SELECT attempts FROM stash WHERE id = ?').get(id);
    if (!row) return false;
    const next = row.attempts + 1;
    db.prepare('UPDATE stash SET attempts = ? WHERE id = ?').run(next, id);
    if (next > MAX_ATTEMPTS) {
        db.prepare('DELETE FROM stash WHERE id = ?').run(id);
        return false;
    }
    return true;
}

export function clearStash(ctx: any, id: number, filePath: string) {
    const { db } = getDb(ctx, filePath);
    db.prepare('DELETE FROM stash WHERE id = ?').run(id);
}

export function listStash(ctx: any, filePath: string) {
    const { db, isGlobal } = getDb(ctx, filePath);
    const rows = db.prepare('SELECT * FROM stash ORDER BY id').all().map((row: any) => ({
        id: row.id,
        type: row.type,
        filePath: row.file_path,
        payload: JSON.parse(row.payload),
        attempts: row.attempts,
        createdAt: row.created_at,
    }));
    return { entries: rows, isGlobal };
}

export function stashEdits(ctx: any, filePath: string, edits: any, failedIndices: any) {
    return stashEntry(ctx, 'edit', filePath, { edits, failedIndices });
}

export function stashWrite(ctx: any, filePath: string, content: string, mode: string) {
    return stashEntry(ctx, 'write', filePath, { content, mode: mode || 'overwrite' });
}
