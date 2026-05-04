/**
 * Zenith-specific wiring helpers for the retrieval pipeline.
 * No Python equivalent — provides hook-points for future wiring.
 *
 * HAZARD 1: None of these create or extend an McpServer.
 * HAZARD 2: Session IDs always passed in by caller.
 */
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { NullRetrievalLogger } from "./observability/logger.js";
import { PassthroughRetriever } from "./base.js";
import { SessionStateManager } from "./session.js";
import { RetrievalPipeline } from "./pipeline.js";
import { ROUTING_TOOL_NAME } from "./routing-tool.js";
import { makeToolKey } from "./zenith-tool-registry.js";
const EMPTY_OBJECT_JSON_SCHEMA = { type: "object", properties: {} };
function toJsonObjectSchema(schema, pipeStrategy) {
    if (!schema)
        return EMPTY_OBJECT_JSON_SCHEMA;
    const obj = normalizeObjectSchema(schema);
    return (obj
        ? toJsonSchemaCompat(obj, { strictUnions: true, pipeStrategy })
        : toJsonSchemaCompat(schema, {
            strictUnions: true,
            pipeStrategy,
        }));
}
function toListedTool(name, tool) {
    const listed = {
        name,
        title: tool.title,
        description: tool.description,
        inputSchema: toJsonObjectSchema(tool.inputSchema, "input"),
        annotations: tool.annotations,
        execution: tool.execution,
        _meta: tool._meta,
    };
    if (tool.outputSchema) {
        listed.outputSchema = toJsonObjectSchema(tool.outputSchema, "output");
    }
    return listed;
}
function sessionIdFromExtra(extra) {
    const maybe = extra;
    return typeof maybe?.sessionId === "string"
        ? maybe.sessionId
        : typeof maybe?.requestId === "string"
            ? maybe.requestId
            : "default";
}
// ── Tool registration hook ───────────────────────────────────────────────────
export function createRetrievalAwareToolRegistrar(server, registry, onRegistryChanged) {
    return {
        registerTool(...args) {
            const [name, , handler] = args;
            // Real MCP registration first
            const result = server.registerTool(...args);
            // Mirror into local registry for pipeline tracking
            let currentName = name;
            const sync = () => {
                const tool = toListedTool(currentName, result);
                registry.register(tool, result.handler ?? handler);
                onRegistryChanged?.();
            };
            sync();
            const registered = result;
            const originalUpdate = registered.update.bind(registered);
            const originalEnable = registered.enable.bind(registered);
            const originalDisable = registered.disable.bind(registered);
            const originalRemove = registered.remove.bind(registered);
            registered.update = (updates) => {
                const previousName = currentName;
                originalUpdate(updates);
                if (updates.name === null) {
                    registry.unregister(previousName);
                    onRegistryChanged?.();
                    return;
                }
                if (typeof updates.name === "string" && updates.name !== previousName) {
                    registry.unregister(previousName);
                    currentName = updates.name;
                }
                sync();
            };
            registered.enable = () => {
                originalEnable();
                sync();
            };
            registered.disable = () => {
                originalDisable();
                sync();
            };
            registered.remove = () => {
                originalRemove();
                registry.unregister(currentName);
                onRegistryChanged?.();
            };
            return result;
        },
    };
}
// ── Pipeline factory ─────────────────────────────────────────────────────────
export function createRetrievalPipelineForZenith(options) {
    const { registry, config, telemetryScanner } = options;
    const logger = options.logger ?? new NullRetrievalLogger();
    const retriever = new PassthroughRetriever();
    const sessionManager = new SessionStateManager(config);
    return new RetrievalPipeline({
        retriever,
        sessionManager,
        logger,
        config,
        toolRegistry: registry.asLiveRecord(),
        telemetryScanner,
    });
}
export function installRetrievalRequestHandlers(server, pipeline, registry) {
    const protocol = server.server;
    const defaultList = protocol._requestHandlers.get("tools/list");
    const defaultCall = protocol._requestHandlers.get("tools/call");
    if (!defaultList || !defaultCall) {
        throw new Error("MCP tool handlers are not initialized");
    }
    const errorResult = (message) => ({
        content: [{ type: "text", text: message }],
        isError: true,
    });
    server.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
        const full = (await defaultList(request, extra));
        const selected = await pipeline.getToolsForList(sessionIdFromExtra(extra));
        const fullByName = new Map(full.tools.map((tool) => [tool.name, tool]));
        const tools = [];
        for (const tool of selected) {
            if (tool.name === ROUTING_TOOL_NAME) {
                tools.push(tool);
                continue;
            }
            const sdkTool = fullByName.get(tool.name);
            if (sdkTool)
                tools.push(sdkTool);
        }
        return { ...full, tools };
    });
    server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        const sid = sessionIdFromExtra(extra);
        const toolName = request.params.name;
        if (toolName === ROUTING_TOOL_NAME) {
            const args = (request.params.arguments ?? {});
            const target = typeof args.name === "string" ? args.name : "";
            const mapping = registry.get(target);
            if (!mapping) {
                return errorResult(`Tool ${target} not found`);
            }
            if (args.describe === true) {
                const full = (await defaultList({ method: "tools/list" }, extra));
                const tool = full.tools.find((candidate) => candidate.name === mapping.tool.name) ?? mapping.tool;
                pipeline.recordRouterDescribe(sid, target);
                return { content: [{ type: "text", text: JSON.stringify(tool, null, 2) }] };
            }
            const routedArgs = (args.arguments ?? {});
            const proxiedRequest = {
                ...request,
                params: {
                    ...request.params,
                    name: mapping.tool.name,
                    arguments: routedArgs,
                },
            };
            const result = (await defaultCall(proxiedRequest, extra));
            if (!result.isError) {
                await pipeline.onToolCalled(sid, target, routedArgs, true);
            }
            return result;
        }
        const result = (await defaultCall(request, extra));
        if (!result.isError) {
            const args = (request.params.arguments ?? {});
            await pipeline.onToolCalled(sid, makeToolKey("zenith", toolName), args, false);
        }
        return result;
    });
}
// ── Roots bridge ─────────────────────────────────────────────────────────────
export async function setSessionRootsFromMcpRoots(pipeline, sessionId, roots) {
    const uris = roots.map((r) => r.uri);
    await pipeline.setSessionRoots(sessionId, uris);
}
//# sourceMappingURL=zenith-integration.js.map