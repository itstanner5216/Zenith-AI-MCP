export type ToolContent = {
    type: "text";
    text: string;
};
export type ToolResult = {
    content: ToolContent[];
};
export type ToolHandler<TArgs> = (args: TArgs) => Promise<ToolResult> | ToolResult;
export type ToolRegistration = {
    title?: string;
    description?: string;
    inputSchema?: unknown;
    annotations?: {
        readOnlyHint?: boolean;
        idempotentHint?: boolean;
        destructiveHint?: boolean;
    };
};
export type ToolServer = {
    registerTool<TArgs>(name: string, registration: ToolRegistration, handler: ToolHandler<TArgs>): void;
};
export type ToolContext = {
    sessionId?: string;
    validatePath(inputPath: string): Promise<string>;
    getAllowedDirectories?: () => string[];
    setAllowedDirectories?: (directories: string[]) => void;
};
export declare function errorMessage(error: unknown): string;
