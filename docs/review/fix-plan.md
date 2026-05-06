# Zenith-MCP Post-Migration Fix Plan

**Goal:** Remediate all structural issues from JS→TS and Python→TS migration (excluding BMX+ sigmoid — reserved for Gemini).
**Total Waves:** 2
**Total Tasks:** 16
**Max Parallel Tasks in Single Wave:** 12

> **Note:** Both reviews' findings are merged here. Gemini's sigmoid findings are excluded per user decision.

---

## Wave 1: Critical Fixes + Independent Dead-Code Purge

> **PARALLEL EXECUTION:** All 12 tasks run simultaneously.
>
> **Dependencies:** None — all against current repo state.
> **File Safety:** Each task touches unique files — no overlaps.

---

### Task 1.1: Fix Duplicate `validatePath` + Module-Level State (C-2, H-8, M-1)

**Files:**
- Modify: `src/core/lib.ts`

**Codebase References:**
- `src/core/path-validation.ts:62-68` — `isPathWithinAllowedDirectories()` function
- `src/core/path-utils.ts:36` — `normalizePath()` import already present on line 8
- `src/core/lib.ts:8-9` — existing imports from path-utils and path-validation

**Implementation Details:**

1. **Remove module-level state** (lines 15-23): Delete `let allowedDirectories`, `setAllowedDirectories()`, and `getAllowedDirectories()` exports.

2. **Remove standalone `validatePath` export** (lines 112-147): Delete the entire standalone `validatePath` function.

3. **Remove dead interface fields** from `FilesystemContext` (lines 29-31): Delete `_sessionId`, `_retrievalPipeline`, and `_toolRegistry`.

4. **Fix `searchFilesWithValidation`** (lines 352-377): Replace the call to standalone `validatePath(fullPath)` on line 360 with direct use of the `allowedDirectories` parameter that's already passed in:
```ts
// Replace:  await validatePath(fullPath);
// With:
const normalizedFull = normalizePath(path.resolve(fullPath));
if (!isPathWithinAllowedDirectories(normalizedFull, allowedDirectories)) {
    continue;
}
```

5. **Keep `minimatch` import** (line 7) — still used on lines 362+364.

**Acceptance Criteria:**
- [ ] No module-level `allowedDirectories` variable exists
- [ ] No standalone `validatePath` export exists
- [ ] `FilesystemContext` has no `_sessionId`, `_retrievalPipeline`, or `_toolRegistry`
- [ ] `searchFilesWithValidation` uses its `allowedDirectories` parameter directly
- [ ] File compiles with `npx tsc --noEmit src/core/lib.ts`

---

### Task 1.2: Consolidate Duplicate `normalizePath` / `expandHome` (C-3)

**Files:**
- Modify: `src/core/path-validation.ts`

**Codebase References:**
- `src/core/path-utils.ts:36` — canonical `normalizePath` (full WSL/Windows/UNC support)
- `src/core/path-utils.ts:110` — canonical `expandHome`
- `src/core/path-validation.ts:11-47` — duplicate `normalizePath` to remove
- `src/core/path-validation.ts:52-57` — duplicate `expandHome` to remove

**Implementation Details:**

1. **Add import** at top of file:
```ts
import { normalizePath, expandHome } from './path-utils.js';
```

2. **Delete** the local `normalizePath` function (lines 11-47), the `normalizeCache` and `MAX_CACHE_SIZE` constants (lines 4-5), and the `expandHome` function (lines 52-57).

3. **Remove `os` import** (line 2) — no longer needed since `expandHome` is imported.

4. **Keep** `isPathWithinAllowedDirectories` (lines 62-69) — it will now use the imported `normalizePath`.

**Acceptance Criteria:**
- [ ] No local `normalizePath` or `expandHome` definitions remain
- [ ] `isPathWithinAllowedDirectories` still works (uses imported `normalizePath`)
- [ ] Only export from this file is `isPathWithinAllowedDirectories`

---

### Task 1.3: Remove Dead Retrieval Pipeline + Fix Version + Fix `onRootsChanged` Caller (C-1, L-5)

**Files:**
- Modify: `src/core/server.ts`

**Codebase References:**
- `src/core/server.ts:24-25` — retrieval imports to remove
- `src/core/server.ts:86-91` — dead instantiation code to remove
- `src/core/server.ts:102` — `onRootsChanged` caller to update (Task 1.4 removes its parameter)
- `package.json:3` — `"version": "0.3.0"`

**Implementation Details:**

1. **Remove retrieval imports** (lines 24-25):
```ts
// DELETE these two lines:
import { createRetrievalPipelineForZenith, ZenithToolRegistry } from '../retrieval/index.js';
import { defaultRetrievalConfig } from '../retrieval/models.js';
```

2. **Remove dead instantiation** (lines 86-91 inside `createFilesystemServer`):
```ts
// DELETE all 5 lines:
const retrievalConfig = defaultRetrievalConfig();
const toolRegistry = new ZenithToolRegistry();
const pipeline = createRetrievalPipelineForZenith({ registry: toolRegistry, config: retrievalConfig });
ctx._retrievalPipeline = pipeline;
ctx._toolRegistry = toolRegistry;
```

3. **Update `onRootsChanged` call** (line 102): Remove the argument:
```ts
// Before: onRootsChanged({ getAllowedDirectories: ctx.getAllowedDirectories });
// After:  onRootsChanged();
```

4. **Fix hardcoded version** (line 74): Read from package.json:
```ts
// Add near top of file:
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const _pkg = _require('../../package.json') as { version: string };

// Then in createFilesystemServer, change line 74:
// Before: { name: "zenith-mcp", version: "0.3.0" }
// After:  { name: "zenith-mcp", version: _pkg.version }
```

**Acceptance Criteria:**
- [ ] No retrieval imports remain in server.ts
- [ ] No `ctx._retrievalPipeline` or `ctx._toolRegistry` assignments
- [ ] `onRootsChanged()` called with no arguments
- [ ] Version is read from `package.json`

---

### Task 1.4: Clean Dead Imports in `project-context.ts` (L-1, L-3)

**Files:**
- Modify: `src/core/project-context.ts`

**Codebase References:**
- `src/core/project-context.ts:5` — unused `findRepoRoot` import
- `src/core/project-context.ts:270-273` — unused `_ctx` parameter

**Implementation Details:**

1. **Remove `findRepoRoot`** from line 5 import:
```ts
// Before: import { findRepoRoot, getDb } from './symbol-index.js';
// After:  import { getDb } from './symbol-index.js';
```

2. **Remove `_ctx` parameter** from `onRootsChanged` (line 270):
```ts
// Before: export function onRootsChanged(_ctx: FsContext): void {
// After:  export function onRootsChanged(): void {
```

> **Note:** The caller update for `onRootsChanged()` is handled in Task 1.3 (server.ts line 102).

**Acceptance Criteria:**
- [ ] No `findRepoRoot` import
- [ ] `onRootsChanged` takes no parameters

---

### Task 1.5: Remove Dead Code in `symbol-index.ts` (Gemini)

**Files:**
- Modify: `src/core/symbol-index.ts`

**Codebase References:**
- `src/core/symbol-index.ts:174-182` — dead `pruneOldVersions` and `defaultVersionTtlMs`

**Implementation Details:**

Delete `pruneOldVersions` (lines 174-177) and `defaultVersionTtlMs` (lines 179-182). These are unexported module-private functions never called anywhere. TTL pruning is already done inline in `getDb()` on line 155.

**Acceptance Criteria:**
- [ ] Neither function exists in the file
- [ ] Existing `getDb()` TTL pruning on line 155 is untouched

---

### Task 1.6: Remove Unused `trimmedLen` Parameter (Gemini)

**Files:**
- Modify: `src/core/edit-engine.ts`

**Codebase References:**
- `src/core/edit-engine.ts:133` — `mapTrimmedIndex` function definition
- `src/core/edit-engine.ts:69` — the only call site

**Implementation Details:**

1. **Remove `trimmedLen` from signature** (line 133):
```ts
// Before: function mapTrimmedIndex(original: string, trimmed: string, trimmedIdx: number, trimmedLen: number): number {
// After:  function mapTrimmedIndex(original: string, trimmed: string, trimmedIdx: number): number {
```

2. **Update call site** (line 69):
```ts
// Before: const origIdx = mapTrimmedIndex(content, trimmedContent, trimIdx, trimmedOld.length);
// After:  const origIdx = mapTrimmedIndex(content, trimmedContent, trimIdx);
```

**Acceptance Criteria:**
- [ ] `trimmedLen` parameter removed from both declaration and call site

---

### Task 1.7: Remove `as any` Casts in Metrics (H-3)

**Files:**
- Modify: `src/retrieval/observability/metrics.ts`

**Codebase References:**
- `src/retrieval/models.ts:116-134` — `RankingEvent` interface confirms all fields exist: `group`, `routerDescribes`, `fallbackTier`, `scorerLatencyMs`, `activeK`, `routerEnumSize`

**Implementation Details:**

Replace every `(ev as any).fieldName` with `ev.fieldName` on lines 76, 84, 87, 91, 100, 102:

```ts
// Line 76: (ev as any).group === group        →  ev.group === group
// Line 84: (ev as any).routerDescribes         →  ev.routerDescribes
// Line 87: ((ev as any).fallbackTier ?? 1)     →  (ev.fallbackTier ?? 1)
// Line 91: (ev as any).scorerLatencyMs ?? 0    →  ev.scorerLatencyMs ?? 0
// Line 100: (ev as any).activeK ?? 0           →  ev.activeK ?? 0
// Line 102: (ev as any).routerEnumSize ?? 0    →  ev.routerEnumSize ?? 0
```

**Acceptance Criteria:**
- [ ] Zero `as any` casts remain in the file
- [ ] All property accesses use direct `ev.` notation

---

### Task 1.8: Clean Dead Functions in `routing-tool.ts` (H-1, H-2, Gemini)

**Files:**
- Modify: `src/retrieval/routing-tool.ts`

**Codebase References:**
- Lines 44-70: `formatNamespaceGrouped` — never imported anywhere
- Line 75: `args` parameter — never used in `handleRoutingCall`

**Implementation Details:**

1. **Delete `formatNamespaceGrouped`** entirely (lines 44-70).
2. **Prefix `args` with underscore** in `handleRoutingCall` (line 75):
```ts
// Before: args: Record<string, unknown>,
// After:  _args: Record<string, unknown>,
```

**Acceptance Criteria:**
- [ ] `formatNamespaceGrouped` removed
- [ ] `args` prefixed with `_`

---

### Task 1.9: Remove Unnecessary `as any` in Scanner (L-2)

**Files:**
- Modify: `src/retrieval/telemetry/scanner.ts`

**Codebase References:**
- Line 144: `(await readdir(dirPath, { withFileTypes: true })) as any`

**Implementation Details:**

Remove the `as any` cast:
```ts
// Before: entries = (await readdir(dirPath, { withFileTypes: true })) as any;
// After:  entries = await readdir(dirPath, { withFileTypes: true });
```

**Acceptance Criteria:**
- [ ] No `as any` cast on the `readdir` call

---

### Task 1.10: Remove Unused Imports in `tokens.ts` (Gemini)

**Files:**
- Modify: `src/retrieval/telemetry/tokens.ts`

**Codebase References:**
- Line 1: `import type { RootEvidence, WorkspaceEvidence } from "../models.js"` — neither used
- Line 106: `[familyKey, familyTokens]` — `familyKey` unused

**Implementation Details:**

1. **Delete line 1** entirely.
2. **Fix destructuring** on line 106:
```ts
// Before: for (const [familyKey, familyTokens] of families.entries()) {
// After:  for (const [, familyTokens] of families.entries()) {
```

**Acceptance Criteria:**
- [ ] No `RootEvidence`/`WorkspaceEvidence` import
- [ ] No unused destructuring variable

---

### Task 1.11: Remove Unused `Tool` Import in `base.ts` (Gemini)

**Files:**
- Modify: `src/retrieval/base.ts`

**Implementation Details:**

Delete line 4: `import type { Tool } from "@modelcontextprotocol/sdk/types.js";`

**Acceptance Criteria:**
- [ ] No `Tool` import remains

---

### Task 1.12: Fix Unsafe Casts in Pipeline (M-6, M-7)

**Files:**
- Modify: `src/retrieval/pipeline.ts`

**Implementation Details:**

1. **Fix `idxOk()`** (~line 167): `PassthroughRetriever` has no `_env_index`, so this always returns `false`. Simplify:
```ts
private idxOk(): boolean {
    // TODO: Wire when BMXF retriever is connected
    return false;
}
```

2. **Fix logger path access** (~line 229): Replace double cast with null fallback:
```ts
// Before: const p = (this.logger as unknown as { _path?: string })._path;
// After:  const p: string | null = null; // TODO: Add getLogPath() to RetrievalLogger interface
```

**Acceptance Criteria:**
- [ ] No `as unknown as { _private_field }` patterns remain
- [ ] Pipeline compiles

---

## Wave 2: Re-Export Cleanup + Type Safety + Utility Extraction

> **PARALLEL EXECUTION:** All 4 tasks run simultaneously.
>
> **Dependencies:** Wave 1 must complete (Task 1.3 changes server.ts; Task 1.4 changes onRootsChanged signature).
> **File Safety:** Each task touches unique files — no overlaps.

---

### Task 2.1: Remove Unnecessary Type Re-Exports (M-4, M-5)

**Files:**
- Modify: `src/retrieval/ranking/index.ts`
- Modify: `src/retrieval/telemetry/evidence.ts`

**Implementation Details:**

1. **`ranking/index.ts`**: Remove lines 3-13 (type re-exports from `../models.js`). Keep lines 1-2 and 14.

2. **`evidence.ts`**: Remove line 4 (`export type { RootEvidence, WorkspaceEvidence }`). Keep the line 2 import (needed by function signatures).

**Acceptance Criteria:**
- [ ] `ranking/index.ts` only exports `BMXIndex`, `RRF_K`, `computeAlpha`, `weightedRrf`, `RelevanceRanker`
- [ ] `evidence.ts` has no `export type` re-exports

---

### Task 2.2: Fix Adapter Type Safety (H-5, H-6)

**Files:**
- Modify: `src/adapters/base.ts`
- Modify: `src/adapters/platforms/raycast.ts`

**Implementation Details:**

1. **`base.ts`**: Change `Record<string, any>` → `Record<string, unknown>` in lines 31-34.
2. **`raycast.ts`**: Change `any[]` → `("macos" | "linux" | "windows")[]` on line 10.
3. If `Record<string, unknown>` causes cascading type errors in adapter subclasses, revert to `any` and add a `// TODO: tighten types` comment.

**Acceptance Criteria:**
- [ ] No `any` types in base.ts signatures (or documented TODO if cascade)
- [ ] `raycast.ts` uses proper union type
- [ ] Build succeeds

---

### Task 2.3: Extract Shared `isObject` Utility (H-4)

**Files:**
- Create: `src/retrieval/utils.ts`
- Modify: `src/retrieval/catalog.ts`
- Modify: `src/retrieval/assembler.ts`

**Implementation Details:**

1. **Create `src/retrieval/utils.ts`**:
```ts
export function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
```

2. **`catalog.ts`**: Delete local `isObject` (lines 27-29). Add `import { isObject } from "./utils.js";`

3. **`assembler.ts`**: Delete local `isObject` (lines 51-53). Add `import { isObject } from "./utils.js";`

**Acceptance Criteria:**
- [ ] `src/retrieval/utils.ts` exists with `isObject` export
- [ ] No local `isObject` in catalog.ts or assembler.ts

---

### Task 2.4: Clean Up DedupStats Re-Export Aliases (M-3)

**Files:**
- Modify: `src/toon/index.ts`

**Implementation Details:**

Remove lines 80-81:
```ts
// DELETE:
export type { DedupStats as DedupStatsBase } from './types.js';
export type { DedupResult as DedupResultBase } from './types.js';
```

Canonical exports from `./dedup.js` on line 32 remain.

**Acceptance Criteria:**
- [ ] No `DedupStatsBase` or `DedupResultBase` aliases

---

## Post-Wave Verification

```bash
npx tsc --noEmit
npm test  # if test suite exists
```

---

## Out of Scope

| Issue | Owner | Reason |
|-------|-------|--------|
| BMX+ `_fastSigmoid` in `sagerank.ts` / `bmx-plus.ts` | Gemini | User decision |
| Wire retrieval pipeline into request flow | Future | Feature, not a fix |
| `ToolContext` / `FilesystemContext` unification (M-2) | Future | Design decision |
| `CompressConfig` constructor cleanup (H-7) | Future | Style, not a bug |
