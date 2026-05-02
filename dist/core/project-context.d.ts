export declare class ProjectContext {
    constructor(ctx: any);
    /**
     * Get the project root. This is the main entry point.
     * Pass an optional filePath to scope resolution to that file's location.
     */
    getRoot(filePath: any): any;
    /**
     * Get the stash DB for the current project context.
     */
    getStashDb(filePath: any): {
        db: any;
        root: any;
        isGlobal: boolean;
    };
    /**
     * Is the current context using the global fallback?
     */
    get isGlobal(): any;
    /**
     * Force re-resolution. Called when MCP roots change.
     */
    refresh(): void;
    /**
     * Manually register a project root (stashInit).
     * Persists to global DB so it survives reconnects.
     */
    initProject(rootPath: any, name: any): string;
    /**
     * List all manually registered project roots.
     */
    listRegisteredProjects(): any;
    _resolve(): void;
    _resolveFromMcpRoots(): any;
    _resolveFromPath(p: any): string | null;
    _resolveFromRegistry(): any;
}
export declare function getProjectContext(ctx: any): any;
/**
 * Hook into server.js — call this when roots change to refresh context.
 */
export declare function onRootsChanged(ctx: any): void;
