/**
 * Zenith-specific wiring helpers for the retrieval pipeline.
 * No Python equivalent — provides hook-points for future wiring.
 *
 * HAZARD 1: None of these create or extend an McpServer.
 * HAZARD 2: Session IDs always passed in by caller.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Root } from "@modelcontextprotocol/sdk/types.js";
import type { RetrievalConfig } from "./models.js";
import type { RetrievalLogger } from "./observability/logger.js";
import type { TelemetryScanner } from "./telemetry/scanner.js";
import { ZenithToolRegistry } from "./zenith-tool-registry.js";
import { RetrievalPipeline } from "./pipeline.js";
export interface FilesystemContextLike {
    getAllowedDirectories(): string[];
    setAllowedDirectories(directories: string[]): void;
    validatePath(path: string): Promise<string>;
}
export declare function createRetrievalAwareToolRegistrar(server: McpServer, registry: ZenithToolRegistry, onRegistryChanged?: () => void): {
    registerTool: McpServer["registerTool"];
};
export declare function createRetrievalPipelineForZenith(options: {
    registry: ZenithToolRegistry;
    config: RetrievalConfig;
    logger?: RetrievalLogger;
    telemetryScanner?: TelemetryScanner;
}): RetrievalPipeline;
export declare function installRetrievalRequestHandlers(server: McpServer, pipeline: RetrievalPipeline, registry: ZenithToolRegistry): void;
export declare function setSessionRootsFromMcpRoots(pipeline: RetrievalPipeline, sessionId: string, roots: Root[]): Promise<void>;
