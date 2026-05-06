import path from 'path';
import { normalizePath } from './path-utils.js';

/**
 * Check if a path is within allowed directories
 */
export function isPathWithinAllowedDirectories(filePath: string, allowedDirectories: string[]): boolean {
    const normalized = normalizePath(filePath);
    const resolved = path.resolve(normalized);
    return allowedDirectories.some(dir => {
        const normalizedDir = path.resolve(normalizePath(dir));
        return resolved === normalizedDir || resolved.startsWith(normalizedDir + '/');
    });
}
