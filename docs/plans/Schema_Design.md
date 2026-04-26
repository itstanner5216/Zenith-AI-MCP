## Executive Summary

This implementation plan outlines the integration of XML-based tool schema injection and calling within the Zenith-MCP project. To preserve Anthropic prompt caching, the architecture rigorously separates static instructions from dynamic context: the **System Prompt** receives a static, unchanging XML instructional block, while the **Conversation Context (User Turn)** receives dynamically injected tool schemas. To resolve the complexity of nested parameter serialization, this plan adopts a **CDATA JSON strategy** for complex objects, minimizing XML parser failure modes. The plan is executed across three waves: establishing the schema formatting and caching pipeline, building the interception and virtual registration layer, and wiring the dispatcher for reactive context injection.

---

## Finalized XML Formats & System Prompt

To satisfy strict cache preservation and parsing constraints, the following canonical formats and static prompts must be implemented.

### 1. Static System Prompt Instruction

This exact string must be injected via the zenith_init MCP prompt. It contains zero dynamic variables to ensure a 100% cache hit rate across sessions.  
You have access to a set of virtual filesystem and refactoring tools. To use these tools, you must emit an XML block matching the <tool_call> format below. You may use multiple tools in sequence.

To call a tool, emit:  
<tool_call>  
<name>tool_name</name>  
<arguments>  
<parameter_name>value</parameter_name>  
</arguments>  
</tool_call>

Important constraints:

- For parameters requiring complex objects or arrays, you MUST wrap the valid JSON representation inside a CDATA section: <![CDATA[ { "key": "value" } ]]>
- Do not invent tools. Only use tools whose schemas have been explicitly provided to you in the <new_tools_available> blocks within this conversation.

### 2. Injected Schema Format (formatToolToXML output)

Schemas are prepended to user turns when newly discovered.

code Xml

```
<new_tools_available>
  <tool_schema name="edit_file" category="filesystem">
    <description>Edit a text file using block, content, or symbol modes.</description>
    <parameters>
      <param name="path" type="string" required="true">File to edit.</param>
      <param name="edits" type="string" required="true">A JSON array of edit objects. MUST be wrapped in <![CDATA[ … ]]></param>
      <param name="dryRun" type="boolean" required="false">Preview without writing. Defaults to false.</param>
    </parameters>
  </tool_schema>
</new_tools_available>
```

### 3. Model-Emitted Tool Call (Example Utilizing CDATA)

The model emits this payload, which Zenith intercepts.

code Xml

```
<tool_call>
  <name>edit_file</name>
  <arguments>
    <path>/src/core/app.ts</path>
    <edits><![CDATA[
      [
        {
          "mode": "content",
          "oldContent": "const count = 0;",
          "newContent": "let count = 0;"
        }
      ]
    ]]></edits>
    <dryRun>false</dryRun>
  </arguments>
</tool_call>
```

### 4. Returned Tool Result

The dispatcher routes the output back to the model.

code Xml

```
<tool_result tool="edit_file" status="success">
  <content>Applied. No parse errors.</content>
</tool_result>
```

---

## File Map

- **dist/xml/formatter.ts** (New) — Serializes JSON Schema tool definitions into canonical XML <tool_schema> blocks.
- **dist/xml/parser.ts** (New) — Robustly extracts <tool_call> elements and their nested parameters from model-generated text, including CDATA-wrapped JSON.
- **dist/xml/dispatcher.ts** (New) — Routes parsed XML calls to internal handlers, formats <tool_result>, and manages the _seenSchemas cache per session.
- **dist/xml/virtual_server.ts** (New) — A mock MCP server class that intercepts registerTool calls to populate the XML registry without exposing tools natively to the MCP client.
- **dist/tools/execute_xml.ts** (New) — A native MCP tool (execute_xml) that models use to submit their XML tool call payloads. Acts as the intercept point.
- **dist/core/server.js** (Modified) — Splits tool registration between native McpServer and VirtualMcpServer, and registers the zenith_init and zenith_turn_context MCP Prompts.
- **dist/retrieval/pipeline.ts** (Modified) — Adds session-aware tracking of emitted schemas to ensure schemas are only injected once, preserving context window and cache.
- **dist/server/http.js & dist/cli/stdio.js** (Modified) — Adds hooks to trigger session teardown in the XML dispatcher to prevent memory leaks in _seenSchemas.

---

## Wave 1: XML Schema Formatting & Caching Architecture

### Goal

Establish the static/dynamic context separation required to preserve the Prompt Cache. Implement the schema formatter and expose the MCP Prompts that inject static system instructions and dynamic XML schemas into the user turn.

### Task 1.1: XML Schema Formatter

- **File:** dist/xml/formatter.ts
- **What it does:** Converts standard MCP Tool objects into an LLM-optimized XML format. Detects complex schemas (arrays/objects) and automatically injects CDATA usage instructions into the parameter description.
- **Function signatures:**
    
    code TypeScript

    ```
    import type { Tool } from "@modelcontextprotocol/sdk/types.js";
    export function formatToolToXML(tool: Tool): string;
    export function formatSchemaBatch(tools: Tool[]): string;
    ```

- **Edge cases handled:**
    - Escapes reserved XML characters (<, >, &) in tool descriptions.
    - Automatically identifies Zod/JSON schema properties of type array or object and coerces their XML <param type="…"> to string, appending CDATA instructions to the description.
- **Acceptance criteria:**
    - formatToolToXML produces a strict <tool_schema name="…"> block with <description> and <parameters> child nodes.
    - Nested object parameters explicitly instruct the model to provide stringified JSON inside a CDATA block.
    - formatSchemaBatch wraps multiple schemas in a <new_tools_available> root node.

### Task 1.2: Retrieval Pipeline Session Tracking & Math

- **File:** dist/retrieval/pipeline.ts
- **What it does:** Tracks which tool schemas have already been sent to a specific session ID to prevent redundant injection. Adjusts BMX+ index retrieval math to ensure the K-limit is filled with unseen tools.
- **Function signatures:**
    
    code TypeScript

    ```
    // Added to RetrievalPipeline class
    private _seenSchemas: Map<string, Set<string>> = new Map();
    public async getUnseenToolsForSession(sid: string, conversationContext: string, limit: number = 3): Promise<Tool[]>;
    public clearSessionSchemas(sid: string): void;
    ```

- **Edge cases handled:**
    - Session IDs lacking an entry in _seenSchemas default to an empty set.
    - **K-limit Math:** getUnseenToolsForSession requests limit + this._seenSchemas.get(sid).size tools from the underlying getToolsForList method, filters out the already-seen tools, and slices the top limit from the remainder. This guarantees the pipeline doesn't short-change the injection batch due to previously seen high-ranking tools.
- **Acceptance criteria:**
    - getUnseenToolsForSession filters out tools whose names already exist in the session's _seenSchemas set.
    - The returned tools are immediately added to the _seenSchemas set.
    - The requested subset adheres exactly to the calculated over-fetch and filter logic.
    - cleanupSession(sid) calls clearSessionSchemas.

### Task 1.3: Cache-Preserving MCP Prompts

- **File:** dist/core/server.js
- **What it does:** Registers MCP Prompts. zenith_init isolates static instructions in the system role and injects the first batch of XML schemas into the user role.
- **Function signatures:**
    
    code TypeScript

    ```
    import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
    export function registerPrompts(server: McpServer, ctx: any): void;
    ```

- **Edge cases handled:**
    - Hardcodes the system instruction block (defined in Finalized XML Formats above) explaining XML tool syntax so it never changes dynamically.
- **Acceptance criteria:**
    - server.prompt("zenith_init") returns two messages: role: "system" (static instructions) and role: "user" (initial XML schema block using formatSchemaBatch).
    - server.prompt("zenith_turn_context") returns a user message containing newly retrieved schemas via getUnseenToolsForSession.
    - System prompt text contains exactly zero variables or interpolated strings.

### Wave 1 Review

- formatToolToXML reliably produces valid XML for all current Zenith tools.
- Calling zenith_init multiple times for the same session ID yields schemas on the first call, and an empty user message on subsequent calls due to _seenSchemas tracking.
- The K-limit over-fetch logic successfully isolates the top N unseen tools.

---

## Wave 2: Interception, Parsing, and Virtual Registration

### Goal

Implement the core XML tool execution loop. Intercept XML calls via a native execute_xml tool while demoting all other tools to XML-only using a VirtualMcpServer wrapper.

### Task 2.1: Virtual MCP Server

- **File:** dist/xml/virtual_server.ts
- **What it does:** Mocks the registerTool method of @modelcontextprotocol/sdk/server/mcp.js. Intercepts tool registrations and routes them strictly to the ZenithToolRegistry, hiding them from the native MCP tools/list.
- **Function signatures:**
    
    code TypeScript

    ```
    import { ZenithToolRegistry } from "../retrieval/zenith-tool-registry.js";
    import type { Tool } from "@modelcontextprotocol/sdk/types.js";
    
    export class VirtualMcpServer {
      constructor(private registry: ZenithToolRegistry) {}
      registerTool(name: string, config: { description?: string, inputSchema: any, title?: string }, handler: (args: any) => Promise<any>): void;
    }
    ```

- **Edge cases handled:**
    - Preserves the exact signature of the real McpServer.registerTool so existing tool files (directory.ts, refactor_batch.ts) do not require code changes.
- **Acceptance criteria:**
    - Tools registered via VirtualMcpServer appear in ctx._toolRegistry.list().
    - Tools registered via VirtualMcpServer do NOT appear in the native MCP client's tool list.

### Task 2.2: XML Tool Call Parser

- **File:** dist/xml/parser.ts
- **What it does:** Extracts <tool_call> blocks and CDATA JSON from the model's text payload.
- **Function signatures:**
    
    code TypeScript

    ```
    export interface ParsedXmlCall { name: string; args: Record<string, any>; rawXml: string; }
    export function parseXmlToolCalls(xmlPayload: string, knownTools: string[]): ParsedXmlCall[];
    ```

- **Edge cases handled:**
    - Uses schema-aware tag matching (leveraging knownTools to find expected parameters) to prevent parsing failures on unescaped < or > inside parameter values.
    - Safely strips <![CDATA[ and ]]> tags and uses JSON.parse to extract arrays/objects inside arguments. Falls back to literal string if JSON.parse fails.
- **Acceptance criteria:**
    - Successfully parses multiple <tool_call> blocks from a single string.
    - Extracts parameters correctly even if the parameter value contains unescaped XML/HTML code.
    - Correctly inflates JSON strings wrapped in CDATA into JavaScript objects on the args payload.

### Task 2.3: Native Intercept Tool (execute_xml)

- **File:** dist/tools/execute_xml.ts
- **What it does:** Registers the single native tool that acts as the proxy/intercept point for the LLM's XML payloads.
- **Function signatures:**
    
    code TypeScript

    ```
    import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
    import { z } from "zod";
    export function register(server: McpServer, ctx: any): void;
    // Internal schema inside register: 
    // { xml_payload: z.string().describe("The XML string containing <tool_call> blocks.") }
    ```

- **Edge cases handled:**
    - Rejects payloads with zero valid tool calls, returning a specific error prompting the model to verify its XML syntax against the <tool_call> template.
- **Acceptance criteria:**
    - The tool execute_xml is registered natively.
    - It accepts a string, passes it to parseXmlToolCalls, and handles the array return without crashing.

### Wave 2 Review

- The native MCP tool list contains exactly 6 tools: read_text_file, write_file, directory, edit_file, search_files, and execute_xml.
- XML payloads containing CDATA JSON passed to execute_xml are successfully parsed into JS objects matching Zenith's internal handler expectations.

---

## Wave 3: Dispatch and Reactive Context Injection

### Goal

Execute the parsed XML calls, format the results, and dynamically append newly discovered XML schemas to the tool result, creating a self-sustaining reactive injection loop.

### Task 3.1: XML Dispatcher & Result Formatter

- **File:** dist/xml/dispatcher.ts
- **What it does:** Invokes the correct handler from ctx._toolRegistry, captures the response, and formats it as <tool_result>.
- **Function signatures:**
    
    code TypeScript

    ```
    import type { ParsedXmlCall } from "./parser.js";
    export async function dispatchXmlCalls(calls: ParsedXmlCall[], ctx: any): Promise<string>;
    ```

- **Edge cases handled:**
    - Catches handler exceptions and formats them as <tool_result status="error"> so the model can recover.
    - Resolves promises sequentially in a for…of loop to prevent race conditions in filesystem operations.
- **Acceptance criteria:**
    - Looks up the handler via ctx._toolRegistry.get(makeToolKey("zenith", call.name)).
    - Invokes the handler with parsed arguments.
    - Returns a concatenated string of <tool_result> blocks.

### Task 3.2: Reactive Schema Injection

- **File:** dist/tools/execute_xml.ts (Modifying work from Task 2.3)
- **What it does:** After dispatching the calls, queries the retrieval pipeline for high-scoring tools not yet seen, and appends their XML schemas to the execution result.
- **Function signatures:**
    
    code TypeScript

    ```
    import { dispatchXmlCalls } from "../xml/dispatcher.js";
    import { formatSchemaBatch } from "../xml/formatter.js";
    
    // Inside the execute_xml handler closure:
    server.registerTool("execute_xml", { /* schema */ }, async (args, extra) => {
      // 1. Parse and dispatch
      const calls = parseXmlToolCalls(args.xml_payload, availableToolNames);
      const resultsXml = await dispatchXmlCalls(calls, ctx);
      
      // 2. Reactive Injection
      const sid = ctx._sessionId;
      const deltaTools = await ctx._retrievalPipeline.getUnseenToolsForSession(sid, args.xml_payload, 3);
      
      // 3. Append schemas
      const schemaXml = deltaTools.length > 0 ? formatSchemaBatch(deltaTools) : "";
      return { content: [{ type: "text", text: resultsXml + "\n" + schemaXml }] };
    });
    ```

- **Edge cases handled:**
    - Uses the args.xml_payload as the conversationContext for getUnseenToolsForSession to contextually trigger relevant tools based on what the model just attempted to do.
- **Acceptance criteria:**
    - The handler calls ctx._retrievalPipeline.getUnseenToolsForSession.
    - The final string returned natively appends <new_tools_available> directly after the <tool_result> blocks.
    - The CallToolResult natively returned by MCP contains this combined string, seamlessly injecting it into the next user turn context.

### Task 3.3: Server Wiring & Session Teardown

- **Files:** dist/core/server.js, dist/server/http.js, dist/cli/stdio.js
- **What it does:** Instantiates VirtualMcpServer and routes registration. Connects session teardown to the schema cache.
- **Function signatures:**
    
    code TypeScript

    ```
    // In dist/core/server.js
    import { VirtualMcpServer } from "../xml/virtual_server.js";
    export function createFilesystemServer(ctx: any): any {
      const server = new McpServer({ name: "zenith-mcp", version: "0.3.0" });
      const virtualServer = new VirtualMcpServer(ctx._toolRegistry);
      // Modified registration routes:
      registerReadTextFile(server, ctx); // Native
      registerRefactorBatch(virtualServer as any, ctx); // Virtual
      // …
    }
    
    // In dist/server/http.js (Inside POST /mcp and DELETE /mcp handlers)
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        removeSession(sid);
        ctx._retrievalPipeline?.clearSessionSchemas(sid);
      }
    };
    ```

- **Edge cases handled:**
    - Safely casts virtualServer to any where necessary to satisfy TypeScript constraints on existing tool registration signatures that expect an McpServer.
- **Acceptance criteria:**
    - server.js splits registrations successfully between native and virtual instances.
    - When an HTTP session is DELETEd or idle-reaped, clearSessionSchemas is invoked, preventing memory leaks in the _seenSchemas Map.

### Wave 3 Review

- The full end-to-end flow works: Client requests zenith_init -> receives XML schemas -> calls execute_xml with <tool_call> -> Zenith parses, dispatches to refactor_batch (virtual tool) -> returns <tool_result> + new reactive schemas.
- HTTP Session teardowns successfully purge the memory state.

---

## Dependency Proof Table

|   |   |   |
|---|---|---|
|Task|Depends On|Why|
|**1.3 (Prompts)**|1.1, 1.2|Cannot return XML schemas in the prompt without the formatter and the session-tracking cache to avoid invalidations.|
|**2.1 (Virtual Server)**|None|Standalone adapter pattern to intercept @modelcontextprotocol/sdk registrations requires no prior state.|
|**2.3 (Native Intercept)**|2.2|The native tool needs the regex/AST parser to understand the xml_payload string from the LLM.|
|**3.1 (Dispatcher)**|2.1, 2.2|Dispatcher needs the virtual registry populated by 2.1 and the structured call objects extracted by 2.2.|
|**3.2 (Reactive Injection)**|1.1, 1.2, 3.1|Needs the formatter to serialize the new schemas, tracking to know what is unseen, and the dispatcher to obtain the base results to append to.|
|**3.3 (Wiring)**|All above|Final integration into server.js and transport layer requires all virtual servers, tools, and teardown hooks to exist.|

---

## Open Questions

- **Error Handling on Malformed XML in Task 3.1**
    - **Decision:** When the XML parser (Task 2.2) encounters a catastrophically malformed <tool_call> that it cannot salvage, what should be returned to the LLM?
    - **Option A:** Throw a hard native MCP error. (Fails the tool execution entirely, client handles it).
    - **Option B:** Return a soft XML <tool_result status="error"> containing a diagnostic payload explaining exactly which tag failed to close.
    - **Recommendation:** **Option B**. The LLM is the agent writing the XML; returning a soft diagnostic error allows the model to self-correct and re-issue the XML payload in the subsequent turn without crashing the client orchestrator.
- **Proactive Injection Mechanism Priority**
    - **Decision:** Should the system rely on the LLM client polling the zenith_turn_context prompt before every turn, or rely heavily on reactive injection (Task 3.2)?
    - **Option A:** Require the client to explicitly call prompts/get on zenith_turn_context before every message.
    - **Option B:** Use Reactive Injection. Every time the model uses any native tool, the tool result automatically includes delta schemas.
    - **Recommendation:** **Option B**, supported by Option A as a fallback. Reactive injection via CallToolResult requires zero modifications to standard MCP clients (like Claude Desktop) because standard client