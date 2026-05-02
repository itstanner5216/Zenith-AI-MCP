export declare const TOKEN_WEIGHTS: Record<string, number>;
export declare const MANIFEST_LANGUAGE_MAP: Record<string, string[]>;
export declare const LOCKFILE_NAMES: Set<string>;
export declare function buildTokens(input: {
    foundFiles: Set<string>;
    readmeLines?: string[];
}): Record<string, number>;
