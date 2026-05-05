import { compressToon } from './toon_bridge.js';

export const DEFAULT_COMPRESSION_KEEP_RATIO = 0.70;

export function computeCompressionBudget(rawLength: number, maxChars: number, keepRatio = DEFAULT_COMPRESSION_KEEP_RATIO): number {
    if (!Number.isFinite(rawLength) || rawLength <= 0) return 0;
    const boundedMaxChars = Math.max(0, Math.floor(maxChars));
    const ratioBudget = Math.max(1, Math.floor(rawLength * keepRatio));
    return Math.min(boundedMaxChars, ratioBudget);
}

export function isCompressionUseful(rawText: unknown, compressedText: unknown, maxChars: number, keepRatio = DEFAULT_COMPRESSION_KEEP_RATIO): boolean {
    if (typeof rawText !== 'string' || typeof compressedText !== 'string') return false;
    if (compressedText.length === 0 || rawText.length === 0) return false;

    const targetBudget = computeCompressionBudget(rawText.length, maxChars, keepRatio);
    if (targetBudget <= 0 || targetBudget >= rawText.length) return false;

    return compressedText.length < rawText.length && compressedText.length <= targetBudget;
}

export function truncateToBudget(text: unknown, budget: number): { text: string; truncated: boolean } {
    if (typeof text !== 'string') {
        return { text: '', truncated: false };
    }

    if (text.length <= budget) {
        return { text, truncated: false };
    }

    let cutoff = text.lastIndexOf('\n', budget);
    if (cutoff === -1) cutoff = budget;

    return {
        text: text.slice(0, cutoff),
        truncated: true,
    };
}

export async function compressTextFile(validPath: string, rawText: string, maxChars: number, keepRatio = DEFAULT_COMPRESSION_KEEP_RATIO): Promise<{ text: string; targetBudget: number; rawLength: number; compressedLength: number } | null> {
    const targetBudget = computeCompressionBudget(rawText.length, maxChars, keepRatio);
    if (targetBudget <= 0 || targetBudget >= rawText.length) {
        return null;
    }

    try {
        const compressed = await compressToon(rawText, targetBudget, validPath);
        if (!isCompressionUseful(rawText, compressed, maxChars, keepRatio)) {
            return null;
        }

        return {
            text: compressed,
            targetBudget,
            rawLength: rawText.length,
            compressedLength: compressed.length,
        };
    } catch {
        return null;
    }
}
