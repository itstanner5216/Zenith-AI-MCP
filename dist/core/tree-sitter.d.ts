/**
 * Get the tree-sitter language name for a file path.
 * Returns null if the extension is not supported.
 */
export declare function getLangForFile(filePath?: string): any;
/**
 * Get all supported file extensions.
 */
export declare function getSupportedExtensions(): string[];
/**
 * Check if a file can be parsed by tree-sitter.
 */
export declare function isSupported(filePath: any): boolean;
/**
 * @typedef {Object} Symbol
 * @property {string}  name     - Symbol identifier (e.g. 'sendMessage')
 * @property {string}  kind     - 'def' or 'ref'
 * @property {string}  type     - Symbol type: 'function', 'class', 'method',
 *                                'interface', 'type', 'enum', 'module',
 *                                'call', 'key', 'section', 'selector', etc.
 * @property {number}  line     - 1-based start line of the identifier
 * @property {number}  endLine  - 1-based end line of the full definition body
 * @property {number}  column   - 0-based column of the identifier
 */
/**
 * Extract all symbols from source code.
 *
 * Uses query.matches() to properly pair @name.definition.* captures with
 * their sibling @definition.* captures, giving us both the symbol name
 * and its full body extent.
 *
 * @param {string} source   - the source code
 * @param {string} langName - tree-sitter language name
 * @param {Object} [options]
 * @param {string} [options.nameFilter]   - substring filter on symbol name (case-insensitive)
 * @param {string} [options.kindFilter]   - 'def' or 'ref'
 * @param {string} [options.typeFilter]   - 'function', 'class', 'method', etc.
 * @param {string[]} [options.excludeNames] - exact names to exclude
 * @returns {Promise<Symbol[] | null>} null if language not supported or no query
 */
export declare function getSymbols(source: any, langName: any, options?: {}): Promise<any>;
/**
 * Get only definitions from source code.
 * Convenience wrapper around getSymbols with kindFilter='def'.
 */
export declare function getDefinitions(source: any, langName: any, options?: {}): Promise<any>;
export declare function getCompressionStructure(source?: string, langName?: string): Promise<any>;
/**
 * Get a summary count of symbols by type for a file.
 *
 * @param {string} source   - the source code
 * @param {string} langName - tree-sitter language name
 * @returns {Promise<{ defs: Object, refs: Object, defTotal: number, refTotal: number } | null>}
 */
export declare function getSymbolSummary(source: any, langName: any): Promise<{
    defs: {};
    refs: {};
    defTotal: number;
    refTotal: number;
} | null>;
/**
 * Format a symbol summary as a compact string for directory listings.
 * E.g. "3 functions, 1 class, 2 methods" — definitions only.
 * Returns null if no definitions found or language not supported.
 */
export declare function getSymbolSummaryString(source: any, langName: any): Promise<string | null>;
/**
 * Find a specific symbol by name in source code.
 *
 * Supports dot-qualified names like "MyClass.sendMessage" — splits on '.'
 * and checks that the symbol named 'sendMessage' is contained within
 * a symbol named 'MyClass'.
 *
 * If multiple matches exist and nearLine is provided, sorts by proximity.
 * Otherwise returns all matches (caller decides whether to reject or pick).
 *
 * @param {string} source      - the source code
 * @param {string} langName    - tree-sitter language name
 * @param {string} symbolName  - exact name or dot-qualified name
 * @param {Object} [options]
 * @param {string} [options.kindFilter] - 'def' or 'ref' (default: 'def')
 * @param {number} [options.nearLine]   - prefer match closest to this line
 * @returns {Promise<Symbol[] | null>}  matched symbols sorted by relevance, or null
 */
export declare function findSymbol(source: any, langName: any, symbolName: any, options?: {}): Promise<any>;
/**
 * Get symbols for a file by path. Reads the file, detects language, parses.
 * Convenience wrapper that handles the full file → symbols pipeline.
 *
 * @param {string} filePath - absolute path to the file
 * @param {Object} [options] - same options as getSymbols
 * @returns {Promise<Symbol[] | null>}
 */
export declare function getFileSymbols(filePath: any, options?: {}): Promise<any>;
/**
 * Get symbol summary string for a file by path.
 * Returns null if unsupported or no definitions found.
 */
export declare function getFileSymbolSummary(filePath: any): Promise<string | null>;
/**
 * Check if tree-sitter is available (runtime can init, grammars exist).
 */
export declare function treeSitterAvailable(): Promise<boolean>;
/**
 * Parse source code and check for syntax errors.
 * Returns an array of { line, column } for each ERROR node found.
 * Returns null if the language is not supported.
 * Returns empty array if no errors detected.
 *
 * @param {string} source   - the source code to check
 * @param {string} langName - tree-sitter language name
 * @returns {Promise<Array<{line: number, column: number}> | null>}
 */
export declare function checkSyntaxErrors(source: any, langName: any): Promise<any[] | null>;
/**
 * Compute a structural fingerprint for a range of source lines.
 * Returns an ordered array of AST node types for all nodes whose start row
 * falls within [startLine-1, endLine-1].
 *
 * @param {string} source    - full source code
 * @param {string} langName  - tree-sitter language name
 * @param {number} startLine - 1-based start line
 * @param {number} endLine   - 1-based end line
 * @returns {Promise<string[]>}
 */
export declare function getStructuralFingerprint(source: any, langName: any, startLine: any, endLine: any): Promise<any[]>;
/**
 * Compute Jaccard similarity between two structural fingerprints using 3-grams.
 * Returns a score from 0.0 to 1.0.
 *
 * @param {string[]} fingerprintA
 * @param {string[]} fingerprintB
 * @returns {number}
 */
export declare function computeStructuralSimilarity(fingerprintA: any, fingerprintB: any): number;
/**
 * Extract a structural signature for the symbol whose definition spans
 * `startLine`..`endLine` (1-based, inclusive). Used by refactor_batch outlier
 * detection to flag occurrences whose shape differs from peers in the same
 * symbol group.
 *
 * Returns null if the language cannot be loaded or no matching def node is found.
 */
export declare function getSymbolStructure(source: any, langName: any, startLine: any, endLine: any): Promise<{
    params: any[];
    returnKind: any;
    parentKind: any;
    decorators: any[];
    modifiers: unknown[];
} | null>;
