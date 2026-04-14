# Codebase Symbol Index — Design Specification

## Overview

This document describes the design goals for a new subsystem integrated into the existing Secure Filesystem MCP Server. The subsystem provides per-project (per-git-repo) SQLite-backed symbol indexing with dependency impact analysis, context-efficient batch diff editing, edit versioning, and cross-session pattern reuse. It is designed to give an agent the ability to scope, plan, batch-edit, and safely roll back refactors in a fraction of the context that traditional file-read-edit workflows consume.

The entire feature surface is exposed as **one tool** — a new mode that extends the existing `edit_file` tool rather than adding parallel tools the agent has to discover and choose between. This is load-bearing: the server steers the workflow through sequential auto-progression, which is what reliably gets an agent to use it correctly rather than fall back to naive file-reading.

---

## Guiding Philosophy

The existing server already enforces one rule above all others: **return only new, decision-relevant information, never waste context.** This subsystem must obey the same constraint throughout every design decision.

Every feature answers one of three questions a model asks during a refactor:
1. **What is the scope of this work?** (impact analysis)
2. **What exactly needs to change?** (batch diff editing)
3. **Can I safely undo or reapply this?** (versioning and pattern reuse)

---

## Core Components

### 1. Per-Project SQLite Database (Auto-Provisioned)

Each git repository root gets its own SQLite file, auto-created on first use and auto-discovered thereafter. The database stores the structured symbol graph for the project.

**Design Goals:**

- Provisioning is invisible to the agent — activating the tool in a new repo just works.
- The database lives at `.mcp/` in the repo root, travels with the project, and is gitignored by default.
- Schema indexes at minimum: symbol name, kind (function, class, method, variable), definition file path (repo-relative), and a serialized call/reference graph edge table.
- Populated and kept fresh via Tree-sitter (already integrated) — no new parsing infrastructure needed. The existing WASM grammars handle extraction.
- Updates are incremental: when a file changes, only that file's symbols are re-parsed and re-written. A file hash check determines whether re-indexing is needed.
- After every successful batch apply, the server immediately re-parses and re-indexes the affected files internally. This is not a tool call — it is a required side effect of every apply. A stale index after an edit would corrupt subsequent impact queries in the same session, making multi-round refactors unreliable.
- The model may exclude a specific symbol occurrence from batch operations by supplying its exact line number as an exclusion hint. The line number must be obtained independently via an existing search tool — this subsystem does not resolve line numbers and is not a codebase search tool. For example, if the model has already located a symbol in a file outside the intended edit scope (e.g., `read_text_file` with `symbol:` mode returned line 88 for a known outlier), it passes that line number as an exclusion hint so the index skips that specific occurrence.

---

### 2. Impact Query

The first thing an agent needs before touching anything is blast radius: "If I change `processPayment`, how many other symbols call it or depend on it?"

**Design Goals:**

- Returns a numbered flat list of every symbol that references the target, grouped by file. No headers, no separators, no line numbers.
- Intentionally terse: symbol name, reference count, and repo-relative file path only. Line numbers are deliberately omitted — the server holds them internally but they are not decision-relevant here. If the agent needs to locate a symbol precisely, it uses an existing search tool on the now-known target file.
- **Symbol disambiguation:** In large repos, the same name may be defined in multiple modules. If the query resolves more than one definition, the server returns them grouped by definition site and requires the agent to narrow scope before proceeding:
  ```
  Multiple definitions found for "validateToken":
  a) auth/tokens.js
  b) legacy/compat.js
  c) api/middleware.js
  Specify a definition to continue.
  ```
  The agent may also pass an optional file scope parameter upfront to skip disambiguation entirely.
- Supports reverse queries — "what does this symbol call?" — and multi-hop depth queries so the agent can ask "what is affected two levels out?" without additional round trips.

**Example response:**

```
1) validateCard[4x] (payments/validator.js)
2) chargeStripe[3x] (payments/stripe.js)
3) auditLog[4x] (audit/logger.js)
4) retryQueue[1x] (workers/retry.js)
12 total
```

The server's response always ends with a prompt for the next step: the numbered list of what the agent can specify to load into the diff.

---

### 3. Drill Down & Batch Diff Editing

After reviewing the impact list, the agent selects which symbols to load. This is a mandatory view step — **the diff cannot be bypassed**. The agent must see the function bodies before any edit is accepted. The server enforces this; providing an edit payload without a loaded diff is rejected.

- **Function body loading:** The server loads the complete function body for each selected symbol. No context range parameter — the function boundaries detected by Tree-sitter define what is loaded. If the agent needs surrounding context beyond the function body, it already has that from compressed reads of the file.

The server assembles a single compact diff document. Each symbol group gets a header; its occurrences — the individual places that symbol appears across the codebase — are numbered sequentially within the group. "Occurrence N" is the Nth entry in the diff for that group, not a line number.

```
validateCard [1] payments/validator.js

<function body>

validateCard [2] payments/stripe.js

<function body>
```

This continues for however many symbol groups were requested. All groups are concatenated into one response — one step, all targets loaded.

**Design Goals:**

- The server pulls each selected symbol from the SQLite index (re-reading the file if the entry is stale).
- **Context budget enforcement:** If the requested selection would exceed the server's character budget, the server loads as many symbols as fit and returns a count of what was deferred:
```
31 of 47 loaded. Next: 32-47
```
  It never silently truncates mid-symbol.
- **Outlier detection:** Before returning the diff, the server scans each occurrence within a group for structural divergence — differing call signatures, integration patterns, or surrounding context suggesting the occurrence may not safely accept the same edit as its peers. Divergent occurrences are flagged inline:
```
validateCard [3] payments/checkout.js ⚠ signature differs
```
  If occurrences within a group require fundamentally different edits, they should be excluded from the batch and handled directly with `edit_file`. The batch is designed for applying one edit across N identical-or-near-identical occurrences.
- **Dry-run mode:** When the model returns an edit payload with `dryRun: true`, the server runs the syntax gate and reports CAUTION flags but applies nothing:

```
  Dry run: 14 edits across 6 files — 0 syntax errors, 2 CAUTION flags (validateCard/3, auditLog/1)
```

  Dry-run is only available once an edit payload has been provided — it cannot be invoked without one.
- **Syntax validation gate (pre-apply, critical):** Before any edit is committed, the server parses the incoming diff through Tree-sitter and rejects any chunk that would produce syntactically invalid code. Rejection is minimal: chunk index and parse error only. No partial commits.
- **Applying edits:** The model returns one edited diff payload. For each symbol group it lists only the occurrences it is targeting — comma-separated indices. Occurrences not listed are not touched. No exclusion syntax.
```
validateCard 1,2,3

function validateCard(card) { if (!card.number) throw new InvalidCardError() return luhn(card.number) }

chargeStripe 1,2,3
```

The server matches each group to its source files via the loaded diff metadata and applies all edits atomically using the existing `edit_file` Symbol Mode machinery. If occurrences within a group require different edits, the model submits them as separate groups with the specific occurrence indices:
```  
validateCard 1,3

validateCard 2
```
- **Batch calls:** The model can pass multiple symbol groups in a single call. The workflow above handles each group simultaneously — a failure in one group does not block the others.
- **Failure handling:** If any chunk fails to apply, the entire group for that symbol is rejected. Groups that applied successfully are not rolled back. The server returns the minimal failing snippet(s). The model has **one** opportunity to submit a corrected edit for the failed group. If that also fails:
  ```
  Review and edit this symbol directly — the file may have changed since the diff was loaded.
  ```
  No further retries are accepted for that group in the current session unless a direct targeted edit is applied separately from this tool.
- **Token efficiency goal:** The agent reads and rewrites only the relevant function bodies plus narrow context — not entire files. For a 20-function refactor across 8 files, this is expected to reduce token consumption by 3–5× compared to read-then-edit workflows.

- **Compression integration:** The batch diff always loads uncompressed function bodies. Compression is never applied to the edit surface. The expected workflow is: the agent explores the codebase via compressed reads (`read_multiple_files` with compression on by default), builds its mental model of the architecture, identifies targets, then enters the batch workflow with those targets. The batch tool handles exact content from that point forward. The agent does not need to re-read files uncompressed before entering the batch workflow — the batch tool does this internally.

---

### 4. Edit Versioning (Undo / Restore)

Every symbol body the batch editor touches is snapshotted into the SQLite database before the edit is applied. Restore and reapply only become available after at least one edit has landed in the current session.

**Design Goals:**

- Pre-edit source text is stored against the symbol's identifier and session identifier (keyed to server PID and working directory). This is automatic — the agent does not manage it.
- The agent can query version history for a symbol and get a terse list of prior versions with timestamps to understand prior edits if context was lost during a compaction phase. 
- A restore operation takes a symbol identifier (or a list) and a version reference, and writes the prior text back using the same atomic edit machinery. Restores are themselves versioned so history is never lost.
- **Reapply:** Once an edit has been applied, the server caches the edit payload for the session. The agent can apply the cached edit to new targets — including symbols it previously excluded — without rewriting the edit body. This is how a pattern discovered mid-session gets applied to additional functions found later.
- Version entries expire at session close. Old snapshots are pruned automatically on session start.

**Why this matters:** The model can refactor confidently knowing it has a symbol-level safety net. Three turns after a batch edit, if it determines two of the changed functions broke an invariant, it restores exactly those two without touching anything else.

---

### 5. Structural Search (Absorbed into `search_files`)

Pattern and structural similarity search — "find other symbols in this repo with the same shape as the ones I just edited" — is not a separate tool. This capability is added as a query mode to the existing `search_files` tool, which already has `symbolQuery` backed by Tree-sitter and BM25. Structural matching is another query type on the same stack: same kind, similar call sites, similar parameter shapes, using Tree-sitter node-type matching rather than text matching.

This keeps the tool count flat and puts the capability where search already lives.

---

### 6. User-Facing Safety

The primary user-facing safety tool is **git**. Before starting a major refactor session, users should commit or stash current state. The SQLite version store handles mid-session, per-symbol restores at the agent level — restore is available as a parameter on the same tool.

A dedicated standalone CLI is not a priority. Git's existing tooling (`git diff`, `git restore`, `git stash`) covers the user-facing safety surface more robustly than a bespoke CLI would. The agent's restore capability handles the in-session use case.

---
## The Single-Tool State Machine

The entire workflow is one tool — a `batch` mode that extends `edit_file`. All parameters exist in the schema at all times, but the server enforces one mandatory gate: the diff must be returned before an edit is accepted. Providing an edit payload without a loaded diff is rejected.

**Stage 0 → 2: Default Path (Skip-Ahead)**
The agent calls `batch` with `symbols` (exact names with optional file paths). The server loads the diff directly. This is the expected entry point — the agent has already explored the codebase via compressed reads and knows its targets.

**Stage 0 → 1 → 2: Impact Query (On Demand)**
The agent calls `batch` with a `query` (symbol name, optional file scope, optional depth). The server returns the impact list. The agent responds with `load` (indices or symbol names). The server returns the compact diff document. This path is for when the agent genuinely doesn't know the blast radius — renaming a widely-used function, changing an interface, or modifying a symbol it hasn't encountered across compressed reads.

**Stage 2 → 3: Apply**
The agent returns the edited diff with occurrence selectors. The server validates, applies, re-indexes, and snapshots originals. On success the server confirms minimally and notes that `restore` and `reapply` are now available.

**Stage 3+: Restore / Reapply**
Available any time within the session. `restore` takes a symbol and version reference. `reapply` takes new target symbols and applies the cached edit payload without the agent rewriting it.
---

## Data Flow

```
batch(query?) called
      │
      ├─ query provided ─────────────────────────────────────────────────┐
      │                                                                        │
      ▼                                                                       ▼
Server asks for query                          Impact query runs → disambiguation if needed
                                                                  │
                                                                  ▼
                                               Numbered impact list returned + load prompt

                                    ┌─ symbols provided at activation (defaultpath) ┐
                                    │                                                │
                                    ▼                                               ▼
                            Agent specifies load indices + range      Server loads diff
                                    │                                                │
                                    └───────────────────────┬────────────┘
                                                            │
                                                            ▼                                                                 
            Budget check → outlier detection → diff assembled (⚠ CAUTION inline)
                                                            │
                                                            ▼
                                Agent reviews diff — CANNOT BE BYPASSED
                                                            │
                                                            ▼
                 Agent returns edited diff + occurrence selectors (optionally dryRun: true)
                                                            │
                                          ┌─────────────────┴──────────────────┐
                                          ▼                                ▼
                                   dryRun: true                          Normal apply
                         Validate + report, no write     Syntax gate → snapshot → apply
                                                                            → internal re-index
                                                                                │
                                                              ┌─────────────────┴────────────────┐
                                                              ▼                                ▼
                                                   Group failure                           Group success
                                              Minimal snippet returned              restore / reapply now available
                                              One retry accepted →
                                              terminal lock if retry fails
```

---

## Integration With Existing Server

This subsystem is additive — it does not modify any existing tool behavior.

| Existing Capability | How This Subsystem Uses It |
|---|---|
| Tree-sitter WASM parsing | Symbol extraction, boundary detection, outlier detection, syntax validation gate, internal re-index after apply |
| `edit_file` Symbol Mode | Underlying apply mechanism for batch edits and restores; `batch` mode is an extension of this tool |
| LRU AST cache | Reused as-is; index population and re-indexing reuse cached parses where available |
| `validatePath()` security | All SQLite DB paths and file targets pass through existing path validation |
| `CHAR_BUDGET` | Enforced during diff load to cap payload size and prevent context overrun |
| `search_files` `symbolQuery` | Extended with structural similarity mode for pattern-based candidate discovery |
| Minimal response discipline | All server responses follow the same terse, scope-correct rules — including auto-progression prompts |
| `_pendingRetries` cache pattern | Session state (`_batchSession`) uses the same map-with-TTL pattern already in `edit_file.js` |

---

## Non-Goals (Out of Scope for This Design)

- Separate tools for each workflow step (impact query, diff load, apply, restore are all params on one tool)
- Standalone user restore CLI (git covers this; in-session restore is handled by the tool itself)
- Real-time file watching / hot-reload of the index (incremental re-index on demand is sufficient; post-apply re-index is internal)
- Cross-repo indexing or monorepo federation
- Type-inference or semantic analysis beyond what Tree-sitter's tag queries provide
- Per-occurrence divergent edits within a single batch group (exclude those and use `edit_file` directly)
- Integration with external code review or CI systems

---

## Resolved Implementation Decisions

1. **Index freshness on load:** Diff load always re-verifies file hashes before assembling. Stale entries are re-parsed on demand.
2. **Diff format:** Custom separator format (as shown in Section 3) is the target. More LLM-readable and reliably parseable than unified diff syntax.
3. **Session boundary:** Server PID + working directory (repo root). Both must remain constant for the session to stay live. When either changes, the session closes and snapshot pruning begins.
4. **Concurrent user/agent edits:** Out of scope. The atomic write machinery handles last-write-wins at the OS level. Users editing files mid-session while an agent is operating do so at their own risk. Play stupid games, get stupid prizes. 
5. **Skip-ahead reliability:** If a model provides symbols at activation and the edits fail syntax validation or apply, normal failure handling applies. No special treatment — the gate catches bad edits regardless of how the session was entered.
