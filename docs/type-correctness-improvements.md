# Type Correctness Improvements

> **Context:** The Zod schemas for MCP tools must remain **flat `z.object` schemas** — no
> `z.discriminatedUnion`, no `oneOf`. Every major LLM provider (OpenAI, Anthropic, etc.) rejects
> or silently mishandles `oneOf` in tool schemas. This is a hard constraint, not a preference.
>
> The fix therefore cannot be at the schema layer. It must be at the **schema/engine boundary**:
> validate and narrow *after* Zod parses the flat input, *before* the engine logic runs.
> The type system then has the information it needs, the providers never see a `oneOf`, and
> zero suppressions are required anywhere in the engine.

---

## 1. `core/edit-engine.ts` + `tools/edit_file.ts` — Schema/engine boundary validation

### Root cause

The `Edit` interface is flat with all fields optional (required by the provider constraint). Inside
`applyEditList`, each mode branch needs `block_start`, `block_end`, and `replacement_block` to
be `string` — but TypeScript still sees them as `string | undefined` even after the
`if (edit.mode === 'block')` narrowing, because narrowing on `mode` doesn't change the types of
unrelated fields. Hence the `!` on every access.

### The correct fix: Schema/engine boundary type guard

Introduce a **validation step at the entry to `applyEditList`** that converts the flat
`EditOperation` (schema-world) into a proper discriminated union `ValidatedEdit` (engine-world).
The schema stays flat. The engine only ever sees fully-typed values.

**Step 1 — Define internal engine types (not exposed to schema):**

```ts
// Internal to edit-engine.ts — never serialized or sent to providers

interface ValidatedBlockEdit {
    mode: 'block';
    block_start: string;
    block_end: string;
    replacement_block: string;
    nearLine?: number;
}

interface ValidatedSymbolEdit {
    mode: 'symbol';
    symbol: string;
    newText: string;
    nearLine?: number;
}

interface ValidatedContentEdit {
    mode: 'content';
    oldContent: string;
    newContent: string;
    nearLine?: number;
}

type ValidatedEdit = ValidatedBlockEdit | ValidatedSymbolEdit | ValidatedContentEdit;
```

**Step 2 — Validate and narrow at the boundary:**

```ts
function validateEdit(
    edit: Edit,
    index: number,
    isBatch: boolean,
): { ok: true; edit: ValidatedEdit } | { ok: false; msg: string } {
    const tag = isBatch ? `#${index + 1}: ` : '';

    switch (edit.mode) {
        case 'block':
            if (!edit.block_start || !edit.block_end || edit.replacement_block == null)
                return { ok: false, msg: `${tag}block mode requires block_start, block_end, and replacement_block.` };
            return { ok: true, edit: {
                mode: 'block',
                block_start: edit.block_start,
                block_end: edit.block_end,
                replacement_block: edit.replacement_block,
                nearLine: edit.nearLine,
            }};

        case 'symbol':
            if (!edit.symbol || edit.newText == null)
                return { ok: false, msg: `${tag}symbol mode requires symbol and newText.` };
            return { ok: true, edit: {
                mode: 'symbol',
                symbol: edit.symbol,
                newText: edit.newText,
                nearLine: edit.nearLine,
            }};

        case 'content':
            if (edit.oldContent == null || edit.newContent == null)
                return { ok: false, msg: `${tag}content mode requires oldContent and newContent.` };
            return { ok: true, edit: {
                mode: 'content',
                oldContent: edit.oldContent,
                newContent: edit.newContent,
                nearLine: edit.nearLine,
            }};

        default:
            return { ok: false, msg: `${tag}Unknown edit mode.` };
    }
}
```

**Step 3 — Use it at the top of the loop in `applyEditList`:**

```ts
for (const [i, rawEdit] of edits.entries()) {
    const validated = validateEdit(rawEdit, i, isBatch);
    if (!validated.ok) {
        errors.push({ i, msg: validated.msg });
        continue;
    }
    const edit = validated.edit; // ValidatedEdit — fully typed, no ! needed anywhere below

    if (edit.mode === 'block') {
        // edit.block_start: string — no !
        // edit.block_end: string — no !
        // edit.replacement_block: string — no !
        const expectedStart = edit.block_start.trim();
        const expectedEnd = edit.block_end.trim();
        // ...
        const normalizedNew = normalizeLineEndings(edit.replacement_block);
        // ...
    }

    if (edit.mode === 'symbol') {
        // edit.symbol: string — no !
        // edit.newText: string — no !
    }

    if (edit.mode === 'content') {
        // edit.oldContent: string — no !
        // edit.newContent: string — no !
    }
}
```

**What this achieves:**
- Zod schema stays flat → providers are happy
- Engine works with `ValidatedEdit` → TypeScript knows every field is present
- All 12 `!` assertions on mode-specific fields disappear
- Bad inputs surface as proper error messages, not crashes
- The live dist patch (the runtime guard added after the crash) becomes the correct implementation rather than a hotfix

**Also clean up the `Edit` interface:**

The fields `filePath`, `oldText`, `isBatch`, and `disambiguations` live on `Edit` but belong on
`ApplyEditListOptions` (where they already are). Remove them from `Edit` — they were carried over
from the JS era and are never set when constructing an edit from the tool args.

**Also fix `PendingSnapshot`:**

```ts
// Current — too loose
interface PendingSnapshot {
    symbol: string | undefined;
    filePath: string | undefined;
}

// Correct — symbol and filePath are always present when a snapshot is created
interface PendingSnapshot {
    symbol: string;
    originalText: string;
    line: number;
    filePath: string;
}
```

### Affected files
- `src/core/edit-engine.ts`
- `src/tools/edit_file.ts` (the local `EditOperation` type can be replaced with the exported `Edit`)

### Suppressions eliminated
All 12 `!` assertions in `applyEditList` for mode-specific fields.

---

## 2. `tools/search_files.ts` — Mode-local narrowing with a validated const

### Root cause

Same provider constraint: the schema must be flat with `contentQuery?: string`. But the code
already throws `new Error('contentQuery required for content mode.')` if it's absent. The problem
is TypeScript doesn't know the throw guarantees non-null below it, so `args.contentQuery` is still
`string | undefined` — hence `args.contentQuery!` on every subsequent use.

### The correct fix: Narrow with a local typed const after the guard

This is much simpler than fix 1 — no boundary type needed. Just assign to a narrowed local:

```ts
// Content mode branch
if (args.mode === 'content') {
    if (!args.contentQuery) {
        throw new Error('contentQuery required for content mode.');
    }
    // Narrow once — contentQuery is string from here on
    const contentQuery: string = args.contentQuery;

    // All uses below use the local — no ! needed
    const contentRegex = args.literalSearch
        ? new RegExp(contentQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
        : new RegExp(contentQuery, flags);

    if (contentQuery.length > 2) {
        const candidateFiles = await bm25PreFilterFiles(rootPath, contentQuery, 100, allExcludes);
        // ...
        rgResults = await ripgrepSearch(rootPath, { contentQuery, ... });
    }
    // etc.
}
```

Same pattern for `args.definesSymbol` in definition mode:
```ts
if (args.mode === 'definition') {
    if (!args.definesSymbol) throw new Error('definesSymbol required for definition mode.');
    const symbolName: string = args.definesSymbol;
    // use symbolName throughout — no !
}
```

### Affected files
- `src/tools/search_files.ts`

### Suppressions eliminated
8 `!` assertions on `args.contentQuery` and `args.definesSymbol`.

---

## 3. `core/path-utils.ts` — `normalizePath(p: any): any`

### Root cause

`normalizePath` takes `any` so callers passing non-strings don't get a type error. The function
handles non-strings by returning them unchanged. The `any` type makes all callers lose type safety.

### The correct fix: Overloads

```ts
export function normalizePath(p: string): string;
export function normalizePath(p: null): null;
export function normalizePath(p: undefined): undefined;
export function normalizePath(p: string | null | undefined): string | null | undefined;
export function normalizePath(p: unknown): unknown {
    if (p === null) return null;
    if (p === undefined) return undefined;
    if (typeof p !== 'string') return p;
    if (p.includes('\x00')) throw new Error('Path contains null bytes');
    // ... rest of implementation unchanged
}
```

Callers passing `string` get `string` back — no `any` leaking into their scope.

If in practice only `string` is ever passed, the simpler version is:
```ts
export function normalizePath(p: string): string {
    if (p.includes('\x00')) throw new Error('Path contains null bytes');
    // ... remove the null/undefined/typeof checks
}
```
And fix any non-string call sites directly.

### Affected files
- `src/core/path-utils.ts`

### Suppressions eliminated
1 `any` parameter + 1 `any` return type.

---

## 4. `tools/refactor_batch.ts` — `args.selection!`, `cached!.occurrences!`, `occList![0]`

### Root cause

**`args.selection!` (line 383):** `selection` is optional in the flat schema (provider constraint again).
The code reaches this line only in a branch where `selection` is required, but TypeScript doesn't
know that. The guard already exists implicitly — just make it explicit and narrow:

```ts
// Before the loop
if (!args.selection?.length) {
    return { content: [{ type: 'text', text: 'selection is required.' }] };
}
const selection = args.selection; // string[] — no ! needed below
for (const entry of selection) { ... }
```

**`cached!.occurrences!` (line 562):** `cached` is already confirmed non-null by an earlier guard
that returns early. The problem is the guard and the use are far apart so TypeScript loses the
narrowing. Restructure to use the already-narrowed `cached` directly:

```ts
// The guard already exists above — cached is non-null here
// Just use it without !
const priorOccurrences: LoadedOccurrence[] =
    (args.loadMore && Array.isArray(cached.occurrences))
        ? cached.occurrences   // no !
        : [];
```

**`occList!.find(...) || occList![0]` (line 651):** `Map.get()` returns `T | undefined`. Guard it:

```ts
const occList = loadedSymbols.get(g.symbol);
if (!occList?.length) continue;
// occList is LoadedOccurrence[] here — no ! needed
const firstOcc = occList.find(o => g.indices.includes(o.index)) ?? occList[0];
if (!firstOcc) continue;
```

### Affected files
- `src/tools/refactor_batch.ts`

### Suppressions eliminated
3 `!` assertions → proper narrowing.

---

## 5. `retrieval/pipeline.ts` + `retrieval/zenith-integration.ts` — `as unknown as`

### Root cause

Two distinct patterns:

**Pattern A (pipeline.ts):** Optional capability detection — checking if `this.retriever` has
an `isIndexReady()` method before calling it. The `'isIndexReady' in obj` check proves it exists
but TypeScript doesn't narrow `this.retriever`'s type from it, hence the cast.

**Pattern B (zenith-integration.ts):** Accessing `server.server._requestHandlers` — a private
internal field on the MCP SDK's `McpServer`. No public API exists for this.

### Correct fix — Pattern A: Type guard functions

```ts
// In a shared types file (e.g., retrieval/capabilities.ts)

interface IndexCapable {
    isIndexReady(): boolean;
}
interface FrequencyLogCapable {
    getLogPath(): string | null;
}
interface RebuildCapable {
    rebuildIndex(registry: Record<string, ToolMapping>): void;
    getSnapshotVersion(): string;
}

function isIndexCapable(r: unknown): r is IndexCapable {
    return typeof r === 'object' && r !== null
        && 'isIndexReady' in r
        && typeof (r as Record<string, unknown>).isIndexReady === 'function';
}
function isFrequencyLogCapable(r: unknown): r is FrequencyLogCapable {
    return typeof r === 'object' && r !== null
        && 'getLogPath' in r
        && typeof (r as Record<string, unknown>).getLogPath === 'function';
}
function isRebuildCapable(r: unknown): r is RebuildCapable {
    return typeof r === 'object' && r !== null
        && 'rebuildIndex' in r
        && typeof (r as Record<string, unknown>).rebuildIndex === 'function';
}
```

Then in `pipeline.ts`:
```ts
// No as unknown as — retriever is narrowed by the type guard
private idxOk(): boolean {
    return isIndexCapable(this.retriever) ? this.retriever.isIndexReady() : false;
}

private hasFreq(): boolean {
    if (!isFrequencyLogCapable(this.logger)) return false;
    const p = this.logger.getLogPath();
    return p != null && existsSync(p);
}
```

### Correct fix — Pattern B: Typed adapter with assertion guard

`server.server._requestHandlers` is a private SDK internal. The pragmatic correct fix (short of
contributing to the SDK) is:

```ts
// Define the shape you're depending on
interface McpServerInternals {
    _requestHandlers: Map<string, (request: unknown, extra: unknown) => Promise<unknown>>;
}

function getMcpServerInternals(server: McpServer): McpServerInternals {
    const internals = (server as unknown as { server: McpServerInternals }).server;
    // Fail loudly at startup if the SDK changes its internal shape
    if (!internals?._requestHandlers || !(internals._requestHandlers instanceof Map)) {
        throw new Error(
            'MCP SDK internal structure has changed: _requestHandlers not found. ' +
            'Check the SDK version and update installRetrievalRequestHandlers.'
        );
    }
    return internals;
}
```

This isolates the cast to one place with an explicit version guard, rather than spreading it across
every call site. The `as unknown as` count drops from 6 to 1, and that 1 is documented and guarded.

### Affected files
- `src/retrieval/pipeline.ts`
- `src/retrieval/zenith-integration.ts`
- New: `src/retrieval/capabilities.ts` (type guard functions)

### Suppressions eliminated
6 `as unknown as` → 1 isolated cast in `getMcpServerInternals` + typed capability guards.

---

## 6. `core/edit-engine.ts` — Array index `!` + `// nosemgrep`

### Root cause

`lines[i]!`, `origLines[i]!`, etc. — these are provably in-bounds (the `for` loop guarantees it)
but TypeScript can't prove that. Whether these are an issue depends on `tsconfig.json`.

### `tsconfig.json` verdict

`noUncheckedIndexedAccess: true` is **explicitly set** — so these are not noise. TypeScript
legitimately sees `arr[i]` as `T | undefined` and the `!` assertions were required by the compiler.
The clean approach is a small helper that makes the assumption explicit and debuggable:

```ts
/** Assert an array index is in-bounds. Throws a clear error instead of crashing silently. */
function assertAt<T>(arr: readonly T[], i: number, label = 'array'): T {
    const v = arr[i];
    if (v === undefined) throw new RangeError(`${label}[${i}] is out of bounds (length ${arr.length})`);
    return v;
}

// Usage — replaces lines[i]!.trim()
assertAt(lines, i, 'lines').trim()
```

This turns a silent `!` into an explicit, debuggable `RangeError` with context.

**`// nosemgrep` comments:** Not runtime suppressions. They silence Semgrep's CI rules on string
operations that look like injection sinks but aren't. Leave them if Semgrep runs in CI; remove
them if not — they're noise in the second case.

### Affected files
- `src/core/edit-engine.ts`
- `tsconfig.json` (check only)

### Suppressions eliminated
~10 array index `!` assertions — replaced with `assertAt()`, making the bounds assumption
explicit and debuggable rather than silent.

> **Note:** `exactOptionalPropertyTypes: true` is also set in `tsconfig.json`. This is relevant
> to fix 1 (`validateEdit`) — with this flag, `string | undefined` and `string?` are distinct
> types, making the compiler even stricter about unguarded optional field access. The
> `validateEdit` boundary pattern handles this correctly since `ValidatedEdit` fields are
> plain `string`, not optional at all.

---

## Priority Order

| Priority | Fix | Suppressions Removed | Notes |
|---|---|---|---|
| **1** | `edit-engine.ts` boundary validation (`validateEdit`) | 12 | Core crash fix, clean architecture |
| **2** | `search_files.ts` local narrowed const | 8 | Same pattern, mechanical |
| **3** | `retrieval/` type guard functions | 5 | Isolated, self-contained |
| **4** | `path-utils.ts` overloads | 1 | Tiny change, big downstream cleanup |
| **5** | `refactor_batch.ts` narrowing | 3 | Already has guards, just need local vars |
| **6** | `zenith-integration.ts` isolated cast | 1 | Architectural, check SDK first |
| **7** | Array index `!` in `edit-engine.ts` | ~10 | Check tsconfig — may be free |

## Implementation note

Fix 1 (`validateEdit`) also supersedes the hotfix applied to the live dist — once this is
implemented and built, the runtime guard in `mcp-servers/Zenith_MCP/dist/core/edit-engine.js`
can be removed (it's correct but unnecessary with proper validation in place).
