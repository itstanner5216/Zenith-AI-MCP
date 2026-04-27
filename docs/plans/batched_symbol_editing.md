# Refactor Batch Tool — Design Specification

## Overview

This document specifies a new MCP tool, `refactor_batch`, for the Zenith-MCP server. It enables an agent to apply one edit pattern across N similar symbols in a git repository, with impact analysis, structural outlier detection, atomic batch apply, and symbol-versioned rollback.

It is built as a **separate tool**, not as an extension of `edit_file`. A previous attempt to bolt this workflow onto `edit_file` produced ~165 lines of dead code and a bloated schema; that approach is not repeated.

The pitch is honest: this is not "refactor an entire repo in 2-3 calls." It is "apply one edit pattern across N similar symbols safely, with rollback, in one workflow." Realistic gain is **3–10× reduction in tool calls on the batchable slice of a refactor** (renames, deprecations, migration sweeps, logging/telemetry rollouts, error-type swaps), plus a symbol-level safety net the rest of the server doesn't have today.

---

## Guiding Philosophy

The existing server's hard rule applies here: **return only new, decision-relevant information; never waste context.** Every response is minimal, every parameter has a clear purpose, every workflow step earns its place by removing more agent calls than it adds.

The tool answers three questions an agent asks during a refactor:
1. **What is the scope?** (impact analysis)
2. **What exactly needs to change?** (diff load with context)
3. **Can I undo or reapply this?** (versioning + reapply)

---

## Architectural Decisions (Locked)

These are decisions made up-front based on lessons from the previous failed attempt and from honest assessment of the realistic value:

1. **Separate tool, not an `edit_file` mode.** `refactor_batch` is its own tool. `edit_file` stays lean and stateless. Both share `core/edit-engine.js` for actual mutation logic.
2. **Workflow gating via error messages, not coupled state.** The mandatory "load before apply" gate is enforced by the server returning a clear error pointing to the next call. Same pattern `stashRestore` uses today. No bundled state machine forced through one tool.
3. **Caps are by character count, not occurrence count.** Hallucination risk scales with regenerated output size. The server enforces a max regenerated-content budget per apply call.
4. **Context lines around symbols are loaded by default.** The agent gets the function body PLUS configurable lines above and below. The model needs surrounding context to know HOW to edit, not just WHAT.
5. **Outlier detection uses Tree-sitter structural comparison, not text heuristics.** Param node-type sequences, return-type kinds, parent-scope kinds. No comma counting.
6. **SQLite uses WAL mode and concurrent-safe writes.** Parallel sub-agent orchestration is a supported usage pattern, not a tool feature.
7. **Symbol-version subsystem ships first, standalone.** Lower risk, independently valuable, gives `edit_file` a safety net before batch ever lands.
8. **Tool description is honest.** Not "refactor a codebase." It says: "Apply one edit pattern across multiple similar symbols, with rollback."

---

## Core Components

### 1. Per-Project SQLite Database (Auto-Provisioned)

Each git repository root gets its own SQLite file, auto-created on first use, gitignored.

- **Location:** `.mcp/symbols.db` at repo root.
- **Mode:** WAL (`PRAGMA journal_mode=WAL`). Required for parallel sub-agent safety.
- **Schema:** symbol name, kind, repo-relative file path, file hash, last-indexed timestamp, call/reference graph edges, symbol-version snapshots.
- **Population:** Tree-sitter (existing WASM grammars). No new parsing infrastructure.
- **Updates:** Incremental, file-hash gated. Re-index runs after every successful apply.
- **Concurrency:** Re-indexing is idempotent — safe if another agent already re-indexed the same file. Writes serialize at the SQLite layer; no application-level lock needed beyond what WAL gives you. Document the realistic ceiling: 3–8 parallel agents on the same repo before SQLite write contention starts to matter.
- **Project-root resolution:** Use existing `findRepoRoot` from `core/symbol-index.js`. Non-git roots can be registered via the existing `stashRestore init` mode (or auto-created lazily on first batch call).

---

### 2. Impact Query

The first thing an agent needs before touching anything is blast radius.

- **Output:** numbered flat list of symbols that reference the target, grouped by file. Symbol name, reference count, repo-relative path. **No line numbers** — those are not decision-relevant at this stage. If the agent needs precise locations later, it uses `search_files`.
- **Disambiguation:** if the target name resolves to multiple definitions, return the candidate definition sites and require the agent to narrow scope before proceeding.
- **Reverse + multi-hop:** support "what does this call?" and N-level transitive queries.

**Example response:**
```
1) validateCard[4x] (payments/validator.js)
2) chargeStripe[3x] (payments/stripe.js)
3) auditLog[4x] (audit/logger.js)
4) retryQueue[1x] (workers/retry.js)
12 total
```

The response is terminal information — no prose tail like "now call load with…" The next-step is implied by the tool's documented workflow and reinforced by error messages if the agent skips ahead.

---

## STOP

**Must activate the `review-agent-workflow` before moving on to the next task, and follow the workflow. 
Launch a review agent; all issues must be resolved from the previous tasks before continuing.**

Once a review agent passes the implementation;

## CONTINUE

--

### 3. Diff Load (with Context)

After reviewing the impact list, the agent calls `load` with target indices or symbol names, plus an optional context range.

- **Function body:** loaded uncompressed via Tree-sitter symbol bounds.
- **Context range:** integer parameter, default 5, max 30. The server includes that many lines above the symbol and that many lines below. This is how the model differentiates implementation contexts across files — try/catch wrapper, surrounding helpers, scope kind, file conventions. Cost is trivial; benefit is the model can actually edit correctly.
- **Char-based budget cap.** Default 30,000 characters of regenerated content per `apply` call (configurable via env). The `load` step computes total payload size including context lines and headers; if it exceeds budget, the server loads as many symbols as fit and reports remaining count. Pagination via `loadMore`. Never silently truncates mid-symbol.
  - Why chars not occurrences: hallucination risk scales with output size, not input size. 50 small functions is fine; 15 large ones is the danger zone. Char-based cap self-adjusts.
- **Outlier detection (real, structural):** Before assembling the diff, the server compares each occurrence within a symbol group using Tree-sitter:
  - Param node-type sequence (e.g., `Identifier, Identifier, ObjectPattern` vs `Identifier, Identifier`)
  - Return-type node kind
  - Parent-scope kind (e.g., `class_declaration` vs `program`)
  - Decorator presence
  - Async/generator modifiers
  Divergent occurrences are flagged inline with `⚠ <reason>`. **Flagged occurrences require explicit acknowledgement in the apply payload** (e.g., `validateCard 1,2,3 ack:3`) — without ack, the apply rejects them. This is the load-bearing safety mechanism; it is not optional.

**Example diff:**
```
4 in payments/validator.js, 3 in payments/stripe.js
validateCard [1] payments/validator.js
  // upstream: called from checkout.js
function validateCard(card) {
  if (!card.number) throw new InvalidCardError()
  return luhn(card.number)
}
  // downstream: feeds into chargeStripe

validateCard [2] payments/stripe.js ⚠ param shape differs
function validateCard({ card, ctx }) {
  ...
}
```

---

## STOP

**Must activate the `review-agent-workflow` before moving on to the next task, and follow the workflow. 
Launch a review agent; all issues must be resolved from the previous tasks before continuing.**

Once a review agent passes the implementation;

## CONTINUE

--

### 4. Apply

The agent returns the edited diff with occurrence selectors.

- **Format:** symbol header line with comma-separated occurrence indices, optional `ack:` for flagged outliers, then the new body.
  ```
  validateCard 1,2,3
  function validateCard(card) { ... }
  
  chargeStripe 1,2 ack:2
  function chargeStripe(card, amount) { ... }
  ```
- **Pre-apply gates (in order):**
  1. **Load required.** No load → reject with pointer to load step. Load = diff as structured above. 
  2. **Outlier ack required.** Any flagged occurrence in the apply set without `ack:` → reject with the flagged indices listed.
  3. **Char budget.** Total regenerated content > budget → reject with suggestion to split.
  4. **Syntax gate (Tree-sitter parse).** Any chunk that produces parse errors → reject with chunk index and parse-error line/column. No partial commits.
- **Application:** Reuses `core/edit-engine.js` symbol-mode logic. Same atomic temp-file + rename machinery already proven in `edit_file`.
- **Per-group failure semantics:** If a chunk fails syntax or apply, the whole group for that symbol rejects. Other groups that already succeeded are NOT rolled back (they were atomically written). The agent gets one retry on the failed group; failure on retry returns a "review directly" message and locks that group out of the current session.
- **Dry-run:** `dryRun: true` runs all gates, returns syntax-check + outlier summary, applies nothing. Available only with a real edit payload.
- **Post-apply:**
  - Snapshot pre-edit text of every modified symbol into the version store.
  - Re-index affected files (incremental, file-hash gated).
  - Cache the apply payload for `reapply`.
  - Return minimal success: `Applied N symbols across M files.`

---

## STOP

**Must activate the `review-agent-workflow` before moving on to the next task, and follow the workflow. 
Launch a review agent; all issues must be resolved from the previous tasks before continuing.**

Once a review agent passes the implementation;

## CONTINUE

--

### 5. Symbol Versioning

- **Storage:** `symbol_versions` table in `.mcp/symbols.db`. Keyed by repo-relative path + symbol name + session ID (server PID + repo root).
- **Capture point:** any symbol-mode edit through `core/edit-engine.js` (whether via `edit_file` or `refactor_batch`) snapshots the pre-edit body.
- **Version listing:** if `mode === "restore"` is called with a symbol name but no version number, the server returns the version list (timestamp, hash, originating tool). The current behavior of `stash_restore.js:165` (silently calling `restoreVersion(db, args.symbol)` with no list) is replaced.
- **Restore:** takes symbol + version reference, writes prior text back via the same atomic edit machinery. Restores are themselves versioned so history is never lost.
- **`dryRun` parameter on restore:** add to schema (current bug: handler references `args.dryRun` but the restore branch schema doesn't declare it).
- **Pruning:** version entries older than configurable TTL (default: 24h) prune on session start.

---

## STOP

**Must activate the `review-agent-workflow` before moving on to the next task, and follow the workflow. 
Launch a review agent; all issues must be resolved from the previous tasks before continuing.**

Once a review agent passes the implementation;

## CONTINUE

--

### 6. Reapply

Once an edit has been applied, the server caches the edit payload (per symbol group) for the session.

- The agent calls `reapply` with new target symbols (names + optional file scopes).
- The server fetches the cached payload for the originally-edited symbol group, runs the load → outlier-check → syntax-gate → apply pipeline against the new targets.
- New targets go through the same outlier ack flow. If they're structurally different from the originals, they get flagged and require ack.
- This is how a pattern discovered mid-session gets propagated to symbols found later, without the agent rewriting the edit body.

---

## STOP

**Must activate the `review-agent-workflow` before moving on to the next task, and follow the workflow. 
Launch a review agent; all issues must be resolved from the previous tasks before continuing.**

Once a review agent passes the implementation;

## CONTINUE

--

### 7. Structural Search (Existing `search_files`)

Pattern and structural similarity search ("find other symbols with this shape") is already absorbed into `search_files` via the `structural` mode (per the recent schema refactor). No new tool needed. `refactor_batch` does not duplicate this. Simply review the file for completeness, if not robust, edit it until it is. 

---

## The State Machine

`refactor_batch` is one tool with these modes (`z.discriminatedUnion("mode", [...])`):

1. **`query`** — impact analysis. `target` (symbol name), `fileScope?`, `direction: forward|reverse`, `depth?`.
2. **`load`** — load function bodies + context. `selection` (indices from query, or explicit `{symbol, file?}` pairs), `contextLines?` (default 5, max 30), `loadMore?` (boolean, continues from prior truncation).
3. **`apply`** — apply edits. `payload` (the edited diff string), `dryRun?`.
4. **`reapply`** — apply cached payload to new targets. `symbolGroup` (the originally-edited symbol name), `newTargets`, `dryRun?`.
5. **`restore`** — restore a symbol to a prior version. `symbol`, `file?`, `version?` (omit to list versions), `dryRun?`.
6. **`history`** — list version history for a symbol. `symbol`, `file?`.

### Workflow gating (via error messages, not coupled state)

- `apply` without a prior `load` in this session → `"No diff loaded. Call load first."`
- `apply` payload references symbols not in the loaded diff → `"Unknown symbol: <name>. Load it first."`
- `apply` includes flagged outlier without `ack:` → `"Flagged outliers require ack: <indices>"`
- `loadMore` without a prior truncated `load` → `"Nothing to continue."`
- `reapply` for a symbol group never applied → `"No cached payload for <symbol>."`

Session boundary: server PID + repo root. Both stable → session continues. Either changes → session closes, version snapshots prune per TTL.

---

## Caps & Limits

| Limit | Default | Rationale |
|---|---|---|
| `contextLines` | 5 | Enough surrounding context to read intent, not so much that the diff bloats. |
| `contextLines` max | 30 | High-stakes refactors can dial up. Past 30 the agent should be using `read_text_file` instead. |
| Apply char budget | 30,000 | Empirical reliability cliff for regenerated code in single LLM output. |
| Load char budget | 30,000 | Matches apply, since apply re-emits what load returned. |
| Retry per failed group | 1 | After one retry, lock the group and tell the agent to use `edit_file` directly. |
| Symbol-version TTL | 24h | Prune on session start. Configurable. |
| Parallel agents (advisory) | 3–8 per repo | Past this, SQLite write contention starts mattering. Document, don't enforce. |

All limits configurable via env vars: `REFACTOR_MAX_CHARS`, `REFACTOR_MAX_CONTEXT`, `REFACTOR_VERSION_TTL_HOURS`.

---

## STOP

**Must activate the `review-agent-workflow` before moving on to the next task, and follow the workflow. 
Launch a review agent; all issues must be resolved from the previous tasks before continuing.**

Once a review agent passes the implementation;

## CONTINUE

--

**SQLite implementation requirements:**
- `PRAGMA journal_mode=WAL` set on first `getDb()` call.
- `PRAGMA synchronous=NORMAL` (WAL-safe, faster than FULL).
- `PRAGMA busy_timeout=5000` so concurrent writers wait instead of failing immediately.
- Re-indexing must be idempotent: `INSERT ... ON CONFLICT(path, hash) DO UPDATE` semantics.
- Version-snapshot writes use `INSERT ... ON CONFLICT(symbol, file, hash) DO NOTHING` so duplicate snapshots from concurrent agents are silently deduplicated.

The tool itself has no awareness of parallel agents — each call is independent. The `core/symbol-index.js` layer guarantees concurrency safety.

---

## Integration with Existing Server

This subsystem is additive — it does not modify any existing tool's behavior.

| Existing capability | How `refactor_batch` uses it |
|---|---|
| Tree-sitter WASM parsing | Symbol extraction, boundary detection, structural outlier detection, syntax validation gate |
| `core/edit-engine.js` (new, extracted from `edit_file.js` + `stash_restore.js`) | Underlying apply mechanism — single source of truth for block/symbol/content edit logic |
| LRU AST cache | Reused as-is |
| `validatePath()` security | All file targets pass through existing path validation |
| `search_files` `structural` mode | Already provides structural-similarity discovery; `refactor_batch` does not duplicate |
| `findRepoRoot` (`core/symbol-index.js`) | Project-root resolution |
| Stash subsystem | Not directly used; failed batch groups don't go to stash (they get one retry then lock — different semantics) |
| `CHAR_BUDGET` (`core/shared.js`) | Hard ceiling above the apply char budget; the apply budget defaults below CHAR_BUDGET |

---

## Resolved Implementation Decisions

1. **Index freshness on load:** verify file hashes before assembling. Re-parse stale entries on demand.
2. **Diff format:** custom separator format (header + body + blank line) — more LLM-readable than unified diff and reliably parseable.
3. **Session boundary:** server PID + repo root. Either changes → session closes.
4. **Concurrent edits by humans:** out of scope. Atomic write machinery handles last-write-wins. Users editing files mid-session do so at their own risk.
5. **Skip-ahead reliability:** if the agent provides symbols at activation and edits fail validation, normal failure handling applies. No special treatment.
6. **Tool count:** one new tool (`refactor_batch`). Versioning capabilities live initially in `stash_restore` (Phase 1), with potential consolidation in Phase 4 based on real usage.

---

## STOP

**Must activate the `review-agent-workflow` before continuing. Must launch two agents simultaneously for this final review**
**Main Agent must activate `verification-before-completion` and review/verify the full plans correctness and robustness and adherence to final spec in parallel with the final two review subagents. If any warnings or fails are identified they must be fixed, and another review agent must pass the implemented fix or the cycle repeats.**

Once a review agent passes the implementation;

## Plan is now complete.

--
