/**
 * Normalizes a path for Linux/Unix systems.
 * Resolves ~, strips quotes, collapses slashes, resolves . and .. segments.
 */
export declare function normalizePath(p: string): string;
/**
 * Expands home directory tilde in paths
 */
export declare function expandHome(filepath: string): string;
/**
 * Check if a path is within allowed directories
 */
export declare function isPathWithinAllowedDirectories(filePath: string, allowedDirectories: string[]): boolean;
