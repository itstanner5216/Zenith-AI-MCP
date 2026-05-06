## Developer Documentation & Cheat Sheet: Secure Filesystem MCP Server

## CRITICAL
You are working on tool design and implementation for an agent system where context efficiency is critical.

Previous failures:

The previous tool design produced extreme tool bloat: about 7.5x useless tool output for every 1x useful information. This wasted context, degraded memory, and harmed agent performance.

Design rule:
1. Return only new, decision-relevant information.
2. Do NOT return information the caller already knows, can directly infer from the request, or can get from a separate tool that already exists for that purpose. Each tool has an explicit scope. No tool should step outside of its scope, regardless if it's "helpful" 

Required workflow:
- Do NOT parrot request inputs back in the response.
- Do NOT return paths, selectors, mode names, line ranges, oldText, newText, diffs, metadata, or summaries unless they are strictly necessary to disambiguate the result or recover from failure.
- Stay within the tool's scope. A tool should return only what is necessary for its own job.
- If another dedicated tool exists for metadata, diagnostics, file info, diff inspection, or search, do not duplicate that functionality in another tool's return. Stay within the tools scope. 
- Prefer MINIMAL success responses. 
- Do not be "helpful" by adding verbose diagnostics. Headers, separators, extra non essentials for "nice" formatting. 

Response discipline:
- Success should usually be as small as possible, for example:
  '{successful}'
- Dry-run should usually be minimal, for example:
  '{Dry Run Successful}'
- Failure should include only actionable new information, for example:
  {"OLD_TEXT_NOT_FOUND"}
  {"PARSE_ERROR","message":"Expression expected.","line":91,"}

Examples of what NOT to do:
**Bad**:
{"ok":true,"path":"/x/y/z.ts","mode":"symbol","symbol":"buildPrompt","line":84,"oldText":"…","newText":"…","summary":"Successfully updated buildPrompt in /x/y/z.ts"}
**Why this is bad**:
The caller already knows the path, target, and requested edit.
Special rule for single-target operations:
- If the caller sent one path, do not parrot back that path.
Only include identifiers like path or edit index when needed to distinguish among multiple possible targets or failures in batch edits or similar use cases where it is needed. 

Rich internals do NOT need to be boasted about in the tool operators returns, that means they do NOT need to be told "this tool has XYZ features and does N" in reference to what the tool does on the backend.

**Enforced repo policy **:
- When designing or modifying tools, optimize for minimal, scope-correct, non-duplicative outputs. Guard aggressively against context bloat. If unsure whether to include a field, omit it unless it clearly changes the caller's next action.

---

### 1. High-Level Architecture & File Structure

The entire project is TypeScript in `src/`, compiled to `dist/` via `tsc`. `dist/` is gitignored. The server uses a modular architecture, isolating tool logic from core engine capabilities.

*   **`src/cli/stdio.ts` (stdio Entry Point):** The primary local entry point. Parses CLI arguments, establishes allowed directories, initializes the `McpServer`, registers tools, and connects over stdio transport.
*   **`src/server/http.ts` (HTTP Entry Point):** The remote entry point. Spins up an Express server supporting Streamable HTTP and legacy SSE transports with bearer-token auth, per-session isolation, and session reaping.
*   **`src/core/server.ts` (The Orchestrator):** Creates the `McpServer`, registers all tools, and wires up MCP Roots Protocol handlers for dynamic workspace negotiation.
*   **`src/core/lib.ts` (Security & IO):** Houses low-level file operations. Crucially, it contains `validatePath()` and the `createFilesystemContext()` factory for per-instance directory enforcement.
*   **`src/core/shared.ts` (The Search Engine):** Manages the `ripgrep` integration and houses the inline BM25 ranking algorithm (zero external deps).
*   **`src/core/tree-sitter.ts` (Semantic Parsing):** Manages the loading of WASM grammars and `.scm` queries for 40+ programming languages to enable AST-aware features.
*   **`src/core/edit-engine.ts` (Edit Verification):** Pure-function edit application supporting `content`, `block`, and `symbol` modes with fuzzy matching and indentation preservation.
*   **`src/core/symbol-index.ts` (Symbol Database):** SQLite schema, indexing, impact queries, and version management for the per-project `.mcp/symbols.db`.
*   **`src/core/project-context.ts` (Project Resolution):** Delegates to `src/utils/project-scope.ts` for root resolution: git detection → MCP roots + git on each → marker-based detection (16 project markers) → ProjectRegistry matching → global fallback.
*   **`src/core/project-registry.ts` (Explicit Project Registry):** `ProjectManifest`-based explicit project resolution with 5-tier matching strategy (by ID, name, path segment, exact path, path prefix).
*   **`src/core/stash.ts` (Stash Persistence):** SQLite-backed stash operations routed through `ProjectContext`.
*   **`src/core/compression.ts` (Compression):** Budget computation and toon bridge invocation via child process (`node toon_bridge.js`).
*   **`src/core/toon_bridge.ts` (In-Process Compression Bridge):** Imports directly from `src/toon/string-codec.ts` and `src/core/tree-sitter.ts`. No Python dependency. Extracts AST structure via tree-sitter, then compresses using the in-process toon codec.
*   **`src/core/path-utils.ts` (Path Utilities):** Cross-platform path normalization (WSL-aware, UNC-aware).
*   **`src/core/path-validation.ts` (Path Validation):** Linux-focused path normalization with caching, `isPathWithinAllowedDirectories`.
*   **`src/core/roots-utils.ts` (Roots Utilities):** Parses MCP root URIs (`file://...`) to validated directory paths.
*   **`src/tools/` (The Endpoints):** Directory containing isolated tool definitions (e.g., `edit_file.ts`, `search_files.ts`, `search_file.ts`, `refactor_batch.ts`).
*   **`src/toon/` (Compression Library):** Full compression library ported from Python. Provides BMX+ scoring (`bmx-plus.ts`), SageRank (`sagerank.ts`), deduplication (`dedup.ts`), budget allocation (`budget.ts`), string codec (`string-codec.ts`), encoder (`encoder.ts`), and pipeline orchestration (`pipeline.ts`).

### Supporting Modules

*   **`src/adapters/` (MCP Client Config Adapters):** Auto-configuration for 16 MCP clients (Claude Desktop, VS Code Copilot, Cline, Zed, Cursor, etc.). Abstract `MCPConfigAdapter` base class with per-platform implementations in `src/adapters/platforms/`. Registry in `src/adapters/registry.ts`. Config helpers (JSON5, TOML, YAML) in `src/adapters/helpers/`.
*   **`src/config/` (Settings & CLIs):** Adapter settings (`adapter-settings.ts`, persisted at `~/.zenith-mcp/adapter-config.json`), adapter CLI (`adapter-cli.ts`), and Zenith-MCP server config (`src/config/zenith-mcp/`) with YAML-based `servers.yaml`, admin CLI (`admin-cli.ts`), tool cache management (`cache.ts`), and config types (`types.ts`).
*   **`src/retrieval/` (Retrieval Pipeline):** Opt-in (disabled by default) 6-tier tool retrieval system. Pipeline (`pipeline.ts`), BMXF scoring with weighted RRF fusion (`ranking/`), session state management (`session.ts`), telemetry (`telemetry/`), observability (`observability/`), synthetic routing tool for demoted-tool discovery (`routing-tool.ts`), and Zenith integration hooks (`zenith-integration.ts`).
*   **`src/utils/project-scope.ts` (Project Scope):** Project root resolution with 5-step ladder: git detection → MCP roots with git → marker-based detection (16 project markers) → ProjectRegistry matching → global fallback.
*   **`src/types/` (Vendor Type Declarations):** `vendor.d.ts`, `zod.d.ts` for third-party type augmentations.

---

### 2. Key Integrations: Search & Semantics

#### Tree-sitter (Semantic Code Awareness)
Instead of treating code as plain text, the server uses `web-tree-sitter` (WASM) to understand the Abstract Syntax Tree (AST).
*   **Lazy Loading:** WASM binaries (e.g., `tree-sitter-python.wasm`) and AST queries (e.g., `python-tags.scm`) are loaded only when a file of that type is first encountered, minimizing overhead.
*   **Caching:** Parsed AST symbols are stored in an LRU cache (capped at 100 entries), keyed by a hash of the source code.
*   **Usage:** Upgrades tools to be "code-aware." For example, `search_files` can locate where a specific class is *defined*, `edit_file` can target a logical block like `symbol: "AuthService.login"` for replacement without knowing line numbers, and `refactor_batch` can load and edit symbols across files.

#### BM25 & Ripgrep (Intelligent Search)
To navigate massive codebases while respecting the LLM context limit (`CHAR_BUDGET` ~400k), the server employs a two-stage search:
1.  **BM25 Pre-filtering:** When scanning a repository, the server builds an in-memory BM25 index of file paths (boosted 3×) and their first ~8KB. It ranks them against the natural language query to find the top 100 candidates, passing *only* those to `ripgrep`.
2.  **Ripgrep Execution:** Executes extremely fast regex searches on the pre-filtered files (or falls back to a JS implementation if `rg` is unavailable).
3.  **BM25 Post-filtering:** If the results exceed `RANK_THRESHOLD` (50 lines), BM25 ranks the individual result lines. The most relevant matches are prioritized to fill the character budget, and the rest are truncated.

#### Symbol Index (Project-Wide Code Graph)
Each git repository (or manually registered project root) gets a SQLite database at `.mcp/symbols.db`:
*   **Tables:** `files`, `symbols`, `edges`, `versions`, `patterns`
*   **Indexing:** Tree-sitter definitions and references are persisted per file, with reference edges linking callers to callees.
*   **Impact Queries:** `refactor_batch query` traverses the edge graph to find callers (`forward`) or callees (`reverse`) of a symbol.
*   **Versioning:** Every symbol edit via `edit_file` or `refactor_batch` snapshots the original text to `versions`, enabling rollback via `refactor_batch restore`.

---

### 3. Code-Level Nuances: Security & Editing

#### Edit Verification & Execution (`edit_file.ts` & `edit-engine.ts`)
The edit engine operates using a **Memory-First, All-or-Nothing** approach:
1.  **In-Memory Validation:** Edits are verified against an in-memory string of the file.
    *   *Content Mode:* Uses 3 strategies: exact match, trimmed match (ignores trailing spaces), and indent-stripped match (finds logic blocks and re-indents `newText` to match the file).
    *   *Block Mode:* Requires `block_start` and `block_end` strings. Finds matching block boundaries and replaces the entire block.
    *   *Symbol Mode:* Uses Tree-sitter to find the exact bounds of the symbol to replace, preventing full old-text parroting.
2.  **Atomic Commit:** If *any* edit in a multi-edit batch fails validation, the whole batch is rejected and the file is untouched. Failed edits are stashed to SQLite for retry via `stashRestore`. On success, writes to a temp file, verifies size, and uses `fs.rename()` for an atomic swap.

#### The Stash System
Failed edits and writes are persisted to SQLite (`stash` table, per-project DB) with a 120-second TTL and 2-attempt limit.
*   On edit failure, the error returns a `stashId` and lists only the failed edits with their specific mismatch.
*   On write failure (e.g., permission denied, bad path), the content is stashed and a `stashId` is returned.
*   The LLM retries via `stashRestore apply` — providing the `stashId` and corrected verifications for only the failed edits (or a corrected `path` for writes). Unchanged edits rehydrate from the stash.
*   After 2 failed attempts or 120s, the stash entry is deleted.

#### Security Hardening
*   **Sensitive Files:** `isSensitive()` blocks access to credentials (`.env`, `.pem`, etc.) using `minimatch` glob patterns.
*   **Exclusive Writes:** New file creation uses the `wx` flag to ensure the file doesn't already exist, preventing malicious writes through pre-existing symlinks.
*   **Path Validation:** All tools call `ctx.validatePath()` which expands `~`, resolves symlinks, and enforces that operations remain within `allowedDirectories`.

---

### 4. Tool Catalog Reference

| Tool Name               | Key Capabilities                                | Parameters & Nuances                                                                                                                                                      |
| :---------------------- | :---------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **read_file**           | Multi-mode text reader.                         | `path`, `maxChars`, `head`, `tail`, `offset`, `aroundLine`, `context`, `ranges`, `showLineNumbers`, `compression`. |
| **read_media_file**     | Read images/audio as base64.                    | `path` — returns `{type, data, mimeType}`.                                                                                                                                 |
| **read_multiple_files** | Concurrent multi-file read.                     | `paths` (max 50). Dynamic `CHAR_BUDGET` balancing. `compression`, `showLineNumbers`.                                                                                       |
| **write_file**          | Create/overwrite/append files.                  | `path`, `content`, `failIfExists`, `append` (smart-resumes overlapping tails). Atomic writes.                                                                              |
| **edit_file**           | Surgical, safe file modification.               | `path`, `edits[]`. Modes: `content` (oldContent→newContent), `block` (block_start/block_end/replacement_block), `symbol` (symbol name + newText). `dryRun`. Failures stashed for retry. |
| **stashRestore**        | Retry failed edits, restore versions, stash mgmt.| `mode`: `apply`/`restore`/`list`/`read`. `apply`: `stashId` + `corrections`. `restore`: clears stashId.     |
| **directory**           | Directory exploration.                          | `mode`: `list`/`tree`. `list`: `path`, `depth` (max 10), `includeSizes`, `sortBy`, `listAllowed`. `tree`: `path`, `excludePatterns`, `showSymbols`, `showSymbolNames`. Caps at 250/500. |
| **search_files**        | Content, file, symbol, structural search.       | `mode`: `content`/`files`/`symbol`/`structural`/`definition`. `content`: ripgrep+BM25, always case-insensitive, `literalSearch`, `countOnly`. `symbol`: `symbolQuery` optional (lists all when omitted). `structural`: AST fingerprint similarity. |
| **search_file**         | Single-file grep or symbol search.               | `path`, `grep` (regex, case-insensitive), `grepContext` (max 30), `symbol` (dot-qualified), `nearLine`, `expandLines` (max 50), `maxChars`. Read-only. |
| **file_manager**        | mkdir, delete, move, get metadata.              | `mode`: `mkdir`/`delete`/`move`/`info`. `info` returns size, mtime, permissions.                                                                                          |
| **refactor_batch**      | Cross-file batch refactoring.                   | `mode`: `query` (impact analysis), `loadDiff` (symbol bodies), `apply` (multi-file diff), `reapply` (cached payload on new targets), `restore`, `history`. Outlier detection, syntax gates, rollback. |

---

### 5. Developer Cheat Sheet

**Adding a New Tool:**
1. Create `src/tools/my_new_tool.ts`.
2. Export `register(server, ctx)`.
3. Use `zod` for strict `inputSchema`.
4. **Mandatory:** Call `await ctx.validatePath(args.path)` before *any* `fs` operation.
5. Import and register it in `src/core/server.ts`.

**Adapter System (src/adapters/):**
- `MCPConfigAdapter` base class in `src/adapters/base.ts` — abstract methods: `configPath`, `readConfig`, `writeConfig`, `registerServer`, `discoverServers`.
- 16 platform adapters in `src/adapters/platforms/` (claude-desktop, opencode, cline, codex-cli, codex-desktop, continue-dev, gemini-cli, github-copilot, gptme, jetbrains, openclaw, raycast, roo-code, warp, zed, antigravity).
- `AdapterRegistry` in `src/adapters/registry.ts` — enabled adapters configured via `~/.zenith-mcp/adapter-config.json` or env vars `ZENITH_MCP_ADAPTERS_ENABLED` / `ZENITH_MCP_ADAPTER_BACKUP_DIR`.
- Adapter CLI: `npx zenith-mcp-config --list|--status|--enable <names>|--disable <name>|--backup-dir <path>`

**Config Management (src/config/zenith-mcp/):**
- YAML-based server config at `~/.zenith-mcp/zenith-mcp/servers.yaml`.
- `ZenithMcpConfig` type: `{ servers, profiles, retrieval }` — each server has `tools`, `toolFilters`, `transport`, `idleTimeoutSeconds`.
- Admin CLI: `npx zenith-mcp-config-admin list|status|install|scan` — manages server registrations and tool cache.
- Tool cache (`cache.ts`): merge discovered tools, cleanup stale (disabled + previous cycle), get enabled set.

**Retrieval Pipeline (src/retrieval/):**
- Opt-in via `retrieval.enabled: true` in config (disabled by default).
- 6-tier fallback: (1) BMXF blend of env+conv, (2) BMXF env-only, (3) keyword env-only, (4) static categories by project type, (5) frequency prior from logs, (6) universal namespace-based selection.
- `RetrievalPipeline` intercepts `tools/list` and `tools/call` to filter/proxy tools per session.
- Synthetic `request_tool` routing tool for accessing demoted tools.
- Telemetry (`telemetry/`): workspace fingerprinting, session state, ranking events.
- Observability (`observability/`): rolling metrics, JSONL logger, replay.

**Compression (src/toon/ + src/core/toon_bridge.ts):**
- In-process compression library ported from Python — no external dependencies.
- `toon_bridge.ts` calls tree-sitter `getCompressionStructure()` → toon `compressSourceStructured()` or `compressString()`.
- Invoked by `compression.ts` via `spawn(process.execPath, [compiledBridge, path, budget])` as a child process for memory isolation.
- BMX+ scoring, SageRank, deduplication, budget allocation, string codec.

**Tree-sitter Snippet (Finding a Symbol):**

```javascript
import { findSymbol } from '../core/tree-sitter.js';
// Finds the bounds of a method named 'login' inside 'AuthService'
const matches = await findSymbol(sourceCode, 'javascript', 'AuthService.login', { kindFilter: 'def' });
console.log(`Starts at line: ${matches[0].line}, ends at line: ${matches[0].endLine}`);
```

**BM25 Snippet (Ranking Search Results):**

```javascript
import { bm25RankResults, CHAR_BUDGET } from '../core/shared.js';
// Takes raw Ripgrep output lines and ranks them by relevance to the query
const { ranked } = bm25RankResults(rawRipgrepLines, "authentication logic", CHAR_BUDGET);
```
