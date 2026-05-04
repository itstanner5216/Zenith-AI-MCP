import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function resolveInitialAllowedDirectories(args: any): Promise<any[]>;
export declare function validateDirectories(directories: any): Promise<void>;
export declare function createFilesystemServer(ctx: any): McpServer;
export declare function attachRootsHandlers(server: any, ctx: any): void;
