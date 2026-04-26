## Implementation Plan: XML-Based Tool Schema Injection and Tool Calling for Zenith-MCP

This document provides a **production-ready engineering plan** for adding XML-based tool schema injection and XML tool calling to the **Zenith‑MCP** codebase. The plan is based on a detailed review of the existing Zenith-MCP infrastructure and the publicly observable behavior of OpenClaw’s tool calling system. Each task specifies **exact files and functions** to modify or create, includes **edge‑case handling**, and provides **clear acceptance criteria**. Tasks are grouped into waves, with each wave building on the previous one. Open questions are separated at the end.

### File Map

|File|Status|Description|
|---|---|---|
|`src/core/xml/schema_formatter.ts`|**New**|Serializes Zenith tool definitions (name, description, JSON schema) into a canonical XML format for injection. Handles nested objects, arrays, enums and optional parameters.|
|`src/core/xml/tool_call_parser.ts`|**New**|Streaming parser that extracts `<tool_call>` and `<tool_result>` blocks from assistant messages. Handles malformed/truncated tags, quotes inside payloads, and nested tool calls.|
|`src/core/xml/dispatcher.ts`|**New**|Dispatches parsed tool calls to registered handlers via `server.registerTool`. Accepts parsed `name` and argument map, invokes the handler, formats results back into `<tool_result>` blocks.|
|`src/core/xml/state.ts`|**New**|Maintains per‑session state: the steady‑state tool set, recently injected schemas (sliding window of last 5 turns), and dynamic schema selection (proactive and reactive injections).|
|`src/core/xml/injection.ts`|**New**|Orchestrates XML schema injection. Builds the static system‑prompt instruction block, prepends steady‑state and per‑turn schema blocks to user messages, and ensures no schema appears in the system prompt.|
|`src/core/xml/transport_wrappers.ts`|**New**|Wraps `StreamableHTTPServerTransport` and `StdioServerTransport` to intercept outbound assistant messages, invoke the XML tool parser and dispatcher, and inject `<tool_result>` blocks before returning messages to the client.|
|`src/core/server-xml.js`|**New**|Entry point that wires the XML injection layer into Zenith‑MCP. Creates the server, registers tools, sets up XML state, attaches transport wrappers, and exports helper functions.|
|`src/core/server.js`|**Modify**|Add initialization of XML injection (import and call `initializeXmlTooling`) when creating an `McpServer`.|
|`src/cli/stdio.js`|**Modify**|Wrap the `StdioServerTransport` with the new XML response interceptor. Ensure per‑session XML state is created.|
|`src/server/http.js`|**Modify**|Wrap `StreamableHTTPServerTransport` with the XML response interceptor. Create XML state per session and pass it to the transport wrapper.|

### Wave 1: XML Schema Formatting and State Management

#### Goal

Provide foundational utilities for converting Zenith tool definitions into XML and tracking per‑session schema injection state. No message interception yet; focus on producing canonical XML and session state.

##### Task 1.1 — Implement `schema_formatter.ts`

- **File:** `src/core/xml/schema_formatter.ts`
- **What it does:** Exposes `formatToolSchemas(tools: RegisteredTool[]): string` that accepts an array of registered tool definitions (`name`, `description`, `inputSchema`) and returns an XML string containing `<tools>` with nested `<tool>` elements and `<param>` children. Uses `zod-to-json-schema` output to walk the schema and convert types into XML attributes (`type`, `required`). Escapes XML special characters. Handles nested objects (creates nested `<param>` with `<param>` children), arrays (`type="array"` and `itemType` attribute), enums (adds `enumValues="value1,value2"`), and optional properties (adds `required="false"`).
- **Function signature:**
    
    import type { RegisteredTool } from '../server.js';  
      
    /**  
     * Convert a list of registered tools into a canonical XML schema description.  
     * @param tools List of registered tools from McpServer  
     * @returns XML string containing <tools>…</tools> block.  
     */  
    export function formatToolSchemas(tools: RegisteredTool[]): string;
    
- **Edge cases handled:**
    - Tools with no parameters should produce an empty `<parameters/>` element.
    - Nested objects must recursively generate `<param>` children.
    - Arrays with nested objects must set `type="array"` and embed `<param name="item">…</param>` for the item schema.
    - Enum values must be joined with commas and XML‑escaped.
- **Acceptance criteria:**
    1. Passing a tool with a flat schema produces `<tool name="…"><parameters><param name="field" type="string" required="true">Description</param></parameters></tool>`.
    2. Nested objects produce nested `<param>` tags reflecting the JSON schema structure.
    3. Optional fields include `required="false"` and are omitted from `required="true"` fields list.
    4. The returned XML is valid when parsed with a standard XML parser (no unescaped `&`, `<`, `>`). Unit tests for multiple tools should pass.

##### Task 1.2 — Implement `state.ts`

- **File:** `src/core/xml/state.ts`
- **What it does:** Provides a `XmlToolState` class encapsulating per‑session state:
    - `steadyTools`: a set of tool names always injected at session start (configurable via constructor).
    - `recentSchemas`: queue (size 5) of tool names injected in recent turns.
    - `seenTools`: Set of tool names that have been injected during this session.
    - `registerSteadyTools(tools: string[])`: populates `steadyTools` and `recentSchemas`.
    - `selectSchemasForTurn(candidateTools: string[], maxCount: number): string[]`: chooses up to `maxCount` tool names not in `recentSchemas`, updates `recentSchemas` with chosen names, and returns them. Ensures steady tools are returned first on the first turn.
    - `markUsed(toolName: string)`: records that a tool call occurred, so reactive injection can propose related tools.
- **Function signature:**
    
    export class XmlToolState {  
      constructor(steadyTools: string[]);  
      registerSteadyTools(tools: string[]): void;  
      selectSchemasForTurn(candidateTools: string[], maxCount: number): string[];  
      markUsed(toolName: string): void;  
    }
    
- **Edge cases handled:**
    - When candidate tools list is empty, returns an empty array.
    - Does not select the same tool twice in the same turn.
    - Maintains a sliding window of size 5 for `recentSchemas` to avoid re-injecting the same schema too frequently.
- **Acceptance criteria:**
    1. Creating a new state with `steadyTools=['search_files','read_text_file']` results in `recentSchemas` containing those names after first call to `selectSchemasForTurn([], 3)`.
    2. Selecting schemas removes them from future `recentSchemas` until they fall out of the sliding window.
    3. `markUsed()` correctly records calls and does not affect `steadyTools` selection.

##### Wave 1 Review

- All new modules compile with no TypeScript errors.
- Unit tests verify correct XML output and state behavior for simple and nested schemas.
- There is no impact on existing server behavior; no runtime code is yet wired into transport or server.

---

### Wave 2: XML Tool Call Parser and Dispatcher

#### Goal

Build a robust XML parser that can extract tool call invocations and results from assistant messages, and dispatch those invocations to registered tool handlers.

##### Task 2.1 — Implement `tool_call_parser.ts`

- **File:** `src/core/xml/tool_call_parser.ts`
- **What it does:** Exports a stateful parser class `XmlToolCallParser` capable of scanning assistant output (string or streaming chunks) and returning an array of parsed tool calls or tool results. Each parsed call contains `{type: 'call'|'result', name: string, id?: string, args?: Record<string, unknown>, content: string}`. The parser identifies `<tool_call>`, `<function>`, `<tool_result>`, `<function_calls>` tags (matching the patterns observed in OpenClaw) and handles nested tags, self‑closing tags, attributes, and truncated XML at stream boundaries.
- **Function signature:**
    
    export interface ParsedToolCall {  
      type: 'call' | 'result';  
      name: string;  
      id: string | null;  
      args: any;  
      content: string;  
    }  
    export class XmlToolCallParser {  
      constructor();  
      /**  
       * Feed text into the parser. Returns parsed calls when complete tags are encountered.  
       */  
      feed(data: string): ParsedToolCall[];  
      /**  
       * Reset internal state (call between turns).  
       */  
      reset(): void;  
    }
    
- **Edge cases handled:**
    - Handles multi‑turn streaming: if a `<tool_call>` tag starts in one chunk and ends in another, the parser holds state and completes when closing tag arrives.
    - Handles detection of JSON vs. XML payload: uses regex similar to OpenClaw’s `TOOL_CALL_JSON_PAYLOAD_START_RE` and `TOOL_CALL_XML_PAYLOAD_START_RE` to decide if `<arguments>` payload is JSON or nested XML, and parses accordingly using `JSON.parse` or recursive tag parsing.
    - Gracefully ignores malformed tags: if an opening tag is truncated and no closing tag is found by end of chunk, it holds state; if the tag is invalid (unknown name), the text is passed through without parsing.
    - Recognizes `function` and `function_calls` tags as synonyms for `tool_call`, and `invoke` or `arguments` for argument payload. Recognizes `tool_result` and `function_result` as result blocks.
- **Acceptance criteria:**
    1. Feeding a complete `<tool_call>` block returns one `ParsedToolCall` with correct `name` and parsed `args`.
    2. Feeding the same message in two chunks still returns the same parsed call when the closing tag arrives.
    3. Mixed content (prose + tool call) returns the parsed call and preserves assistant-visible prose. No assistant-visible text is lost.
    4. JSON payload inside `<arguments>` is parsed into an object; XML payload yields a nested object with keys equal to tag names.

##### Task 2.2 — Implement `dispatcher.ts`

- **File:** `src/core/xml/dispatcher.ts`
- **What it does:** Provides a function `dispatchToolCall(call: ParsedToolCall, server: McpServer, ctx: FilesystemContext): Promise<string>` that locates the registered tool by `call.name`, validates and converts arguments to the expected schema (using `zod`), invokes the handler function, and formats the result into a `<tool_result>` XML block. The result block includes attributes `tool="{call.name}"` and `status="success"` or `status="error"` with an `<content>` child containing either the tool’s text output or error message. Errors thrown by the handler are caught and encoded as `<tool_result>` with `status="error"`.
- **Function signature:**
    
    import type { ParsedToolCall } from './tool_call_parser.js';  
    import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';  
    import type { FilesystemContext } from '../lib.js';  
      
    export async function dispatchToolCall(  
      call: ParsedToolCall,  
      server: McpServer,  
      ctx: FilesystemContext,  
    ): Promise<string>;
    
- **Edge cases handled:**
    - Unknown tool names result in an error `<tool_result>` block with `status="error"` and a descriptive message.
    - Invalid argument structures (failed `zod` parsing) return an error result detailing which arguments are invalid.
    - Tool handlers that throw or reject will be caught and returned with error status and stack truncated to first line.
    - Large outputs must be truncated to `CHAR_BUDGET` (via existing `shared.js` constants) and encoded as base64 if binary (e.g., `read_media_file`).
- **Acceptance criteria:**
    1. Dispatching a valid call invokes the correct registered tool handler and returns `<tool_result tool="name" status="success"><content>…</content></tool_result>`.
    2. Dispatching an unknown tool returns `<tool_result status="error">` with an explanatory message.
    3. Dispatching a call with invalid arguments returns an error result listing missing or invalid fields.

##### Wave 2 Review

- Parser handles streaming and malformed XML; test with multiple scenarios.
- Dispatcher correctly routes calls to handlers, catching errors.
- No modifications to transport code yet; parser and dispatcher compile without runtime side effects.

---

### Wave 3: Transport Wrappers and Response Interception

#### Goal

Wire the XML parser and dispatcher into Zenith‑MCP’s transports so that tool calls embedded in assistant messages are detected, executed, and responded to automatically.

##### Task 3.1 — Implement `transport_wrappers.ts`

- **File:** `src/core/xml/transport_wrappers.ts`
- **What it does:** Provides two wrapper classes `XmlStreamableHTTPTransport` and `XmlStdioTransport` that decorate the corresponding SDK transports. Each wrapper accepts the underlying transport instance, the `XmlToolState`, the `McpServer`, and the per‑session `FilesystemContext`. On each assistant message being streamed back to the client, the wrapper intercepts the outgoing content:
    - Buffers chunks until a full message is complete or the stream flushes.
    - Passes text through `XmlToolCallParser.feed()`. For each parsed tool call, it calls `dispatchToolCall()`, obtains the result XML, and prepends it to the next user turn via `XmlToolState` injection (for reactive injection) or returns it immediately depending on provider semantics.
    - Strips the original `<tool_call>` and `<tool_result>` content from assistant-visible text using the parser’s boundaries to avoid leaking tool payloads to the user.
    - Updates `XmlToolState.markUsed(name)` when a tool is invoked.
- **Class definitions:**
    
    import { XmlToolCallParser } from './tool_call_parser.js';  
    import { dispatchToolCall } from './dispatcher.js';  
    import { XmlToolState } from './state.js';  
    import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';  
    import type { FilesystemContext } from '../lib.js';  
    import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';  
    import type { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';  
      
    export class XmlStreamableHTTPTransport {  
      constructor(  
        private underlying: StreamableHTTPServerTransport,  
        private server: McpServer,  
        private ctx: FilesystemContext,  
        private state: XmlToolState,  
      );  
      handleRequest(req: any, res: any, body?: any): Promise<void>;  
      close(): Promise<void>;  
    }  
      
    export class XmlStdioTransport {  
      constructor(  
        private underlying: StdioServerTransport,  
        private server: McpServer,  
        private ctx: FilesystemContext,  
        private state: XmlToolState,  
      );  
      connect(): Promise<void>;  
      close(): Promise<void>;  
    }
    
- **Implementation details:**
    - The wrapper proxies all calls to the underlying transport except for `send`/`write` operations. It overrides the method that streams assistant responses to intercept the text. Because the SDK’s transport classes are not modifiable, we wrap their `sendToClient()` or similar method. If the SDK uses an event emitter, we register a listener on the underlying transport’s `onmessage` or `onchunk` event, parse the outgoing message, dispatch tools, inject results, then forward cleaned text to the client. The plan assumes the underlying transport exposes hooks like `transport.on('assistantMessage', callback)`; if not, we can override `transport.write` after capturing the instance.
- **Edge cases handled:**
    - Streaming responses that include multiple tool calls are handled sequentially; tool results are executed in order and the combined `<tool_result>` blocks are inserted into a single assistant turn or into subsequent user prompts depending on provider semantics.
    - Partial tool calls across chunk boundaries are buffered until complete.
    - If a tool call fails, the error `<tool_result>` is still injected and the assistant-visible text excludes the failed call payload.
    - Ensures thread safety by avoiding shared state across sessions; each wrapper owns its own `XmlToolState` instance.
- **Acceptance criteria:**
    1. When the assistant output includes `<tool_call>` XML, the wrapper intercepts it, dispatches to the correct tool, and returns the `<tool_result>` before the user sees the assistant’s text. The assistant-visible text is stripped of the XML payload.
    2. Normal assistant messages without tool calls are forwarded unchanged.
    3. The wrapper does not interfere with HTTP/SSE/stdio session management (session IDs, auth, session reaping continue to work).
    4. Unit tests simulate a simple tool call in a streaming response and verify that the tool is invoked and the result is injected.

##### Task 3.2 — Modify `server.js` to Initialize XML Tooling

- **File:** `src/core/server.js`
- **Changes:**
    - Import `initializeXmlTooling` from `./xml/injection.js` and call it in `createFilesystemServer()` after registering tools. This function will set up the steady‑state tool list (5 most common tools) and return a configured `XmlToolState`.
    - Adjust the exported type `RegisteredTool` so the XML formatter can consume tool definitions. Add a new export `getRegisteredTools(): RegisteredTool[]` on the `McpServer` instance that returns an array of tool metadata (name, description, inputSchema) for use by the XML formatter.
- **Edge cases handled:**
    - Do not alter existing tool registration or root handling logic. Only add injection initialization. If `initializeXmlTooling` fails, log error but continue with regular tool operation.
- **Acceptance criteria:**
    1. After server creation, `initializeXmlTooling` is called and returns without error.
    2. Tool registration semantics remain unchanged for the existing JSON `tools` array.

##### Task 3.3 — Modify `stdio.js` and `http.js` to Use Transport Wrappers

- **Files:** `src/cli/stdio.js`, `src/server/http.js`
- **Changes:**
    - Import `XmlStdioTransport` and `XmlStreamableHTTPTransport` from `src/core/xml/transport_wrappers.ts`.
    - When creating a session (in both CLI and HTTP modes), after constructing `server` and `ctx` and calling `createSessionPair()`, also create a `XmlToolState` with the steady tool list. Pass this state along with the underlying transport to the wrapper:
        
        const xmlState = new XmlToolState(['search_files','read_text_file','write_file','edit_file','directory']);  
        const wrappedTransport = new XmlStreamableHTTPTransport(transport, server, ctx, xmlState);  
        await server.connect(wrappedTransport);
        
    - Similarly in `stdio.js`, wrap `StdioServerTransport` with `XmlStdioTransport`.
    - Ensure that session reaping and `onclose` handlers call `wrappedTransport.close()` rather than the underlying transport directly.
- **Acceptance criteria:**
    1. In CLI and HTTP modes, the server uses the XML transport wrappers instead of the raw SDK transports.
    2. Sessions still honour session IDs and TTL reaping.
    3. Basic tool operations (e.g., `read_text_file`) still function via JSON tool calls.
    4. When a model emits an XML `<tool_call>`, the wrapper intercepts it and returns a `<tool_result>`.

##### Wave 3 Review

- Wrapped transports intercept messages correctly; test by running a session and invoking a `search_files` tool via XML to see if results are injected.
- There is no regression in CLI or HTTP session handling.
- Error handling path (unknown tools, invalid args) returns proper error XML blocks.

---

### Wave 4: Injection Layer & Prompt Assembly

#### Goal

Inject XML schemas into the conversation body at appropriate times (session start, pre‑turn proactive, and reactive after tool use) without invalidating the system prompt cache.

##### Task 4.1 — Implement `injection.ts`

- **File:** `src/core/xml/injection.ts`
- **What it does:** Exports functions to assemble XML instruction blocks and manage injection timing:
    - `buildStaticInstructionBlock(): string` — returns a fixed XML comment instructing the model on how to use the `<tools>`, `<tool_call>`, `<tool_result>` tags and emphasising that tools must be invoked via XML. This block is identical across sessions and must be included **once** at the top of the first user turn to define the grammar.
    - `buildSchemaBlock(state: XmlToolState, tools: RegisteredTool[]): string` — uses `formatToolSchemas` to generate an XML `<tools>` block for the chosen tools this turn (steady + selected via `state.selectSchemasForTurn()`). Adds this block before the user’s message content.
    - `prependInjection(message: ChatMessage, injection: string): ChatMessage` — returns a new message object (copy) with the injection prepended to `message.content`. Does **not** modify the system prompt.
    - `initializeXmlTooling(server: McpServer, state: XmlToolState): void` — registers a hook on the server so that whenever a new conversation starts, the static instruction block and steady schema block are injected at the first user turn. Uses `server.onPreMessage` (assumed to exist) or a similar hook to inject before sending to model.
- **Edge cases handled:**
    - Injection only occurs on turns sent to the model; tool results returned to the user are not re‑injected.
    - Static instruction block is inserted only once per session, regardless of how many turns the conversation has.
    - Schema blocks respect `recentSchemas` sliding window; no duplication within 5 turns.
    - Does not modify the system prompt; injection occurs in the user message `content` field.
- **Acceptance criteria:**
    1. At session start, the user’s first message content is prefaced by the static instruction block and the steady‑state tool schemas. The system prompt remains unmodified.
    2. On subsequent turns, the injection layer selects up to 3 relevant tool schemas (none if none apply) and prepends them to the user message.
    3. After a tool call, `markUsed()` is called on the tool state, and reactive injection selects high‑scoring tools (RAG integration to be addressed in future waves). For this wave, reactive injection can be stubbed to always re‑inject steady tools.
    4. Injection does not cause the API provider to report a system prompt cache miss.

##### Task 4.2 — Hook Injection into Conversation Flow

- **Files:** `src/core/server-xml.js`
- **What it does:** Implements `initializeXmlTooling` (called from `server.js`) to create `XmlToolState`, generate the static instruction block, and register hooks on `McpServer` to inject XML into user messages. Because the SDK’s API is opaque, we assume `McpServer` exposes a `useMiddleware()` or `onPreModelCall()` hook. If not, we wrap the `send` method on the `server` instance to intercept the messages before they are forwarded to the underlying model provider. The code must:
    1. On the first user turn, prepend the static instruction block and steady schema block.
    2. On subsequent turns, call `state.selectSchemasForTurn()` with candidate tools (exposed via a retrieval pipeline stub) and prepend the selected schema block.
    3. Ensure that the injection is added to the **user message content** (not system prompt) and that the assistant messages are unmodified.
- **Edge cases handled:**
    - If `state.selectSchemasForTurn()` returns an empty array, no schema block is injected that turn.
    - If the user message already contains XML (unlikely), injection is inserted before any user content to avoid confusion.
- **Acceptance criteria:**
    1. First turn includes static instruction and steady tool schemas.
    2. Later turns include dynamic schema blocks or none when not needed.
    3. The injection does not break JSON message structure used by the SDK.

##### Wave 4 Review

- Starting a session and sending a message shows the injected XML at the top of the message body.
- Subsequent turns respect sliding window and dynamic selection.
- System prompt remains unchanged and is still cached.

---

### Wave 5: Proactive and Reactive Retrieval Pipeline Integration (Optional)

#### Goal

Integrate with Zenith‑MCP’s retrieval pipeline and BM25 index to dynamically select the most relevant tools per user query and after tool execution.

##### Task 5.1 — Integrate BM25 Ranking for Tool Selection

- **Files:** `src/core/xml/injection.ts`, `src/core/xml/state.ts`
- **What it does:** Implements `rankToolsForQuery(query: string, allTools: RegisteredTool[]): string[]` using BM25 over the tool descriptions and names. Before each turn, call this function with the user’s message to produce candidate tools sorted by relevance. Pass the top‐K (e.g., 3) into `state.selectSchemasForTurn()` for injection.
- **Acceptance criteria:**
    1. When the user asks about searching files, the injection layer selects `search_files` and perhaps `read_text_file` for injection.
    2. Ranking uses existing `bm25RankResults` from `shared.js` by building a corpus of tool descriptions. All functions compile and run without errors.

##### Task 5.2 — Reactive Injection after Tool Use

- **Files:** `src/core/xml/transport_wrappers.ts`
- **What it does:** After dispatching a tool call and obtaining the result, run BM25 on the tool result content against all tool descriptions to select additional relevant tools. Use `state.selectSchemasForTurn()` to decide whether to inject them at the next user turn.
- **Acceptance criteria:**
    1. After the user invokes `search_files`, the injection layer may proactively inject `read_text_file` on the next turn if the search results show file paths.
    2. Implementation uses `state.markUsed()` to record usage and influences ranking.

##### Wave 5 Review

- Retrieval pipeline selects relevant tools proactively and reactively.
- No regression when ranking disabled (e.g., by environment flag).

---

### Dependency Proof Table

|Task|Depends On|Why|
|---|---|---|
|1.2 (`state.ts`)|1.1|State requires tool names from formatted schemas.|
|2.1 (`tool_call_parser.ts`)|none|Independent.|
|2.2 (`dispatcher.ts`)|2.1, 1.2|Uses parser output and state to dispatch and update state.|
|3.1 (`transport_wrappers.ts`)|2.1, 2.2, 1.2|Requires parser, dispatcher, and state to intercept messages and dispatch calls.|
|3.2 (`server.js` modifications)|1.2, 4.2|Needs state and injection initialization before server starts.|
|3.3 (`stdio.js`, `http.js` modifications)|3.1|Must wrap transports with XML interceptors.|
|4.1 (`injection.ts`)|1.1, 1.2|Uses schema formatting and state to build injection blocks.|
|4.2 (`server-xml.js`)|4.1, 3.1|Wires injection layer and transport wrappers into server lifecycle.|
|5.1 & 5.2 (retrieval integration)|4.1, 1.2|Use state and injection functions to rank tools.|

---

### Open Questions

1. **Exact hook availability in `@modelcontextprotocol/sdk`**: The plan assumes that `McpServer` or transport classes expose hooks to intercept messages (e.g., `server.onPreMessage`, `transport.on('assistantMessage')`). If such hooks do not exist, we may need to override methods in the SDK or contribute patches upstream. **Recommendation:** Inspect the `@modelcontextprotocol/sdk` source (if accessible) or test at runtime. If no hooks exist, wrap the returned `transport` object’s `write` or `send` methods as shown in Wave 3.
2. **XML vs JSON fallback for providers**: Some LLM providers may not support XML tool calls. Should we maintain JSON tool calls simultaneously? **Recommendation:** Use the existing JSON `tools` array for base functionality and rely on XML injection as an additional channel. The dispatcher should detect whether a provider returns JSON or XML calls and handle both.
3. **RAG pipeline integration details**: The retrieval pipeline for dynamic tool selection (Wave 5) requires scoring tool relevance based on user queries and tool results. The plan proposes using BM25 from `shared.js`, but the exact features (e.g., combining code search with tool descriptions) need design. **Recommendation:** Start with simple BM25 ranking over tool descriptions and refine later based on user feedback.
4. **Tool result streaming semantics**: The plan injects `<tool_result>` blocks immediately after dispatching a call. If the provider expects results to be delivered in a separate message or with a special tag, adjustments may be needed. **Recommendation:** Verify provider behaviour (OpenAI vs Anthropic) and adjust injection timing accordingly (e.g., push result in next assistant turn vs same turn).
5. **Security considerations**: XML parsing introduces risk of entity expansion (XXE) or injection attacks. The parser must reject external entity declarations and limit tag depth. **Recommendation:** Use a safe XML parser (or our custom stateful parser) and disallow DTDs entirely.
6. **Backwards compatibility**: JSON tool calling should remain fully functional. The plan must ensure existing `tools` array and JSON tool invocation flows continue to work for clients that do not support XML. **Recommendation:** Keep `tools` array unchanged and allow clients to opt‑in to XML injection via config flag.

This plan lays out a detailed, file‑level implementation path for adding XML tool schema injection and tool calling to Zenith‑MCP, with clearly defined tasks, dependencies, and acceptance criteria.
