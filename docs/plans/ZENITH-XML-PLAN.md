# Zenith-MCP XML Schema Injection & XML Tool Calling — Implementation Plan

Target branch: `main` of `itstanner5216/Zenith-MCP` (hybrid `src/` \+ `dist/` model, `"type": "module"`, TypeScript → `dist/`).

This plan adds three integrated sub-systems (Formatter A, Parser B, Dispatcher C) and the glue that wires them into `createFilesystemServer`, `resolveInitialAllowedDirectories`, and the two transports. All new runtime code lands under `dist/core/xml/` and `dist/tools/xml_gateway.js`. All authored TypeScript lands under `src/core/xml/` and `src/tools/xml_gateway.ts` mirroring the dist tree (same `rootDir: "src"` / `outDir: "dist"` that `tsconfig.json` already enforces). The repo's `prebuild` guard (`package.json` line 25\) — which aborts if `dist/core/server.js` is missing — is preserved; we only *add* files to `dist/` via `tsc`, never hand-edit existing ones where a `.ts` sibling exists.

Everything below is grounded in what was observed in the actual code: `McpServer.registerTool` (MCP SDK `dist/esm/server/mcp.js` lines 67–99), `createFilesystemContext` (`dist/core/lib.js` lines 29–78), the `BM25Index` class (`dist/core/shared.js` lines 67–207), the stdio entry (`dist/cli/stdio.js` lines 29–37), the HTTP `createSessionPair` (`dist/server/http.js` lines 99–104), and the existing tool shape used by `edit_file.js` / `search_files.js` / `directory.js`.

---

## Global Design Decisions (anchored)

1. **Tool-deferral strategy is provider-split, not Anthropic-only.** The API `tools` array stays *minimal and static* for every provider. For Anthropic-family models (detected via the same predicates OpenClaw uses in `src/agents/pi-embedded-runner/anthropic-family-cache-semantics.ts`: provider ∈ `anthropic`, `anthropic-vertex`, `amazon-bedrock`\+Claude ARN, `modelApi === "anthropic-messages"`) Zenith relies on Anthropic's cache-breakpoint semantics (prompt-body XML, tools array empty / 5 steady-state). For every other provider (OpenAI, Deepseek, OpenRouter-non-anthropic, Kimi, Minimax, local Ollama/LMStudio, etc.) Zenith uses the **exact same prompt-body XML injection** — the 5 steady-state tools are registered normally so native JSON tool calls still work, but extended/deferred tools are emitted as XML in the user turn and parsed out of the model's textual response. The mechanism is provider-agnostic because text-in/text-out is the lowest common denominator. This decision is justified below in every schema and parser task.  
     
2. **Five steady-state tools**: `read_text_file`, `write_file`, `directory`, `edit_file`, `search_files`. These keep their *existing* native MCP registration untouched (so `tools/list` still reports them and native JSON tool calls still dispatch through `setRequestHandler(CallToolRequestSchema, …)` in SDK `mcp.js` line 100). They are the only tools emitted in the API `tools` array. All other Zenith tools (`file_manager`, `stashRestore`, `refactor_batch`, `read_multiple_files`, `read_media_file`) become **deferred**: registered normally at MCP level, but surfaced to the model exclusively via XML injection at session-start or reactively after tool use.  
     
3. **System prompt is frozen.** The static XML-syntax instruction block is *content the host sends as system*; Zenith itself never mutates a system prompt (Zenith is an MCP server — it does not own the provider call). Zenith's contract with callers is: (a) publish the static instruction block via a new MCP **prompt** (`registerPrompt`, SDK `mcp.js` line 726\) named `zenith/xml-tool-use-instructions`, and (b) expose a new native **tool** `zenith_xml_context` that returns the XML schema block to be prepended to a user turn. Hosts pull (a) once per session and pin it to their system prompt (invariant content → cache-hit forever); hosts call (b) before each user turn where dynamic schemas need to change and splice the returned XML to the top of the user turn. This is the only safe way for an MCP server to drive prompt-body injection without ever touching the system prompt itself.  
     
4. **XML formats are finalized** (see Wave 1, Task 1.1 for exact grammar).  
     
5. **Parser uses a hybrid SAX state-machine**, not a full XML parser. Reason: Anthropic itself emits unescaped `&`, `<`, `>` inside `<arguments>` children for path/content values; a strict parser would crash. The state machine scans tag-by-tag, captures raw child content verbatim between matched open/close, and only interprets attribute values strictly. This mirrors OpenClaw's `assistant-visible-text.ts` tag scanner (same file's `parseToolCallTagAt`, `findTagCloseIndex`, `endsInsideQuotedString`) but promotes the "scan-and-extract" pass from a *hide* function into a *capture* function. We consciously reject `xml2js` / `fast-xml-parser` because both will throw on the unescaped angle brackets that appear naturally in file contents.  
     
6. **Cache preservation**: the static instruction block is content-addressable (SHA-256 of its frozen text) and never changes at runtime. The per-turn dynamic XML block lives in the user-turn body. The API `tools` array is recomputed once at `createFilesystemServer` time and never mutated. The BMX\_plus retrieval ordering does not affect the *set* of injected schemas on a quiet turn — it only affects order. Injection is idempotent: a schema already present in the last 5 turns' XML digest is skipped.  
     
7. **Session scoping**: a new `XmlSessionState` object is attached to each `FilesystemContext` via a new field `ctx.xmlState`. In stdio there's one `ctx` for the process (see `dist/cli/stdio.js` line 29). In HTTP each session gets its own `ctx` inside `createSessionPair` (see `dist/server/http.js` line 100). No shared global state. Session teardown in HTTP already nulls the session entry (`http.js` line 73 `removeSession`); we don't need new teardown hooks.

---

## File Map

### Created — Sub-system A (Formatter)

- `src/core/xml/xml-escape.ts` — escape / CDATA helpers (tiny, dep-free).  
- `src/core/xml/schema-format.ts` — converts a Zod/JSON-Schema tool definition to canonical Zenith XML.  
- `src/core/xml/schema-format.test.ts` — unit tests (vitest).

### Created — Sub-system B (Parser)

- `src/core/xml/tool-call-parser.ts` — SAX state-machine extractor for `<tool_call>` blocks.  
- `src/core/xml/tool-call-parser.test.ts` — unit tests covering all edge cases.

### Created — Sub-system C (Dispatcher \+ Result Formatter)

- `src/core/xml/dispatcher.ts` — routes a parsed `ParsedToolCall` to `mcpServer._registeredTools[name].handler` with validated input, serializes result to `<tool_result>` XML.  
- `src/core/xml/dispatcher.test.ts` — unit tests.

### Created — Session state & injection policy

- `src/core/xml/session-state.ts` — `XmlSessionState` class: turn-seen digest LRU, steady-state set, deferred set, BMX\_plus index lifecycle.  
- `src/core/xml/steady-state.ts` — defines the 5 steady-state tool names as a `readonly` Set, exported for use by server.ts and xml\_gateway.  
- `src/core/xml/retrieval.ts` — proactive top-K schema selection and reactive post-tool-use scorer (wraps `BM25Index` from `dist/core/shared.js`).  
- `src/core/xml/instruction-block.ts` — exports the frozen static instruction-block string \+ its content hash.

### Created — Gateway tool (host-facing MCP surface)

- `src/tools/xml_gateway.ts` — registers three MCP endpoints:  
  - native tool `zenith_xml_context` (pull per-turn XML block)  
  - native tool `zenith_xml_dispatch` (host pastes assistant text, Zenith parses \+ dispatches, returns `<tool_result>` XML)  
  - MCP prompt `zenith/xml-tool-use-instructions` (pull static system instruction block)

### Modified

- `src/core/server.ts` — **does not exist yet in `src/`**; the authoritative file is `dist/core/server.js`. Per the repo's hybrid model (ARCHITECTURE.md §1, CLAUDE.md, and the `prebuild` guard in `package.json`) the only safe path is to add the TypeScript sibling and have `tsc` emit `dist/core/server.js` on next build **without disturbing the existing hand-authored JS**. Because the prebuild guard specifically requires `dist/core/server.js` to exist, we do **not** delete the JS; we port its contents verbatim into `src/core/server.ts` and add the new imports \+ registration calls. This is the only modification pattern the prebuild guard permits.  
  - Adds import of `registerXmlGateway` from `../tools/xml_gateway.js`.  
  - `registerAllTools` calls `registerXmlGateway(server, ctx)` last (after all native tools are registered, so the steady-state detection and deferred-set computation see the full registry).  
  - `createFilesystemServer` attaches `ctx.xmlState = createXmlSessionState(server, ctx)` immediately after `registerAllTools` returns.  
- `src/core/lib.ts` — same situation as server.ts. We port `dist/core/lib.js` to `src/core/lib.ts` and add `xmlState?: XmlSessionState` to the context interface (optional so existing tools remain type-safe without change).  
- `src/cli/stdio.ts` — port from `dist/cli/stdio.js`, no behavioural change beyond the typed import surface.  
- `src/server/http.ts` — port from `dist/server/http.js`, same zero-behaviour-change principle. `createSessionPair` already produces a fresh ctx \+ server per session, which is exactly what `XmlSessionState` needs.  
- `package.json` — add `"xmldom-lite": "file:src/core/xml/vendored-xmldom-lite"` is explicitly **not** added. No new runtime deps. Only dev-dep addition is `fast-check@^3` for parser property tests.

### Unmodified (by design)

- Every existing file under `dist/tools/*.js` — the 10 existing tool files are untouched; they keep their `server.registerTool(name, config, handler)` shape and their input schemas. The XML layer consumes `server._registeredTools` after the fact.  
- `dist/core/shared.js` — the existing `BM25Index` and `bm25RankResults` are imported read-only by `retrieval.ts`; no changes.

---

## Wave 1 — Sub-system A (Formatter) \+ frozen instruction block

### Goal

Produce a pure, deterministic function that turns any `registeredTool` entry (exactly as MCP SDK stores it on `mcpServer._registeredTools[name]`: `{ title, description, inputSchema, outputSchema, annotations, handler, enabled }`) into a single `<tool>…</tool>` XML element; and lock the instruction-block text so its SHA-256 never drifts. Wave 1 has zero runtime effect — nothing calls these modules yet.

### Task 1.1 — `src/core/xml/xml-escape.ts`

- **File:** `src/core/xml/xml-escape.ts`  
- **What it does:** Provides the two primitives every other XML file uses. `escapeXmlAttribute` hard-escapes the five XML entities for attribute values. `wrapInCDATA` wraps a text payload in `<![CDATA[…]]>`, splitting the input on the `]]>` sentinel (`]]]]><![CDATA[>`) so no payload can prematurely close the CDATA. `escapeXmlText` is used only for short inline labels; long free-form content always goes through `wrapInCDATA`.  
- **Function signatures:**  
    
  export function escapeXmlAttribute(value: string): string;  
    
  export function escapeXmlText(value: string): string;  
    
  export function wrapInCDATA(value: string): string;  
    
- **Edge cases handled:**  
  - Input contains `]]>` → split-and-rejoin with two CDATA sections.  
  - Input contains `\u0000`–`\u0008`, `\u000B`, `\u000C`, `\u000E`–`\u001F` (illegal in XML 1.0) → replaced with U+FFFD.  
  - Input is the empty string → returns `""` (attribute) / `<![CDATA[]]>` (CDATA).  
  - Input is `undefined` / `null` → returns `""` (not throw) — the formatter relies on this to elide absent descriptions.  
- **Acceptance criteria:**  
  1. `escapeXmlAttribute('a"b&c<d>e\'f')` returns `a&quot;b&amp;c&lt;d&gt;e&apos;f`.  
  2. `wrapInCDATA('foo]]>bar')` returns a string that, when fed to any conformant XML parser wrapped in a `<x>…</x>` element, round-trips to `foo]]>bar`.  
  3. `wrapInCDATA('\u0000\u0001')` returns `<![CDATA[\uFFFD\uFFFD]]>`.  
  4. The module has zero imports other than built-in TypeScript types.  
  5. All three functions are marked `export function`, no default export.

### Task 1.2 — `src/core/xml/schema-format.ts`

- **File:** `src/core/xml/schema-format.ts`  
- **What it does:** Converts a single MCP registered tool into its canonical `<tool>` element; also exports `formatToolsBlock` which wraps an array into `<tools>…</tools>` and `formatToolResult` / `formatToolError` used by the dispatcher. The JSON-schema walker handles:  
  - Primitives (`string`, `number`, `integer`, `boolean`)  
  - Arrays (recurses via `<param>` nested `<items>`)  
  - Objects (recurses via nested `<param>` with `type="object"`)  
  - `z.discriminatedUnion(...)` (already present in `edit_file`, `search_files`, `directory`, `read_text_file`) — renders as `<param>` with `type="union"` and nested `<variant discriminator="mode" value="content">…</variant>` children.  
  - `enum` / `z.enum(...)` — `<param type="enum"><value>…</value></param>`  
  - Optional / default — `required="false"` and optional `default="…"`. The walker operates on the *JSON-schema form* (already produced by `zod-to-json-schema` which is a Zenith dep, package.json line 50). We normalize Zod shapes via the exact path MCP SDK uses: `normalizeObjectSchema` semantics (SDK `mcp.js` line 76). We do **not** import private SDK internals; instead we call `zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'none' })` ourselves for Zod inputs, and accept raw JSON Schema objects directly for anything else.  
- **Function signatures:**  
    
  import type { ZodType } from "zod";  
    
  export type RegisteredToolLike \= {  
    
    name: string;  
    
    title?: string;  
    
    description?: string;  
    
    inputSchema?: ZodType | Record\<string, unknown\> | undefined;  
    
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };  
    
    category?: string; // filled in by steady-state.ts when known  
    
  };  
    
  export function formatTool(tool: RegisteredToolLike): string;  
    
  export function formatToolsBlock(tools: readonly RegisteredToolLike\[\]): string;  
    
  export function formatToolResult(opts: {  
    
    toolName: string;  
    
    callId?: string;  
    
    content: string;  
    
  }): string;  
    
  export function formatToolError(opts: {  
    
    toolName: string;  
    
    callId?: string;  
    
    code: "parse\_error" | "unknown\_tool" | "invalid\_input" | "handler\_error" | "dispatch\_timeout";  
    
    message: string;  
    
  }): string;  
    
- **Exact output grammar (canonical):**  
    
  \<tools version="1"\>  
    
    \<tool name="edit\_file" category="filesystem" readOnly="false" destructive="true"\>  
    
      \<description\>\<\!\[CDATA\[Edit a text file.\]\]\>\</description\>  
    
      \<parameters\>  
    
        \<param name="path" type="string" required="true"\>  
    
          \<description\>\<\!\[CDATA\[File to edit.\]\]\>\</description\>  
    
        \</param\>  
    
        \<param name="edits" type="array" required="true"\>  
    
          \<items type="union" discriminator="mode"\>  
    
            \<variant value="block"\>  
    
              \<param name="block\_start" type="string" required="true"/\>  
    
              ...  
    
            \</variant\>  
    
            ...  
    
          \</items\>  
    
        \</param\>  
    
        \<param name="dryRun" type="boolean" required="false" default="false"/\>  
    
      \</parameters\>  
    
    \</tool\>  
    
  \</tools\>  
    
  The `version="1"` attribute is fixed — bumping it is how we invalidate downstream caches without changing semantics of the instruction block.  
    
- **Edge cases handled:**  
  - `inputSchema` is undefined → emit `<parameters/>` (self-closing) so the overall XML remains well-formed.  
  - `description` has embedded `]]>` → funnel through `wrapInCDATA` (already sentinel-safe).  
  - Tool name contains characters outside `[A-Za-z0-9_]` → throw `Error("Invalid tool name for XML injection: " + name)`. This matches Zenith's existing policy — all 10 current tools have snake\_case names.  
  - JSON-schema `$ref` encountered → the formatter follows once with a depth cap of 6; deeper recursion short-circuits to `<param type="object" description="..."/>` with the `$ref` value preserved as an XML comment for human debugging.  
  - `z.record(...)` schemas → serialized as `<param type="object" additionalProperties="true"/>`.  
  - Output is stable: the same input always produces byte-identical output (no `Date.now()`, no random ordering). Object property iteration goes through a sorted `Object.keys(...).sort()` for JSON-schema property maps.  
- **Acceptance criteria:**  
  1. Running `formatTool` against the real `edit_file` registration (from `dist/tools/edit_file.js`) produces XML that validates against the inline DTD in `instruction-block.ts` (Task 1.3).  
  2. Running `formatTool` twice with the same input produces byte-identical strings.  
  3. The rendered XML for every existing Zenith tool parses cleanly through the Task 2.x parser (cross-wave check, verified in Wave 2 review).  
  4. A tool with a discriminatedUnion (e.g. `edit_file.edits[i]`) renders every variant once, in declaration order of the Zod union.  
  5. Unit tests cover: primitive, array, nested object, discriminatedUnion, enum, optional-with-default, null description, empty inputSchema, `]]>` in description, non-ASCII characters.  
  6. No mutation of its input object — a deep-freeze assertion in the test passes.

### Task 1.3 — `src/core/xml/instruction-block.ts`

- **File:** `src/core/xml/instruction-block.ts`  
- **What it does:** Exports the frozen static instruction block (the *only* content Zenith ever places in a host's system prompt) plus its SHA-256 digest. This block explains to the model exactly how to emit `<tool_call>` XML and how `<tool_result>` blocks will appear in the next turn. The string is a `const` — to change it requires a version bump of the `version="1"` attribute in Task 1.2, which the parser (Task 2.x) verifies before dispatch.  
- **Function signatures:**  
    
  export const XML\_TOOL\_INSTRUCTION\_BLOCK: string;  
    
  export const XML\_TOOL\_INSTRUCTION\_VERSION: "1";  
    
  export const XML\_TOOL\_INSTRUCTION\_SHA256: string; // hex digest of XML\_TOOL\_INSTRUCTION\_BLOCK  
    
  export function assertInstructionBlockUnchanged(): void; // throws if runtime hash drifts from compile-time hash  
    
- **Block contents (fixed text, quoted verbatim):**  
    
  You have access to tools provided by the Zenith filesystem agent. Tools are  
    
  exposed to you in two ways:  
    
  1\. A small set of steady-state tools are always available via your native  
    
     tool-use channel. Use them exactly as you would any other tool.  
    
  2\. Additional, dynamically-selected tools appear at the top of the current  
    
     user turn inside a \<tools version="1"\>…\</tools\> XML block. To call one of  
    
     these tools, emit a \<tool\_call\> element anywhere in your reply:  
    
       \<tool\_call\>  
    
         \<name\>tool\_name\_here\</name\>  
    
         \<arguments\>  
    
           \<param\_name\>value\</param\_name\>  
    
           \<other\_param\>\<\!\[CDATA\[raw text value\]\]\>\</other\_param\>  
    
         \</arguments\>  
    
       \</tool\_call\>  
    
     Rules:  
    
       \- One \<tool\_call\> per logical action. Emit multiple \<tool\_call\> blocks  
    
         in one turn when you need to chain actions.  
    
       \- Use \<\!\[CDATA\[…\]\]\> around any value that may contain \<, \>, &, or  
    
         newlines. Short scalar values may omit CDATA.  
    
       \- Do NOT wrap the whole reply in XML. Prose is fine around the calls.  
    
       \- Never invent tools. Only call tools declared in the current \<tools\>  
    
         block or available via native tool use.  
    
     Results will appear in the next user turn as:  
    
       \<tool\_result tool="tool\_name\_here" status="success"\>  
    
         \<content\>\<\!\[CDATA\[…\]\]\>\</content\>  
    
       \</tool\_result\>  
    
     or, on failure:  
    
       \<tool\_result tool="tool\_name\_here" status="error" code="…"\>  
    
         \<message\>\<\!\[CDATA\[…\]\]\>\</message\>  
    
       \</tool\_result\>  
    
  The \<tools\> block in each user turn only lists tools not seen recently; treat  
    
  anything you have seen in the last few turns as still available.  
    
- **Edge cases handled:**  
  - The constant is declared `Object.freeze`\-style by assigning to a `readonly` `const` and re-exporting a frozen object wrapper. The SHA-256 is computed at module init via `crypto.createHash('sha256')` and captured in a `const`. `assertInstructionBlockUnchanged()` re-hashes the live constant and compares; throws if they differ (defends against a future contributor mutating the string at runtime via `Object.defineProperty`).  
  - Line endings are normalized to `\n` in the source file (ESLint/editorconfig already enforces this repo-wide).  
- **Acceptance criteria:**  
  1. `XML_TOOL_INSTRUCTION_SHA256` is a 64-char lowercase hex string that matches the digest of `XML_TOOL_INSTRUCTION_BLOCK`.  
  2. `assertInstructionBlockUnchanged()` is called once inside the Wave 4 gateway registration (Task 4.2) and passes.  
  3. The string contains neither the substring `{{` nor `${` (no accidental template interpolation points).  
  4. The string does **not** contain any tool schema, tool name, parameter name, session id, or dynamic value — grep check: the literal appears unchanged across any two invocations of the test suite and is not touched by runtime code.

### Wave 1 Review (blocking gate)

- All three files compile under the repo's existing `tsconfig.json` (`strict: true`, `module: NodeNext`) with zero warnings.  
- All three files are unit-testable in isolation — no DOM, no MCP SDK, no fs.  
- `vitest run src/core/xml/schema-format.test.ts` passes with ≥ 95 % line coverage on `schema-format.ts` and 100 % on `xml-escape.ts`.  
- Running `formatToolsBlock([...every existing Zenith tool...])` produces a string under 64 KB for the current 10-tool registry (budget check — measured, not speculated).  
- No production code yet imports any of these files. `git grep "from '../../core/xml/"` returns zero hits outside `src/core/xml/`.  
- Instruction block hash is recorded in `tests/golden/xml-instruction-hash.txt`; any future drift fails CI.

---

## Wave 2 — Sub-system B (Parser)

### Goal

Extract zero or more `<tool_call>` elements from an arbitrary model-emitted string. The parser is the single highest-risk component: it sees raw model output, which in practice includes unescaped angle brackets (file contents, code, math), partial tokens at stream boundaries, Unicode control chars, and hallucinated attributes. The design explicitly refuses to use a conformant XML parser and implements the same boundary-safe scanner pattern OpenClaw's `assistant-visible-text.ts` uses to *hide* tags — adapted to *capture* them instead.

### Task 2.1 — `src/core/xml/tool-call-parser.ts`

- **File:** `src/core/xml/tool-call-parser.ts`  
- **What it does:** Scans a string for top-level `<tool_call>` and `</tool_call>` tag boundaries, captures the span between each matched pair verbatim, and then runs a second shallow pass to extract `<name>`, `<arguments>`, and each child of `<arguments>` as `{ paramName: rawString }` pairs. "Raw" here means: whatever text sat between the child's open and close tags, minus one level of `<![CDATA[…]]>` unwrap. Values that are not CDATA-wrapped are passed through unchanged (no entity decoding, no whitespace collapse) — callers that need typed values go through `coerceArgument` (see below).  
- **Function signatures:**  
    
  export type ParsedToolCall \= {  
    
    name: string;  
    
    args: Record\<string, string\>;      // raw string → per-arg  
    
    callId?: string;                   // optional \<tool\_call id="…"\>  
    
    span: { start: number; end: number };  
    
  };  
    
  export type ParseDiagnostic \= {  
    
    kind:  
    
      | "unclosed\_tool\_call"  
    
      | "missing\_name"  
    
      | "empty\_arguments"  
    
      | "duplicate\_param"  
    
      | "stream\_boundary\_truncation"  
    
      | "nested\_tool\_call";  
    
    span: { start: number; end: number };  
    
    detail: string;  
    
  };  
    
  export type ParseResult \= {  
    
    calls: ParsedToolCall\[\];  
    
    diagnostics: ParseDiagnostic\[\];  
    
    cleanedText: string; // input with all successfully-captured \<tool\_call\>…\</tool\_call\>  
    
                         // spans removed, so the host can still surface the model's prose  
    
  };  
    
  export function parseToolCalls(modelText: string): ParseResult;  
    
  export function coerceArgument(  
    
    raw: string,  
    
    jsonSchema: Record\<string, unknown\>,  
    
  ): unknown;  
    
- **State-machine outline (exact):** States \= `OUTSIDE`, `IN_TAG`, `IN_ATTRIBUTE_QUOTE_DOUBLE`, `IN_ATTRIBUTE_QUOTE_SINGLE`, `IN_CDATA`, `IN_TOOL_CALL`.  
  - `OUTSIDE`: scan for the literal substring `<tool_call`. On hit, switch to `IN_TAG` starting at the `<`. A preceding backtick-code-fence check (three consecutive `` ` `` on a line, tracked with a simple `inCodeFence` flag flipped every fence run) means we skip calls that live inside markdown fenced blocks — models routinely paste example `<tool_call>`s as documentation.  
  - `IN_TAG`: read attributes using the same quote-aware scanner as OpenClaw's `findTagCloseIndex` (handles `\"` escapes inside attribute values). If the `>` closer is found and the tag is self-closing (`/>`), emit a diagnostic `empty_arguments` and continue. Otherwise switch to `IN_TOOL_CALL`.  
  - `IN_TOOL_CALL`: scan forward character-by-character. Any `<![CDATA[` pushes `IN_CDATA`; `]]>` pops it. A nested `<tool_call` while depth \> 0 → record `nested_tool_call` diagnostic and abort that call. Close on matched `</tool_call>` — only outside `IN_CDATA`.  
  - Stream-boundary: if we reach end-of-input while `IN_TOOL_CALL` or `IN_CDATA`, emit `stream_boundary_truncation` and *do not* include the partial call in `calls`. The captured span is also **not** removed from `cleanedText` — the host can then stream more text and re-parse the concatenation.  
  - The inner extractor for `<name>` and `<arguments>` uses the same state machine restricted to that substring, with one extra rule: empty `<arguments/>` is legal and yields `args: {}`.  
- **Argument coercion (`coerceArgument`):**  
  - JSON-schema `type: string` → return `raw` unchanged (after CDATA unwrap).  
  - `number` / `integer` → `Number(raw.trim())`, throws via the dispatcher if `NaN`.  
  - `boolean` → accept `true`/`false`/`1`/`0`/`yes`/`no` case-insensitively; anything else throws.  
  - `array` → parse as either JSON (if first non-WS char is `[`) or repeated child elements of the same name inside `<arguments>` — the parser already supports this because duplicate keys emit a `duplicate_param` diagnostic unless the target schema is an array, in which case they are merged into `string[]`.  
  - `object` → parse as JSON (first non-WS char must be `{`), else throw. Rationale: nested object params are rare in Zenith (only `refactor_batch` has any), and asking the model to emit JSON-inside-XML for these is simpler than nested parameter tags.  
  - `enum` → exact match against `enum` list; throws on miss.  
- **Edge cases handled:**  
  - Unescaped `<` inside a value that is NOT CDATA-wrapped → the state machine will misinterpret it as a tag start. Mitigation: if the "tag" that opens does not match any known Zenith tag namespace (`tool_call`, `name`, `arguments`, `tool_result`, `param`) the scanner treats the `<` as literal text and continues. This is exactly OpenClaw's approach (its `TOOL_CALL_TAG_NAMES` set) and we lift the same strategy.  
  - Model emits `<tool_use>` or `<function_calls>` instead of `<tool_call>` → `parseToolCalls` accepts the aliases (`tool_call`, `tool_use`, `toolcall`, `function_call`, `function_calls`) by configurable whitelist; aliases are normalized to `tool_call` in the output. This matches OpenClaw's `TOOL_CALL_TAG_NAMES`.  
  - Hallucinated attributes on `<tool_call>` other than `id` → silently ignored.  
  - Model places `<name>` *after* `<arguments>` → accept; extractor is order-agnostic.  
  - Multiple `<tool_call>` in one reply → all returned, in document order.  
  - Model emits a well-formed `<tool_call>` inside a triple-backtick fence (documentation example) → skipped, never dispatched. This is the most common "model explains what it would do" failure mode.  
  - Whitespace-only or zero-byte string → `{ calls: [], diagnostics: [], cleanedText: "" }`.  
- **Acceptance criteria:**  
  1. Round-trip: feed the output of `formatToolsBlock` (Wave 1\) into a model simulator that emits `<tool_call>` for one of them, then feed that text into `parseToolCalls`; the returned `ParsedToolCall.name` equals the tool name and `args` matches the emitted key/value pairs.  
  2. Property test (`fast-check`) — for 1 000 random valid `<tool_call>` inputs with CDATA-wrapped values containing arbitrary printable Unicode, `parseToolCalls` recovers `args` byte-identically to the generator's input.  
  3. Property test for adversarial inputs: 1 000 random malformed strings (unclosed tags, unbalanced CDATA, nested `<tool_call>`, stream truncation at every byte offset of a valid call) — parser never throws, always returns a `ParseResult`, no diagnostic span is empty.  
  4. A reply containing `<tool_call>` inside triple-backtick fences yields zero calls.  
  5. Coverage ≥ 95 % lines on the module; every state-machine branch hit by at least one test.  
  6. Parser throughput ≥ 50 MB/s single-threaded on a 10-tool-call, 64 KB input (benchmarked; measured against `process.hrtime.bigint`).

### Task 2.2 — `src/core/xml/tool-call-parser.test.ts`

- **File:** `src/core/xml/tool-call-parser.test.ts`  
- **What it does:** Exercises every state-machine edge case plus property tests. Uses `vitest` and `@fast-check/vitest` as the only new dev dependency.  
- **Acceptance criteria:**  
  1. Test file exports the golden corpus used in Wave 2 review.  
  2. All named edge cases in 2.1 are individually asserted.  
  3. Runs in \< 3 s on the repo's standard CI box.

### Wave 2 Review (blocking gate)

- Parser passes all adversarial property tests (10 000 iterations in CI).  
- Performance benchmark meets the 50 MB/s threshold on reference hardware.  
- No existing Zenith test (`npm run test`) regresses.  
- Parser has zero imports from `@modelcontextprotocol/sdk` — it is usable standalone for fuzzing.  
- `parseToolCalls('')` returns an empty, non-throwing result.

---

## Wave 3 — Sub-system C (Dispatcher) \+ retrieval scaffolding

### Goal

Route `ParsedToolCall`s to the real MCP handler and return formatted `<tool_result>` XML. Set up the per-session state and the BMX\_plus retrieval index. No host-facing tool is registered yet — that is Wave 4\.

### Task 3.1 — `src/core/xml/session-state.ts`

- **File:** `src/core/xml/session-state.ts`  
- **What it does:** Creates and owns the per-session XML state. Exactly one `XmlSessionState` exists per `FilesystemContext`. It tracks: (a) the set of steady-state tools, (b) the set of deferred tools, (c) a per-turn rolling digest of the schemas injected in the last 5 turns (FIFO of SHA-1 digests), (d) a lazily-built `BM25Index` over the deferred tool corpus (name \+ description \+ param names joined), (e) a `turnCounter` advanced every time `emitXmlBlockForUserTurn` is called, (f) the already-seen-callIds set (defends against the same XML call being dispatched twice because a naive host re-sends assistant text).  
- **Function signatures:**  
    
  import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";  
    
  export type XmlSessionState \= {  
    
    readonly steadyState: ReadonlySet\<string\>;  
    
    readonly deferred: ReadonlySet\<string\>;  
    
    getRetrievalIndex(): BM25Index;  
    
    markInjected(toolName: string, digest: string): void;  
    
    wasRecentlyInjected(digest: string): boolean;  
    
    advanceTurn(): number;  
    
    reserveCallId(callId: string): boolean; // true if fresh, false if duplicate  
    
    snapshotRegistry(): RegisteredToolLike\[\]; // from server.\_registeredTools  
    
  };  
    
  export function createXmlSessionState(  
    
    server: McpServer,  
    
    ctx: { sessionId?: string },  
    
  ): XmlSessionState;  
    
- **Edge cases handled:**  
  - Tools registered *after* `createXmlSessionState` (none today, but the MCP SDK's `registerTool` supports late registration, SDK `mcp.js` line 698\) → `snapshotRegistry` re-reads `server._registeredTools` every call. The retrieval index is invalidated on registry-size change (cheap — a number compare).  
  - `ctx.sessionId` may be absent in stdio (the HTTP path sets it in `http.js` line 187). We fall back to `getSessionId()` from `dist/core/symbol-index.js` — the *exact* pattern already used by `edit_file.js` line 74\.  
  - Rolling digest LRU cap \= 5 turns × max 50 schemas/turn \= 250 entries. Stored as a `Map<string, number>` (digest → turnIndex) pruned on each `advanceTurn`.  
- **Acceptance criteria:**  
  1. Two `XmlSessionState`s created from two different ctxs share no mutable state.  
  2. `wasRecentlyInjected(digest)` returns `true` only if the digest was `markInjected`ed within the last 5 `advanceTurn()` calls.  
  3. `reserveCallId("x")` returns `true` on first call, `false` on every subsequent call.  
  4. Memory per state is bounded ≤ 200 KB under a 50-tool-registry worst case (measured via `process.memoryUsage` delta in a test).

### Task 3.2 — `src/core/xml/steady-state.ts`

- **File:** `src/core/xml/steady-state.ts`  
- **What it does:** Declares the 5 steady-state tool names as `STEADY_STATE_TOOLS` and exposes `partitionRegistry(server)` which reads `server._registeredTools` and returns `{ steady: RegisteredToolLike[], deferred: RegisteredToolLike[] }`.  
- **Function signatures:**  
    
  export const STEADY\_STATE\_TOOLS: ReadonlySet\<string\>; // {"read\_text\_file","write\_file","directory","edit\_file","search\_files"}  
    
  export function partitionRegistry(server: McpServer): {  
    
    steady: RegisteredToolLike\[\];  
    
    deferred: RegisteredToolLike\[\];  
    
  };  
    
- **Edge cases handled:** Disabled tools (`.enabled === false`, see SDK `mcp.js` line 617 / 644\) are excluded from both sets. Unknown tools (not in `STEADY_STATE_TOOLS`) are always deferred.  
- **Acceptance criteria:**  
  1. Against the current Zenith registry, `steady.length === 5` and `deferred.length === 5` (`file_manager`, `stashRestore`, `refactor_batch`, `read_multiple_files`, `read_media_file`).  
  2. If a consumer `.disable()`s a steady-state tool, it drops from both sets (never silently promoted to deferred).  
  3. Iteration order of `steady` matches `STEADY_STATE_TOOLS` insertion order (deterministic).

### Task 3.3 — `src/core/xml/retrieval.ts`

- **File:** `src/core/xml/retrieval.ts`  
- **What it does:** Wraps `BM25Index` (imported from `../../core/shared.js` — existing, zero-dep) to rank deferred tools against a query string. Exports both the proactive top-K selector and the reactive post-tool-use scorer. The reactive threshold is a configurable constant `REACTIVE_INJECTION_THRESHOLD = 0.55` (normalized BM25 score is already in \[0,1\] — see `shared.js` line 202). Only schemas above threshold are injected, capped at `REACTIVE_MAX_PER_TURN = 3`.  
- **Function signatures:**  
    
  import { BM25Index } from "../shared.js";  
    
  import type { RegisteredToolLike } from "./schema-format.js";  
    
  import type { XmlSessionState } from "./session-state.js";  
    
  export type RetrievalQuery \= {  
    
    text: string;        // user turn text or recent tool-result text  
    
    topK: number;  
    
    excludeDigests: ReadonlySet\<string\>;  
    
  };  
    
  export function buildDeferredIndex(deferred: readonly RegisteredToolLike\[\]): BM25Index;  
    
  export function proactiveSelect(  
    
    state: XmlSessionState,  
    
    query: RetrievalQuery,  
    
  ): RegisteredToolLike\[\];  
    
  export function reactiveSelect(  
    
    state: XmlSessionState,  
    
    toolResultText: string,  
    
    maxResults?: number,  // default 3  
    
    threshold?: number,   // default 0.55  
    
  ): RegisteredToolLike\[\];  
    
- **Corpus document per tool** (exact composition — deterministic):  
    
  \<name\>  \<name\>  \<name\>  \<title or name\>  \<category\>  \<description\>  
    
  \<paramName1\> \<paramName2\> ...  \<enumValue1\> \<enumValue2\> ...  
    
  Name is triple-weighted by repetition (same pattern `bm25PreFilterFiles` uses at `shared.js` line 334 for path-token boosting). This ensures a direct-name mention in the user's prose dominates prose-only matches.  
    
- **Edge cases handled:**  
  - Empty deferred set → both selectors return `[]` immediately, never build an index.  
  - Query text shorter than 3 tokens after `BM25Index.tokenize` → return `[]`.  
  - A candidate whose `formatTool(tool)` digest appears in `state.wasRecentlyInjected` → filtered out before returning (to enforce the "skip schemas seen in last 5 turns" rule).  
- **Acceptance criteria:**  
  1. Against the current registry, `proactiveSelect` with query `"stash a failed edit"` returns `stashRestore` as the top candidate.  
  2. `reactiveSelect("batch rename across files", ...)` returns `refactor_batch` with score ≥ 0.55.  
  3. Building the index 1 000 times on a 5-tool deferred set completes in \< 50 ms on CI hardware (index construction is trivial with that corpus).  
  4. All returned tools have `formatTool` digests that are **not** in `state.wasRecentlyInjected`.

### Task 3.4 — `src/core/xml/dispatcher.ts`

- **File:** `src/core/xml/dispatcher.ts`  
- **What it does:** Given a `ParsedToolCall`, locates the corresponding entry in `server._registeredTools`, validates the parsed `args` against its Zod input schema using the exact same `safeParseAsync` path SDK uses (SDK `mcp.js` line 174 — but *we* replicate it rather than calling SDK internals, to avoid coupling to private API). On success, invokes `handler(args, { signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS), sendNotification: noop, sendRequest: noop, _meta: {} })` with the same `RequestHandlerExtra` shape real tools already receive. Wraps the returned `CallToolResult` content as `<tool_result>` XML via `formatToolResult` (Task 1.2). On any failure (unknown tool, schema mismatch, thrown error, timeout) returns `formatToolError` XML.  
- **Function signatures:**  
    
  import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";  
    
  import type { ParsedToolCall } from "./tool-call-parser.js";  
    
  export const DISPATCH\_TIMEOUT\_MS \= 120\_000;  
    
  export async function dispatchParsedCall(  
    
    server: McpServer,  
    
    state: XmlSessionState,  
    
    call: ParsedToolCall,  
    
  ): Promise\<string\>; // returns \<tool\_result\>…\</tool\_result\> XML  
    
  export async function dispatchAllCalls(  
    
    server: McpServer,  
    
    state: XmlSessionState,  
    
    calls: readonly ParsedToolCall\[\],  
    
  ): Promise\<string\>; // concatenated, newline-separated \<tool\_result\> blocks  
    
- **Edge cases handled:**  
  - `call.name` is in `STEADY_STATE_TOOLS` → still dispatched correctly (defensive — a model may choose XML even for steady-state tools; we allow it).  
  - `call.name` references a disabled tool → `formatToolError({ code: "unknown_tool" })`.  
  - `state.reserveCallId(call.callId)` returns `false` → return a specially-formatted `<tool_result status="deduped"/>` so the model sees the call was already handled.  
  - Handler returns `{ isError: true, content: [...] }` (the SDK error shape, `mcp.js` line 152\) → wrap as `<tool_result status="error" code="handler_error">` with the content serialized as CDATA-wrapped text.  
  - Handler throws → caught, serialized via `formatToolError({ code: "handler_error", message: err.message })`. Stack traces are dropped (they carry absolute paths — leaking them is a Zenith policy violation; the repo's error policy in `CLAUDE.md` already dictates minimal error output).  
  - `AbortSignal.timeout(DISPATCH_TIMEOUT_MS)` fires → `formatToolError({ code: "dispatch_timeout" })`.  
  - Input validation failure — we replicate the SDK's `normalizeObjectSchema` \+ `safeParseAsync` pipeline, because `_registeredTools[name].inputSchema` is a raw Zod shape (SDK `mcp.js` line 611 via `getZodSchemaObject`), not a Zod schema directly. The replication is 20 lines, fully self-contained, using `zod@^3` which is already transitively present through MCP SDK.  
  - Non-string CallToolResult `content` entries (image/resource, SDK types) → stringified as `<content type="image" />` etc.; binary data is *not* leaked in-line. For Zenith's current 10 tools this path is never exercised, but it's necessary for forward compatibility because `read_media_file.js` returns base64 images.  
- **Acceptance criteria:**  
  1. Dispatching a valid `<tool_call><name>edit_file</name>...</tool_call>` against a ctx over a tmp directory produces the same filesystem effect as calling `edit_file` natively (verified by before/after file contents in an integration test).  
  2. A malformed `<arguments>` (missing required `path`) returns `<tool_result status="error" code="invalid_input"/>` with a message listing the missing field — no partial side-effects on disk.  
  3. Dispatch time for a no-op tool (`directory` on `{ mode: "roots" }`) is \< 5 ms overhead above the native handler cost.  
  4. Calling `dispatchAllCalls` with 10 calls dispatches them sequentially by default (safe for correlated filesystem operations); sequential ordering is verified via a handler that appends to a shared array and asserts order.  
  5. No test case leaks an absolute path in error output.

### Task 3.5 — `src/core/xml/dispatcher.test.ts`

- **File:** `src/core/xml/dispatcher.test.ts`  
- **What it does:** Integration tests that stand up a real `createFilesystemServer` against a tmp dir, register only the real tools, and route XML calls through the dispatcher.  
- **Acceptance criteria:** All branches of `dispatchParsedCall` exercised; no `dist/` file is touched by the test (uses `src/` imports which resolve via `NodeNext` after `tsc` builds).

### Wave 3 Review (blocking gate)

- The dispatcher fully exercises real `edit_file`, `write_file`, `search_files`, `directory`, `read_text_file` through XML paths in integration tests.  
- `XmlSessionState`'s memory footprint and injection-skip logic are demonstrated under a 5-turn simulated session.  
- `retrieval.proactiveSelect` produces the expected ordering on a golden query set committed to `tests/golden/retrieval.json`.  
- No changes to `package.json` runtime dependencies. Dev dep `@fast-check/vitest` added (for Wave 2\) is the only new dep so far.  
- Still zero calls from production code into `src/core/xml/`. Everything compiles into `dist/core/xml/` — visible as tree siblings but unreferenced. This is intentional: the next wave wires it in.

---

## Wave 4 — Gateway tool \+ prompt, session wiring, cache-safe activation

### Goal

Expose the XML layer to hosts through MCP primitives the hosts already know how to consume (`registerPrompt`, `registerTool`). Wire `XmlSessionState` into `createFilesystemServer`. After this wave, the full loop (host pulls instruction block → host pulls per-turn XML → model emits XML → host posts model output to dispatch tool → dispatch runs handlers → host pastes `<tool_result>` into next user turn) is operational end-to-end.

### Task 4.1 — Port `dist/core/server.js` to `src/core/server.ts`

- **File:** `src/core/server.ts` (new; `dist/core/server.js` stays untouched until `tsc` regenerates it).  
- **What it does:** Verbatim port of the existing 127 lines of `dist/core/server.js` to TypeScript, with the following precise additions:  
  - After line 17 (imports), insert:  
      
    import { register as registerXmlGateway } from "../tools/xml\_gateway.js";  
      
    import { createXmlSessionState, type XmlSessionState } from "./xml/session-state.js";  
      
    import { assertInstructionBlockUnchanged } from "./xml/instruction-block.js";  
      
  - In `registerAllTools`, append after line 63: `registerXmlGateway(server, ctx);`  
  - In `createFilesystemServer`, after `registerAllTools(server, ctx);` (line 72\) append:  
      
    const xmlState \= createXmlSessionState(server, ctx);  
      
    (ctx as unknown as { xmlState: XmlSessionState }).xmlState \= xmlState;  
      
    assertInstructionBlockUnchanged();

    
- **Function signatures:** Unchanged from the JS original. All existing exports (`resolveInitialAllowedDirectories`, `validateDirectories`, `createFilesystemServer`, `attachRootsHandlers`) keep their JS signature exactly so `dist/cli/stdio.js` and `dist/server/http.js` keep working across the transition.  
- **Edge cases handled:**  
  - The prebuild guard (`package.json` line 25\) checks only for `dist/core/server.js`'s *existence*. Because our change is additive and the file is regenerated by `tsc`, the guard still passes.  
  - Multiple calls to `createFilesystemServer` each produce their own `ctx.xmlState` (required for HTTP session isolation — verified by integration test).  
- **Acceptance criteria:**  
  1. `npm run build` succeeds.  
  2. Diff between the new `dist/core/server.js` (emitted by `tsc`) and the pre-existing hand-authored version consists **only** of the three additions above plus TypeScript-emit cosmetic differences (the test compares the AST, not source text).  
  3. Both `npm start` and `npm run start:http` still boot, with no new errors on stderr.  
  4. `ctx.xmlState` is a truthy object on every server produced by `createFilesystemServer`.

### Task 4.2 — `src/tools/xml_gateway.ts`

- **File:** `src/tools/xml_gateway.ts`  
- **What it does:** Registers three MCP primitives on the server:  
  1. MCP **prompt** `zenith/xml-tool-use-instructions` via `server.registerPrompt(...)` (SDK `mcp.js` line 726). The prompt takes no arguments and returns one message with `role: "user"` (MCP prompts do not have a `system` role — the host is expected to bind this text into its own system prompt; Zenith *never* claims the system role itself, preserving the cache-safety invariant). Message content \= `XML_TOOL_INSTRUCTION_BLOCK`.  
  2. MCP **tool** `zenith_xml_context` (native tool; listed in `tools/list`; so visible in the steady-state set — but *not* one of the 5 filesystem tools; it's the 6th native tool). Input: `{ userTurnText: string, mode: "proactive" | "session_start" }`. Output: an `<tools version="1">…</tools>` XML block — or an empty `<tools version="1"/>` if nothing fresh needs injecting. Internally calls `partitionRegistry`, then `proactiveSelect` or session-start (steady-state \+ top-K deferred), filters via `state.wasRecentlyInjected`, and emits `formatToolsBlock`. Every tool it selects is recorded via `state.markInjected(name, digest)` before return, and `state.advanceTurn()` is called exactly once. Hosts splice the returned XML to the top of the current user turn (never the system prompt).  
  3. MCP **tool** `zenith_xml_dispatch`. Input: `{ assistantText: string }`. Output: the concatenated `<tool_result>` XML produced by `dispatchAllCalls` — ready for the host to place at the top of the next user turn, before any new user text. Also runs `reactiveSelect` on the concatenated tool-result text and appends its `<tools>` block (if any) so the host gets both result and any newly-relevant deferred schemas in one call.  
- **Function signatures:**  
    
  import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";  
    
  import type { FilesystemContext } from "../core/lib.js";  
    
  export function register(server: McpServer, ctx: FilesystemContext): void;  
    
- **Cache-safety choices inside this file (explicit):**  
  - The prompt is registered once per session and its body never depends on runtime state. Hosts that cache prompts by hash (Claude Code, OpenClaw, Cline) will cache-hit forever.  
  - `zenith_xml_context` output is deliberately ephemeral and flows into the *user* turn, never the system. No caching guarantees are implied.  
  - `zenith_xml_dispatch` is side-effectful (it runs handlers) and is therefore ineligible for prompt caching by construction — the output is result data, not instructions.  
- **Edge cases handled:**  
  - `userTurnText` is empty → `proactiveSelect` returns `[]`, we emit `<tools version="1"/>` and still advance the turn.  
  - `assistantText` contains zero `<tool_call>` → dispatch returns an empty string; the reactive selector may still emit a `<tools>` block based on the assistant's prose.  
  - The host calls `zenith_xml_dispatch` without having previously called `zenith_xml_context` this session → this is legal; we infer turn boundaries from dispatch calls alone when context calls are skipped.  
  - Concurrent calls on the same session: a `Promise<void>`\-backed mutex on `ctx.xmlState` serializes `advanceTurn` to avoid race on the rolling digest.  
  - Very large `assistantText` (\> 2 MB): truncate with an explicit diagnostic in the returned XML (`<tool_result status="error" code="parse_error" message="input_exceeds_2mb"/>`) — prevents the parser state machine from being exercised on pathological input.  
- **Acceptance criteria:**  
  1. `tools/list` on a fresh server reports 12 tools (10 existing \+ `zenith_xml_context` \+ `zenith_xml_dispatch`) — explicitly enumerated in the test.  
  2. A call to `zenith_xml_context` with a fresh session returns a `<tools>` block containing exactly the 5 steady-state tools \+ up to 3 proactively-selected deferred tools. Calling it again with identical `userTurnText` within 5 turns returns `<tools version="1"/>` (no duplicates).  
  3. Round-trip integration test: `zenith_xml_context` → simulated model emits `<tool_call>` for `stashRestore` → `zenith_xml_dispatch` → resulting `<tool_result>` contains the expected content; no filesystem-side effect outside the allowed dirs.  
  4. The `zenith/xml-tool-use-instructions` prompt returns bytes whose SHA-256 equals `XML_TOOL_INSTRUCTION_SHA256`.  
  5. Two HTTP sessions running concurrently (verified by spinning up two `createSessionPair` instances) have independent `xmlState` and non-interfering `markInjected` histories.

### Task 4.3 — Port `dist/core/lib.js` to `src/core/lib.ts`

- **File:** `src/core/lib.ts`  
- **What it does:** Verbatim port of the 382-line JS file. One behavioural addition: the `FilesystemContext` return type is extended with an optional `xmlState?: XmlSessionState` field and an optional `sessionId?: string` field (the latter is already set by `http.js` line 187 but was previously untyped). All existing functions (`validatePath`, `setAllowedDirectories`, `getAllowedDirectories`, `formatSize`, `createUnifiedDiff`, `applyFileEdits`, `searchFilesWithValidation`, etc.) keep identical signatures.  
- **Acceptance criteria:**  
  1. `npm run test` (vitest) still passes — every existing test touching `lib.js` is unaffected.  
  2. `search_files.ts` / `edit_file.ts` / other tool files compile without change against the new types.  
  3. `FilesystemContext` is now exported as a named type, where before it was implicit.

### Task 4.4 — Port `dist/cli/stdio.js` to `src/cli/stdio.ts` and `dist/server/http.js` to `src/server/http.ts`

- **File:** `src/cli/stdio.ts`, `src/server/http.ts`  
- **What it does:** Pure porting — TypeScript types added, zero behaviour change. The hybrid-dist guard in `package.json` keeps `dist/cli/stdio.js` existing; `tsc` overwrites both on build. `http.ts` already constructs a fresh ctx+server per session via `createSessionPair` (http.js line 99), so `XmlSessionState` will be naturally per-session.  
- **Acceptance criteria:**  
  1. `zenith-mcp /tmp` boots and stays up.  
  2. `zenith-mcp-http --port=3100` boots, `/health` responds, two concurrent `POST /mcp` initialize requests produce two distinct session IDs each with its own `xmlState`.  
  3. Session-reap path in `http.ts` correctly releases `xmlState` references (verified by inducing heap delta via 100 spawn/reap cycles).

### Wave 4 Review (blocking gate)

- Full end-to-end loop (pull instructions → pull per-turn XML → emit `<tool_call>` → dispatch → receive `<tool_result>`) works against a real MCP client (`mcp-inspector` as the test harness).  
- Prompt-cache test: the `zenith/xml-tool-use-instructions` prompt returns byte-identical content across 1 000 invocations and across 10 server restarts.  
- The API-level `tools` array reported by `ListToolsRequestSchema` does **not** change between turns for a given session — asserted by capturing the response on turn 0 and turn 10 and diffing.  
- No schema XML is ever present in the system prompt as surfaced by `zenith/xml-tool-use-instructions` (assert: the prompt body contains neither `<tool name=` nor `<tool_call>` as-structure — only as documentation text inside code examples, which are guarded by the fence-skip rule in the parser).  
- No regressions in existing test suite.

---

## Wave 5 — Hardening, adapter update, rollout

### Goal

Tighten edges, update the OpenClaw adapter metadata so OpenClaw clients auto-discover the new Zenith surface, and ship.

### Task 5.1 — `src/adapters/platforms/openclaw.ts` — advertise the new surface

- **File:** `src/adapters/platforms/openclaw.ts` (already exists, see repo layout).  
- **What it does:** Adds an optional `capabilities` block to the `registerServer` data payload so OpenClaw auto-wires the new prompt and two tools. The existing `registerServer` merges into `data.mcpServers[name]`; we extend it to also merge into `data.mcpServers[name].capabilities = { zenithXml: { version: "1", instructionPromptId: "zenith/xml-tool-use-instructions", contextToolName: "zenith_xml_context", dispatchToolName: "zenith_xml_dispatch" } }`. OpenClaw's config consumer reads this optional block; if absent, it falls back to legacy native tool use, so the change is back-compat for existing installs.  
- **Acceptance criteria:**  
  1. A fresh `openclaw.json` produced by `zenith-mcp-config` against the OpenClaw adapter contains the `capabilities.zenithXml` block.  
  2. An existing `openclaw.json` (pre-change) running through the adapter has the block added non-destructively (read-modify-write; other keys preserved).  
  3. No change to the adapter for any platform other than OpenClaw.

### Task 5.2 — Telemetry hooks (stderr-only, no new exfiltration path)

- **File:** `src/core/xml/telemetry.ts`  
- **What it does:** Emits single-line `console.error` entries (same channel the existing server uses — see `http.js` line 89 "session reaped") for four events: `xml_inject` (tools \+ digests), `xml_dispatch_ok`, `xml_dispatch_err`, `xml_parse_diag`. Entries are JSON one-liners; they include no absolute paths (policy) and no session content (only counts \+ tool names \+ digests). Hosts that want to audit injection behaviour can tail stderr.  
- **Function signatures:**  
    
  export function logXmlEvent(event: {  
    
    kind: "inject" | "dispatch\_ok" | "dispatch\_err" | "parse\_diag";  
    
    session?: string; // 8-char prefix only  
    
    tool?: string;  
    
    digest?: string;  
    
    error?: string;  
    
  }): void;  
    
- **Acceptance criteria:**  
  1. A dispatched XML call produces exactly one `dispatch_ok` log line.  
  2. A malformed `<tool_call>` in assistant text produces exactly one `parse_diag` line and zero dispatch lines.  
  3. No log line contains any absolute filesystem path or any raw CDATA payload.

### Task 5.3 — Docs updates

- **Files:** `ARCHITECTURE.md`, `README.md`, `CLAUDE.md` — add a new "XML Tool Surface" section pointing to the files under `dist/core/xml/` and the two new host-facing tools plus the prompt. No change to existing sections.  
- **Acceptance criteria:** `markdownlint-cli2` (already configured in OpenClaw's `.markdownlint-cli2.jsonc`; Zenith inherits via VS Code) passes; documentation renders on GitHub without broken links.

### Task 5.4 — Smoke-test matrix

- **File:** `tests/xml/smoke.test.ts`  
- **What it does:** Runs the end-to-end loop against four simulated "providers" — Anthropic (JSON tools \+ XML extended), OpenAI (JSON tools \+ XML extended), Kimi/Minimax (XML only; pretend the native tool-use channel is unavailable), local Ollama/LMStudio (XML only). Each simulation feeds canned model outputs into `zenith_xml_dispatch` and verifies expected filesystem side-effects and `<tool_result>` shape.  
- **Acceptance criteria:** All four simulations green on CI. Each runs under 2 s. Failure of any blocks release.

### Wave 5 Review (blocking gate)

- All five waves' tests green on CI.  
- No new runtime dependency introduced across the entire change set (verified via `diff package.json` — only dev deps added).  
- The existing BMX+ search engine is demonstrably shared between `search_files` and `retrieval.ts` (grep: the only `new BM25Index()` constructor call in `retrieval.ts` is on an import from `../../core/shared.js`, not a redefinition).  
- Instruction-block hash recorded in Wave 1 review still matches production build.  
- Manual sniff-test with a real MCP host (Claude Desktop config file written by the adapter, point at the built `zenith-mcp` binary) confirms (a) the prompt is discoverable, (b) a model given the prompt \+ a user turn with the context XML correctly emits `<tool_call>` for a deferred tool, (c) the dispatch result is received.

---

## Dependency Proof Table

| Task | Depends On | Why |
| :---- | :---- | :---- |
| 1.2 `schema-format.ts` | 1.1 `xml-escape.ts` | Every output string containing description / default value flows through `wrapInCDATA` / `escapeXmlAttribute`. Without 1.1 the output would corrupt on `]]>` or embedded angle brackets. |
| 1.3 `instruction-block.ts` | 1.2 grammar decisions | The block documents the exact XML shape the formatter emits and the parser accepts. Changing 1.2's grammar without updating 1.3 desyncs the model's behaviour from the dispatcher. |
| 2.1 `tool-call-parser.ts` | 1.2, 1.3 | Parser accepts the inverse of what the formatter emits; the instruction block is the model's contract. |
| 3.1 `session-state.ts` | 1.2 `formatTool` | `markInjected` keys a digest of each schema's canonical XML — requires 1.2's deterministic output. |
| 3.3 `retrieval.ts` | 3.1, 3.2, `dist/core/shared.js` BM25Index | Needs partition \+ recency filter \+ the existing BM25 engine. Reimplementing BM25 would fork Zenith's ranking into two independent engines — unacceptable. |
| 3.4 `dispatcher.ts` | 2.1, 3.1 | Parser provides `ParsedToolCall`; state provides dedup \+ registry snapshot. |
| 4.1 `server.ts` port | 3.1, 4.2 registration helper | `createFilesystemServer` must attach `ctx.xmlState` only after all tools including `xml_gateway` are registered; otherwise the gateway's `partitionRegistry` snapshot would miss itself. |
| 4.2 `xml_gateway.ts` | 1.2, 1.3, 2.1, 3.4, 3.3, 3.1 | This tool is the host-facing wiring; it calls every underlying module. |
| 4.3, 4.4 ports | 4.1 | Lib and transports share the ported `FilesystemContext` type introduced in 4.1/4.3. |
| 5.1 openclaw adapter | 4.2 | Advertises the gateway's tool names and prompt ID — requires those to be finalized. |
| 5.4 smoke | 4.2 | End-to-end loop only exists after Wave 4\. |

---

## Open Questions

1. **Should `zenith_xml_dispatch` run tool calls sequentially or in parallel?**  
     
   - Options: (a) sequential (current plan), (b) parallel via `Promise.all`, (c) sequential by default with opt-in `{ parallel: true }` input flag.  
   - Recommendation: **(c)**. Zenith's `edit_file` \+ `refactor_batch` can write to the same file, so naive parallelism will data-race at the temp-file-rename boundary (`edit_file.js` lines 61–68 use a single `.tmp` path per target file but nothing serializes across tools). Sequential is correct by default; `parallel: true` is a host-owned escape hatch for read-only workloads. Exposing it lets OpenClaw-style aggressive agents opt in without trapping careful ones.

   

2. **Should steady-state be exactly the 5 from the brief, or include `zenith_xml_context` / `zenith_xml_dispatch` so hosts that ignore MCP prompts still discover them?**  
     
   - Options: (a) exactly 5 filesystem tools (brief's request), (b) 5 \+ the 2 gateway tools \= 7\.  
   - Recommendation: **(b)**. A host that never calls `registerPrompt` consumers (some lightweight clients) needs *some* way to reach the dispatch tool. Registering the gateway tools as native keeps the "5 steady-state filesystem tools" story intact (they're the 5 filesystem ones) while making the dispatch pipe itself discoverable through `tools/list` alone. The brief's "5" applies to the filesystem surface that the model should treat as its primary tool kit; `zenith_xml_context` / `zenith_xml_dispatch` are plumbing, not surface.

   

3. **Should the parser accept Anthropic-style `<invoke name="x">...</invoke>` / `<function_calls>` as synonyms for `<tool_call>`?**  
     
   - Options: (a) strict — only `<tool_call>`, (b) permissive — accept Anthropic's documented aliases, (c) strict with a single documented alias.  
   - Recommendation: **(b)**. The parser already handles these aliases trivially (the scanner's tag-name set is one constant). Rejecting Anthropic's own syntax would force models into a Zenith-specific dialect they don't natively produce — a direct contradiction of the "provider-agnostic" goal. The dispatcher normalizes everything to one canonical name before execution, so no downstream code cares which alias arrived.

   

4. **Should the reactive injection fire only after `<tool_result>` text or also after prose-only assistant turns?**  
     
   - Options: (a) only after tool results (most conservative), (b) after every turn where BMX+ scores a deferred tool ≥ 0.55, (c) after tool results and any turn with an explicit model request (`"I need a tool that …"`).  
   - Recommendation: **(a)**. The brief explicitly says reactive injection fires "post tool call hook". Expanding the trigger surface adds nondeterminism to injection — which directly inflates cache churn for clients that are *trying* to key their cache on turn content. Keep reactive tied to concrete tool-result text, leave prose-inferred needs to the proactive path, where the host already has control over cadence.

---

## Cache-preservation audit (addressed by construction, per wave)

- **Wave 1**: The instruction block is frozen at compile time; its hash is recorded as a CI-enforced golden file. The schema formatter is deterministic and pure. Neither wave-1 artifact is invoked at runtime.  
- **Wave 2**: Parser is read-only over assistant text. No cache surface touched.  
- **Wave 3**: `XmlSessionState` is per-session; injection decisions are made inside the *user turn* content the gateway emits. The `tools` array reported to the transport is never mutated after server creation (it is derived once from `_registeredTools`; the gateway's two tools are registered before the first `tools/list` response so the set is stable for the session's lifetime). The BMX+ index is rebuilt lazily per session and never exposed outside the process — it does not appear in any transport payload, cache-relevant or otherwise.  
- **Wave 4**: The `zenith/xml-tool-use-instructions` MCP prompt returns byte-identical text always. The `zenith_xml_context` tool's *output* lives in the user turn by host convention; Zenith does not and cannot place it in the system prompt because MCP prompts carry `role: "user"` messages only. The `tools/list` payload is stable across turns — verified in Wave 4 review.  
- **Wave 5**: Adapter and docs changes cannot affect runtime prompt payloads.

No file in the plan writes schema XML to the system prompt; no file mutates the API `tools` array between turns; no file changes the `zenith/xml-tool-use-instructions` text at runtime. These three invariants, held across all five waves, are what makes the cache strategy correct.  
